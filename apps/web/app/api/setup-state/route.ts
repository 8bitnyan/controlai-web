import { NextResponse } from 'next/server';
import { prisma } from '@controlai-web/db';
import { getSetupState } from '@controlai-web/api';

export async function GET() {
  const state = await getSetupState(prisma);
  return NextResponse.json(state);
}
