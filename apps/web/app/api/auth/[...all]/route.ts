import { auth } from '@controlai-web/api';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return auth.handler(req);
}

export async function POST(req: NextRequest) {
  return auth.handler(req);
}
