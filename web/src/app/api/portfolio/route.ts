import { NextRequest, NextResponse } from 'next/server';
import { readWorkspace, writeWorkspace } from '@/lib/finance-workspace/store';
import { workspaceErrorResponse } from '@/lib/finance-workspace/api';
import { londonTodayIso } from '@/lib/dates/today';
import { loadPortfolioAccounts, loadPortfolioWorkspace, validatePortfolioAgainstAccounts } from '@/lib/portfolio/load';
import { analyzePortfolio } from '@/lib/portfolio/analyze';
import { INITIAL_PORTFOLIO, PORTFOLIO_KEY, portfolioDataSchema, portfolioWriteSchema } from '@/lib/portfolio/schema';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    return NextResponse.json(await loadPortfolioWorkspace(), { headers: HEADERS });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = portfolioWriteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') }, { status: 400, headers: HEADERS });
  try {
    const asOf = londonTodayIso();
    const [accounts, current] = await Promise.all([
      loadPortfolioAccounts(asOf), readWorkspace(PORTFOLIO_KEY, portfolioDataSchema, INITIAL_PORTFOLIO),
    ]);
    const validation = validatePortfolioAgainstAccounts(parsed.data.data, accounts, asOf, current.data);
    if (validation) return NextResponse.json({ error: validation }, { status: 400, headers: HEADERS });
    const workspace = await writeWorkspace(PORTFOLIO_KEY, portfolioDataSchema, parsed.data.data, parsed.data.revision);
    return NextResponse.json({ workspace, accounts, analysis: analyzePortfolio(workspace.data, accounts, asOf) }, { headers: HEADERS });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
