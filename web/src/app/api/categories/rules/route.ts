import { NextRequest, NextResponse } from 'next/server';
import { categoryRepo } from '@/lib/repos';
import { parseId, routeErrorResponse, readJsonBody } from '@/lib/http/route-errors';
import { ClientError } from '@/lib/errors';

/** A rule that can never match is silently useless, so refuse it when saved. */
function assertUsablePattern(pattern: unknown, matchType: unknown): void {
  if (typeof pattern !== 'string' || !pattern.trim()) throw new ClientError('Enter the text this rule should match.');
  if (matchType === 'regex') {
    try {
      new RegExp(pattern, 'i');
    } catch {
      throw new ClientError('That regular expression is not valid. Check its brackets and special characters.');
    }
  }
}

export async function GET() {
  try {
    const rules = await categoryRepo.listRulesWithCategory();
    return NextResponse.json(rules);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch rules');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    assertUsablePattern(body?.pattern, body?.matchType ?? 'contains');
    const rule = await categoryRepo.addRule({
      pattern: body.pattern,
      categoryId: body.categoryId,
      matchType: body.matchType ?? 'contains',
      priority: body.priority ?? 0,
      source: body.source ?? 'user',
    });
    return NextResponse.json(rule);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to create rule');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    await categoryRepo.deleteRule(parseId(id, 'rule id'));
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to delete rule');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const ruleId = parseId(id, 'rule id');
    const body = await readJsonBody(request);
    if (body?.pattern !== undefined || body?.matchType !== undefined) {
      const existing = (await categoryRepo.listRulesWithCategory()).find(rule => rule.id === ruleId);
      assertUsablePattern(body.pattern ?? existing?.pattern, body.matchType ?? existing?.match_type ?? 'contains');
    }
    const rule = await categoryRepo.updateRule(ruleId, body);
    return NextResponse.json(rule);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to update rule');
  }
}
