import { NextResponse } from 'next/server';

const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';

export async function POST(req: Request) {
  if (!gatewayToken) {
    return NextResponse.json({ ok: false, error: 'missing gateway token' }, { status: 500 });
  }

  const body = await req.json();
  const sessionKey = body?.sessionKey as string | undefined;
  const message = body?.message as string | undefined;
  const deliveryContext = body?.deliveryContext as { channel?: string; to?: string; accountId?: string } | undefined;
  const channel = body?.channel as string | undefined;
  const lastChannel = body?.lastChannel as string | undefined;

  if (!sessionKey || !message?.trim()) {
    return NextResponse.json({ ok: false, error: 'missing sessionKey or message' }, { status: 400 });
  }

  const isTelegram = deliveryContext?.channel === 'telegram' || channel === 'telegram' || lastChannel === 'telegram';
  const targetRaw = deliveryContext?.to ?? '';
  const target = targetRaw.startsWith('telegram:') ? targetRaw.replace('telegram:', '') : targetRaw;

  const invokePayload = isTelegram
    ? {
        tool: 'message',
        action: 'json',
        args: {
          action: 'send',
          channel: 'telegram',
          target,
          accountId: deliveryContext?.accountId,
          message
        }
      }
    : {
        tool: 'sessions_send',
        action: 'json',
        args: { sessionKey, message }
      };

  const res = await fetch(`${gatewayUrl}/tools/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${gatewayToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(invokePayload)
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ ok: false, error: text }, { status: res.status });
  }

  const payload = await res.json();
  return NextResponse.json({ ok: true, result: payload?.result ?? payload?.details ?? payload });
}
