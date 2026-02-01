import { NextRequest, NextResponse } from 'next/server';
import { categoryRepo } from '@/lib/repos';

export async function GET() {
  try {
    const rules = await categoryRepo.listRulesWithCategory();
    return NextResponse.json(rules);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch rules' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rule = await categoryRepo.addRule({
      pattern: body.pattern,
      categoryId: body.categoryId,
      matchType: body.matchType ?? 'contains',
      priority: body.priority ?? 0,
      source: body.source ?? 'user',
    });
    return NextResponse.json(rule);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    await categoryRepo.deleteRule(parseInt(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const body = await request.json();
    const rule = await categoryRepo.updateRule(parseInt(id), body);
    return NextResponse.json(rule);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
  }
}
