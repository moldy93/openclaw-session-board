import { NextResponse } from 'next/server';
import { addSessionLog, listSessionLogs } from '@/lib/db';
import { emitStreamEvent } from '@/lib/events';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const limit = 10;
  const logs = listSessionLogs(params.id, limit);
  return NextResponse.json({ logs });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  if (!body?.body) {
    return NextResponse.json({ error: 'body required' }, { status: 400 });
  }
  const direction = body.direction === 'outbound' ? 'outbound' : 'inbound';
  const log = addSessionLog(params.id, body.body, direction);
  emitStreamEvent({ type: 'session_log', sessionId: params.id });
  return NextResponse.json({ log });
}
