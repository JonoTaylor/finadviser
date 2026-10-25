import { NextResponse } from 'next/server';
import { getAllBankConfigs } from '@/lib/config/bank-configs';
import { routeErrorResponse } from '@/lib/http/route-errors';

export async function GET() {
  try {
    const configs = getAllBankConfigs();
    return NextResponse.json(configs);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch bank configs');
  }
}
