import { NextResponse } from 'next/server';
import { getAllBankConfigs } from '@/lib/config/bank-configs';

export async function GET() {
  try {
    const configs = getAllBankConfigs();
    return NextResponse.json(configs);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch bank configs' }, { status: 500 });
  }
}
