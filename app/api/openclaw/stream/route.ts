import WebSocket from 'ws';

const gatewayWs = process.env.OPENCLAW_GATEWAY_WS || 'ws://host.docker.internal:18789';
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      if (!gatewayToken) {
        controller.enqueue(encoder.encode(`data: {"type":"error","message":"missing token"}\n\n`));
        controller.close();
        return;
      }

      const ws = new WebSocket(gatewayWs, {
        headers: {
          Authorization: `Bearer ${gatewayToken}`,
          Host: '127.0.0.1:18789'
        }
      });

      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
      }, 30000);

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
                id: 'kanban-stream',
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
              userAgent: 'kanban-stream/1.0.0',
              device: {
                id: 'kanban-stream',
                publicKey: '',
                signature: '',
                signedAt: challenge?.ts ?? Date.now(),
                nonce: challenge?.nonce ?? ''
              }
            }
          })
        );
      };

      ws.on('message', (raw) => {
        try {
          const payload = JSON.parse(raw.toString());
          if (payload?.type === 'event' && payload?.event === 'connect.challenge') {
            sendConnect(payload?.payload);
            return;
          }
          if (payload?.type === 'event' && payload?.event === 'chat') {
            send({ type: 'chat', payload: payload?.payload });
          }
        } catch {
          return;
        }
      });

      ws.on('error', (err) => {
        send({ type: 'error', message: String(err) });
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        controller.close();
      });
    },
    cancel() {}
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
}
