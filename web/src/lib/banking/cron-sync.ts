/**
 * Daily cron orchestrator for the banking integration. Runs every
 * morning, walks every connection, and:
 *
 *   1. Transitions status (active <-> expiring <-> expired) based on
 *      consent_expires_at vs now.
 *   2. Writes / dismisses AI tips so the user sees a reauth banner
 *      on the dashboard ahead of the 90-day deadline. Tips are tag-
 *      deduplicated so a daily cron can't accumulate duplicates.
 *   3. Pulls fresh transactions for every active / expiring
 *      connection through the same syncConnection() the manual
 *      "Sync now" button uses, wrapped in a sync_runs row.
 *   4. Records errors per connection without aborting the run for
 *      others; one failing bank doesn't stop the others syncing.
 *
 * Returns a summary the route handler echoes back to Vercel logs.
 */

import { syncConnection, reconcileTransfersForRun } from './sync';
import { bankingRepo, type ConnectionRow, type ConnectionStatus } from './repo';
import { tipRepo } from '@/lib/repos';

const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_DAYS = 7;

export interface CronSummary {
  total: number;
  synced: number;
  skipped: number;
  becameExpiring: number;
  becameExpired: number;
  /** Number of transfer pairs auto-merged at the end of this cron run. */
  transfersMerged: number;
  errors: Array<{ connectionId: number; provider: string; message: string }>;
}

