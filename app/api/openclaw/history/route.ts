import { NextResponse } from 'next/server';

const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';

export async function GET(req: Request) {
  if (!gatewayToken) {
    return NextResponse.json({ ok: false, error: 'missing gateway token' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const sessionKey = searchParams.get('sessionKey');
  const limit = Number(searchParams.get('limit') || 80);

  if (!sessionKey) {
    return NextResponse.json({ ok: false, error: 'missing sessionKey' }, { status: 400 });
  }

  const res = await fetch(`${gatewayUrl}/tools/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${gatewayToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tool: 'sessions_history',
      action: 'json',
      args: { sessionKey, limit, includeTools: true }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ ok: false, error: text }, { status: res.status });
  }

  const payload = await res.json();
  const messages = payload?.result?.messages || payload?.result?.details?.messages || [];
  const sorted = [...messages].sort((a: any, b: any) => (a?.createdAt ?? 0) - (b?.createdAt ?? 0));
  return NextResponse.json({ ok: true, messages: sorted });
}
