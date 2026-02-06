import { NextResponse } from 'next/server';
import WebSocket from 'ws';
import { listCards, upsertCardBySessionId, updateCard } from '@/lib/db';

const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const gatewayWs = process.env.OPENCLAW_GATEWAY_WS || 'ws://127.0.0.1:18789';
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';
// active window removed

function resolveColumn(session: any, lastRole?: string | null): 'backlog' | 'doing' | 'review' {
  if (session?.totalTokens === 0) return 'backlog';
  if (lastRole === 'user') return 'doing';
  if (lastRole === 'assistant') return 'review';
  return 'backlog';
}

export async function GET() {
  if (!gatewayToken) {
    return NextResponse.json({ ok: false, error: 'missing gateway token' }, { status: 500 });
  }

  let sessions: any[] = [];
  try {
    sessions = await new Promise<any[]>((resolve, reject) => {
      const ws = new WebSocket(gatewayWs, {
        headers: {
          Authorization: `Bearer ${gatewayToken}`,
          Host: '127.0.0.1:18789'
        }
      });

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('ws timeout'));
      }, 7000);

      let connected = false;
      let reqSent = false;

      const sendConnect = (challenge?: { nonce?: string; ts?: number }) => {
        const id = crypto.randomUUID();
        ws.send(
          JSON.stringify({
            type: 'req',
            id,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'kanban-sync',
                version: '1.0.0',
                platform: 'node',
                mode: 'operator'
              },
              role: 'operator',
              scopes: ['operator.read'],
              caps: [],
              commands: [],
              permissions: {},
              auth: { token: gatewayToken },
              locale: 'en-US',
              userAgent: 'kanban-sync/1.0.0',
              device: {
                id: 'kanban-sync',
                publicKey: '',
                signature: '',
                signedAt: challenge?.ts ?? Date.now(),
                nonce: challenge?.nonce ?? ''
              }
            }
          })
        );
      };

      ws.on('open', () => {
        // wait for connect.challenge event
      });

      ws.on('message', (data) => {
        try {
          const payload = JSON.parse(data.toString());
          if (payload?.type === 'event' && payload?.event === 'connect.challenge') {
            sendConnect(payload?.payload);
            return;
          }
          if (payload?.type === 'res' && payload?.ok && payload?.payload?.type === 'hello-ok') {
            connected = true;
          }
          if (connected && !reqSent) {
            reqSent = true;
            const reqId = crypto.randomUUID();
            ws.send(
              JSON.stringify({
                type: 'req',
                id: reqId,
                method: 'sessions.list',
                params: { includeGlobal: true, includeUnknown: false, limit: 200 }
              })
            );
            return;
          }
          if (payload?.type === 'res' && payload?.ok && payload?.payload?.sessions) {
            clearTimeout(timeout);
            ws.close();
            resolve(payload?.payload?.sessions || []);
          }
        } catch (err) {
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        ws.close();
        reject(err);
      });
    });
  } catch (err) {
    const res = await fetch(`${gatewayUrl}/tools/invoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tool: 'sessions_list', action: 'json', args: {} })
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ ok: false, error: text }, { status: res.status });
    }

    const payload = await res.json();
    sessions = payload?.result?.sessions || payload?.result?.details?.sessions || [];
  }

  const seen = new Set<string>();
  for (const session of sessions) {
    const key = session.key || session.sessionKey || session.session_id;
    if (!key) continue;
    seen.add(key);
    const title = session.displayName || key;
    const description = key;
    let lastMessage: string | null = null;
    let lastRole: string | null = null;
    try {
      const historyRes = await fetch(`${gatewayUrl}/tools/invoke`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gatewayToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tool: 'sessions_history',
          action: 'json',
          args: { sessionKey: key, limit: 1, includeTools: false }
        })
      });
      if (historyRes.ok) {
        const historyPayload = await historyRes.json();
        const messages = historyPayload?.result?.messages || historyPayload?.result?.details?.messages || [];
        const last = messages?.[0];
        lastRole = last?.role ?? null;
        if (last?.content) {
          const part = Array.isArray(last.content) ? last.content.find((c: any) => c.type === 'text') : null;
          lastMessage = part?.text ?? null;
        }
      }
    } catch {
      // ignore per-session history errors
    }

    const column = resolveColumn(session, lastRole);
    upsertCardBySessionId(key, { title, description, column, last_message: lastMessage });
  }

  const existingCards = listCards();
  for (const card of existingCards) {
    if (card.session_id && !seen.has(card.session_id)) {
      if (card.column !== 'done') {
        updateCard(card.id, { column: 'done' });
      }
    }
  }

  return NextResponse.json({ ok: true, count: sessions.length });
}