export async function runDailySync(): Promise<CronSummary> {
  const connections = await bankingRepo.listConnections();
  const summary: CronSummary = {
    total: connections.length,
    synced: 0,
    skipped: 0,
    becameExpiring: 0,
    becameExpired: 0,
    transfersMerged: 0,
    errors: [],
  };

  for (const conn of connections) {
    const newStatus = computeNewStatus(conn);
    if (newStatus !== conn.status) {
      await bankingRepo.setConnectionStatus(conn.id, newStatus);
    }

    // Tips: write on the transition into expiring / expired, clear
    // on transition back to active (e.g. after reconnect). The
    // upsertTagged dedup guarantees one active tip per (connection,
    // kind) at a time, regardless of cron-run cadence.
    await reconcileExpiryTips(conn.id, conn.providerDisplayName, newStatus);
    if (newStatus === 'expiring' && conn.status !== 'expiring') summary.becameExpiring += 1;
    if (newStatus === 'expired'  && conn.status !== 'expired')  summary.becameExpired += 1;

    // Active + expiring still have valid consent; we sync those
    // through the existing engine. Pending / expired / revoked /
    // error are skipped (they need user action first).
    if (newStatus !== 'active' && newStatus !== 'expiring') {
      summary.skipped += 1;
      continue;
    }

    const linked = await bankingRepo.listProviderAccounts(conn.id);
    if (linked.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const runId = await bankingRepo.startSyncRun(conn.id);
    try {
      const outcome = await syncConnection(conn.id, runId);
      await bankingRepo.finishSyncRun(runId, {
        status: 'success',
        txnsAdded: outcome.txnsAdded,
        txnsUpdated: outcome.txnsUpdated,
      });
      summary.synced += 1;

      // Bookkeeping after a successful sync: stamp last_synced_at,
      // clear any persisted last_error, dismiss the prior sync-error
      // tip. Each runs in its own try/catch so a transient blip on
      // any one of them does NOT re-mark the already-finished run as
      // status='error' with zero counts. The summary stays correct.
      try {
        await bankingRepo.markSynced(conn.id);
      } catch (e) {
        console.error(`[cron] markSynced failed for connection ${conn.id}:`, e);
      }
      try {
        await bankingRepo.setConnectionStatus(conn.id, newStatus, { lastError: null });
      } catch (e) {
        console.error(`[cron] clear lastError failed for connection ${conn.id}:`, e);
      }
      try {
        await tipRepo.dismissByTag(`connection:${conn.id}:sync-error`);
      } catch (e) {
        console.error(`[cron] dismiss sync-error tip failed for connection ${conn.id}:`, e);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      await bankingRepo.finishSyncRun(runId, {
        status: 'error',
        txnsAdded: 0,
        txnsUpdated: 0,
        errorMessage: msg,
      }).catch(() => { /* swallow; we still want the next iteration to run */ });
      // Persist the last error on the connection so the UI can show
      // it inline without trawling sync_runs.
      await bankingRepo.setConnectionStatus(conn.id, newStatus, { lastError: msg }).catch(() => { /* ditto */ });
      await tipRepo.upsertTagged({
        tag: `connection:${conn.id}:sync-error`,
        tipType: 'warning',
        priority: 5,
        content: `${conn.providerDisplayName} sync failed: ${msg.slice(0, 200)}. Check /settings/connections for details.`,
      }).catch(() => { /* ditto */ });
      summary.errors.push({ connectionId: conn.id, provider: conn.providerDisplayName, message: msg });
    }
  }

  // End-of-run cross-connection reconciliation pass. A statement
  // payment shows up on a bank connection and on a credit-card
  // connection; running this once at the end (rather than per
  // connection) lets the scorer pair them even if they synced in
  // different cron iterations. Passes NULL so the function scans
  // all unmerged journals; the function itself filters out
  // already-flagged / already-grouped rows so it's idempotent.
  try {
    summary.transfersMerged = await reconcileTransfersForRun(null, 3);
  } catch (e) {
    console.error('[cron] reconcileTransfersForRun failed:', e);
  }

  return summary;
}

function computeNewStatus(conn: ConnectionRow): ConnectionStatus {
  // Pending / revoked / error stay where they are: each indicates a
  // user-action requirement (finish consent, reconnect, look at the
  // error) that the cron can't satisfy on its own. Auto-recovering
  // an `error` connection to `active` purely on consent_expires_at
  // would hide the "Reconnect" CTA in the settings UI even though
  // the underlying problem (e.g. revoked at the bank, malformed
  // requisition) is unfixed.
  if (
    conn.status === 'pending' ||
    conn.status === 'revoked' ||
    conn.status === 'error'
  ) {
    return conn.status;
  }

  if (!conn.consentExpiresAt) {
    // No expiry recorded but status implies one (active/expiring/
    // expired). Leave as-is; in practice every active connection
    // has an expiry set by createConsent.
    return conn.status;
  }

  const now = Date.now();
  const expiry = conn.consentExpiresAt.getTime();
  if (now >= expiry) return 'expired';
  if (now + EXPIRING_WINDOW_DAYS * DAY_MS >= expiry) return 'expiring';
  // Otherwise "fresh": prefer 'active' (drops back from expiring if
  // the user reconnected and the window moved out).
  return 'active';
}

async function reconcileExpiryTips(
  connectionId: number,
  providerName: string,
  status: ConnectionStatus,
) {
  const expiringTag = `connection:${connectionId}:expiring`;
  const expiredTag  = `connection:${connectionId}:expired`;

  if (status === 'expiring') {
    await tipRepo.dismissByTag(expiredTag);
    await tipRepo.upsertTagged({
      tag: expiringTag,
      tipType: 'warning',
      priority: 8,
      content: `${providerName} bank consent expires soon. Reconnect via /settings/connections to keep transactions syncing.`,
    });
    return;
  }
  if (status === 'expired') {
    await tipRepo.dismissByTag(expiringTag);
    await tipRepo.upsertTagged({
      tag: expiredTag,
      tipType: 'warning',
      priority: 10,
      content: `${providerName} bank consent expired. Reconnect via /settings/connections to resume daily syncs.`,
    });
    return;
  }
  // Active / pending / revoked / error: dismiss any prior expiry
  // tips so a successful reconnect clears them straight away.
  await tipRepo.dismissByTag(expiringTag);
  await tipRepo.dismissByTag(expiredTag);
}
