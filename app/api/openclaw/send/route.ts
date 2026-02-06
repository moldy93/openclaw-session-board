import { NextResponse } from 'next/server';

const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';

export async function POST(req: Request) {
  if (!gatewayToken) {
    return NextResponse.json({ ok: false, error: 'missing gateway token' }, { status: 500 });
  }

  const body = await req.json();
  const sessionKey = body?.sessionKey;
  const message = body?.message;

  if (!sessionKey || !message) {
    return NextResponse.json({ ok: false, error: 'missing sessionKey or message' }, { status: 400 });
  }

  const res = await fetch(`${gatewayUrl}/tools/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${gatewayToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tool: 'sessions_send',
      action: 'json',
      args: { sessionKey, message }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ ok: false, error: text }, { status: res.status });
  }

  const payload = await res.json();
  return NextResponse.json({ ok: true, result: payload?.result ?? payload?.details ?? payload });
}
