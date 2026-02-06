# OpenClaw Session Board

Realtime session board for OpenClaw (Next.js + Docker).

## Setup

```bash
cd kanban
npm install
```

## Run (local)

```bash
npm run dev
```

Open http://localhost:3000 (the app runs via `server.js` to provide a WebSocket endpoint at `/ws`).

## Run (Docker)

```bash
cp .env.example .env
# fill OPENCLAW_GATEWAY_TOKEN

docker compose up -d
```

Open http://localhost:3000

## Notes
- Columns: backlog / doing / review / done
- Realtime updates via Gateway WebSocket + periodic sessions.list
