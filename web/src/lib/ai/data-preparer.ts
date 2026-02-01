import Decimal from 'decimal.js';
import { accountRepo, journalRepo, propertyRepo } from '@/lib/repos';
import { calculateEquity } from '@/lib/properties/equity-calculator';
import { formatCurrency } from '@/lib/utils/formatting';

export async function prepareContext(query: string, currencySymbol = '£'): Promise<string> {
  const sections: string[] = [];
  const queryLower = query.toLowerCase();

  // Always include account balances
  sections.push(await accountSummary(currencySymbol));

  // Spending/budget queries
  if (['spend', 'budget', 'expense', 'category', 'saving', 'income', 'money'].some(kw => queryLower.includes(kw))) {
    sections.push(await spendingSummary(currencySymbol));
    sections.push(await recentTransactions(currencySymbol));
  }

  // Property queries
  if (['property', 'properties', 'equity', 'mortgage', 'house', 'home', 'real estate', 'owner'].some(kw => queryLower.includes(kw))) {
    sections.push(await propertySummary(currencySymbol));
  }

  // Net worth queries
  if (['net worth', 'financial', 'health', 'wealth', 'overview', 'summary', 'total'].some(kw => queryLower.includes(kw))) {
    sections.push(await netWorthSummary(currencySymbol));
  }

  // Generic queries - add broad context
  if (sections.length <= 1) {
    sections.push(await spendingSummary(currencySymbol));
    sections.push(await recentTransactions(currencySymbol));
  }

  return sections.filter(Boolean).join('\n\n');
}

async function accountSummary(currency: string): Promise<string> {
  const balances = await accountRepo.getBalances();
  if (!balances || balances.length === 0) return 'ACCOUNT BALANCES: No accounts set up yet.';

  const lines = ['ACCOUNT BALANCES:'];
  for (const b of balances) {
    lines.push(`  ${b.account_name} (${b.account_type}): ${formatCurrency(b.balance, currency)}`);
  }
  return lines.join('\n');
}

async function spendingSummary(currency: string): Promise<string> {
  const spending = await journalRepo.getMonthlySpending();
  if (!spending || spending.length === 0) return 'MONTHLY SPENDING: No spending data available.';

  const lines = ['MONTHLY SPENDING BY CATEGORY:'];
  const byMonth: Record<string, typeof spending> = {};
  for (const row of spending) {
    const month = row.month ?? 'unknown';
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(row);
  }

  const months = Object.keys(byMonth).sort().reverse().slice(0, 3);
  for (const month of months) {
    lines.push(`\n  ${month}:`);
    for (const row of byMonth[month]) {
      const cat = row.category_name || 'Uncategorized';
      const total = Math.abs(parseFloat(row.total ?? '0'));
      lines.push(`    ${cat}: ${formatCurrency(total, currency)}`);
    }
  }
  return lines.join('\n');
}

async function recentTransactions(currency: string, limit = 20): Promise<string> {
  const entries = await journalRepo.listEntries({ limit });
  if (!entries || entries.length === 0) return 'RECENT TRANSACTIONS: None recorded.';

  const lines = [`RECENT TRANSACTIONS (last ${limit}):`];
  for (const entry of entries) {
    const cat = (entry as Record<string, unknown>).category_name as string || 'Uncategorized';
    const desc = ((entry as Record<string, unknown>).description as string || '').substring(0, 40);
    const date = (entry as Record<string, unknown>).date as string || '';
    const summary = (entry as Record<string, unknown>).entries_summary as string || '';
    lines.push(`  ${date} | ${desc} | ${cat} | ${summary}`);
  }
  return lines.join('\n');
}

async function propertySummary(currency: string): Promise<string> {
  const allProperties = await propertyRepo.listProperties();
  if (!allProperties || allProperties.length === 0) return 'PROPERTIES: No properties recorded.';

  const lines = ['PROPERTY EQUITY SUMMARY:'];
  for (const prop of allProperties) {
    const pid = prop.id;
    lines.push(`\n  ${prop.name}:`);
    lines.push(`    Address: ${prop.address ?? 'N/A'}`);
    lines.push(`    Purchase Price: ${formatCurrency(prop.purchasePrice ?? '0', currency)}`);

    const valuation = await propertyRepo.getLatestValuation(pid);
    if (valuation) {
      lines.push(`    Current Valuation: ${formatCurrency(valuation.valuation, currency)} (${valuation.valuationDate})`);
    }

    const mortgagesList = await propertyRepo.getMortgages(pid);
    for (const m of mortgagesList) {
      const balance = await propertyRepo.getMortgageBalance(m.id);
      lines.push(`    Mortgage (${m.lender}): Balance ${formatCurrency(new Decimal(balance).abs().toString(), currency)}`);
    }

    const equityData = await calculateEquity(pid);
    if (equityData.length > 0) {
      lines.push('    Owner Equity:');
      for (const e of equityData) {
        lines.push(`      ${e.name}: ${formatCurrency(e.equityAmount.toString(), currency)} (${e.equityPct.toFixed(1)}%)`);
      }
    }
  }
  return lines.join('\n');
}

async function netWorthSummary(currency: string): Promise<string> {
  const balances = await accountRepo.getBalances();
  let assets = new Decimal(0);
  let liabilities = new Decimal(0);

  for (const b of balances) {
    if (b.account_type === 'ASSET') assets = assets.plus(b.balance);
    if (b.account_type === 'LIABILITY') liabilities = liabilities.plus(new Decimal(b.balance).abs());
  }

  const netWorth = assets.minus(liabilities);
  return [
    'NET WORTH SUMMARY:',
    `  Total Assets: ${formatCurrency(assets.toString(), currency)}`,
    `  Total Liabilities: ${formatCurrency(liabilities.toString(), currency)}`,
    `  Net Worth: ${formatCurrency(netWorth.toString(), currency)}`,
  ].join('\n');
}
