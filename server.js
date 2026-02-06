const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const next = require('next');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws');

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const gatewayWs = process.env.OPENCLAW_GATEWAY_WS || 'ws://127.0.0.1:18789';
const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';

const DEVICE_FILE = path.join(process.cwd(), '.openclaw-device.json');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64UrlEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({
    type: 'spki',
    format: 'der'
  });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem) {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem
  };
}

function loadOrCreateDeviceIdentity() {
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      const raw = fs.readFileSync(DEVICE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
        const derived = fingerprintPublicKey(parsed.publicKeyPem);
        if (derived && derived !== parsed.deviceId) {
          const updated = { ...parsed, deviceId: derived };
          fs.writeFileSync(DEVICE_FILE, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
          return {
            deviceId: derived,
            publicKeyPem: parsed.publicKeyPem,
            privateKeyPem: parsed.privateKeyPem
          };
        }
        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem
        };
      }
    }
  } catch {}

  const identity = generateIdentity();
  const stored = {
    version: 1,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now()
  };
  fs.writeFileSync(DEVICE_FILE, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return identity;
}

function buildDeviceAuthPayload({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce }) {
  const version = nonce ? 'v2' : 'v1';
  const base = [
    version,
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(','),
    String(signedAtMs),
    token ?? ''
  ];
  if (version === 'v2') base.push(nonce ?? '');
  return base.join('|');
}

function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

function publicKeyRawBase64UrlFromPem(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function sendConnect(ws, challenge) {
  const identity = loadOrCreateDeviceIdentity();
  const signedAt = Date.now();
  const nonce = challenge?.nonce ?? '';
  const scopes = ['operator.read'];
  const clientId = 'gateway-client';
  const clientMode = 'backend';
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId,
    clientMode,
    role: 'operator',
    scopes,
    signedAtMs: signedAt,
    token: gatewayToken,
    nonce
  });
  const signature = signDevicePayload(identity.privateKeyPem, payload);

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
          id: clientId,
          displayName: 'kanban-board',
          version: '1.0.0',
          platform: 'node',
          mode: clientMode
        },
        role: 'operator',
        scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: gatewayToken },
        locale: 'en-US',
        userAgent: 'kanban-board/1.0.0',
        device: {
          id: identity.deviceId,
          publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
          signature,
          signedAt,
          nonce
        }
      }
    })
  );
}

function requestSessions(ws) {
  const id = crypto.randomUUID();
  ws.send(
    JSON.stringify({
      type: 'req',
      id,
      method: 'sessions.list',
      params: { includeGlobal: true, includeUnknown: false, limit: 200 }
    })
  );
}

async function fetchLastMessage(sessionKey) {
  try {
    const res = await fetch(`${gatewayUrl}/tools/invoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tool: 'sessions_history',
        action: 'json',
        args: { sessionKey, limit: 1, includeTools: false }
      })
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const messages = payload?.result?.messages || payload?.result?.details?.messages || [];
    const last = messages?.[0];
    const content = Array.isArray(last?.content)
      ? last.content.find((part) => part?.type === 'text')?.text
      : typeof last?.content === 'string'
        ? last.content
        : null;
    return {
      lastRole: last?.role ?? null,
      lastMessage: content ?? null
    };
  } catch {
    return null;
  }
}

app.prepare().then(() => {
  const server = http.createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (client) => {
    if (!gatewayToken) {
      client.send(JSON.stringify({ type: 'error', message: 'missing gateway token' }));
      client.close();
      return;
    }

    let gateway = null;
    let connected = false;
    let interval = null;
    const lastUpdatedAt = new Map();

    const send = (data) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    };

    const connectGateway = () => {
      gateway = new WebSocket(gatewayWs, {
        headers: {
          Authorization: `Bearer ${gatewayToken}`,
          Host: '127.0.0.1:18789'
        }
      });

      gateway.on('message', async (raw) => {
        try {
          const payload = JSON.parse(raw.toString());
          if (payload?.type === 'event' && payload?.event === 'connect.challenge') {
            sendConnect(gateway, payload?.payload);
            return;
          }
          if (payload?.type === 'res' && payload?.ok && payload?.payload?.type === 'hello-ok') {
            connected = true;
            requestSessions(gateway);
            return;
          }
          if (payload?.type === 'res' && payload?.ok && payload?.payload?.sessions) {
            const sessions = payload?.payload?.sessions || [];
            const updates = await Promise.all(
              sessions.map(async (session) => {
                const key = session?.key || session?.sessionKey || session?.session_id || session?.sessionId || null;
                if (!key) return session;
                const updatedAt = session?.updatedAt || 0;
                const previous = lastUpdatedAt.get(key);
                if (previous === updatedAt) return session;
                lastUpdatedAt.set(key, updatedAt);
                const last = await fetchLastMessage(key);
                return { ...session, ...last };
              })
            );
            send({ type: 'sessions', payload: { ...payload?.payload, sessions: updates } });
            return;
          }
          if (payload?.type === 'event' && payload?.event === 'chat') {
            send({ type: 'chat', payload: payload?.payload });
            return;
          }
        } catch {
          return;
        }
      });

      gateway.on('error', (err) => {
        send({ type: 'error', message: String(err) });
      });

      gateway.on('close', () => {
        connected = false;
      });
    };

    connectGateway();

    interval = setInterval(() => {
      if (gateway && connected && gateway.readyState === WebSocket.OPEN) {
        requestSessions(gateway);
      }
    }, 1000);

    client.on('close', () => {
      if (interval) clearInterval(interval);
      if (gateway && gateway.readyState === WebSocket.OPEN) {
        gateway.close();
      }
    });
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
});
