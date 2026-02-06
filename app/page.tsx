'use client';

import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { useEffect, useMemo, useRef, useState } from 'react';

type GatewaySession = {
  key?: string;
  sessionKey?: string;
  session_id?: string;
  sessionId?: string;
  id?: string;
  displayName?: string;
  model?: string;
  modelProvider?: string;
  updatedAt?: number;
};

type SessionItem = {
  session: GatewaySession;
  lastMessage?: string | null;
  lastRole?: string | null;
  lastRunState?: string | null;
  deleted?: boolean;
  firstSeenAt?: number;
  columnEnteredAt?: number;
};

const columns = ['backlog', 'doing', 'review', 'done'] as const;

type ColumnKey = (typeof columns)[number];

const runStatesDoing = new Set(['thinking', 'working']);

const ellipsize = (value: string, head = 8, tail = 4) => {
  if (!value) return '—';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
};

const extractText = (content: any): string | null => {
  if (!content) return null;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const part = content.find((item) => item?.type === 'text');
    return part?.text ?? null;
  }
  return null;
};

const getSessionKey = (session: GatewaySession): string | null =>
  session.key || session.sessionKey || session.session_id || session.id || session.sessionId || null;

const getSessionId = (session: GatewaySession): string | null =>
  session.sessionId || session.session_id || session.id || session.key || session.sessionKey || null;

const getAgentLabel = (session: GatewaySession): string =>
  session.key || session.sessionKey || session.session_id || session.sessionId || session.id || '—';

const resolveColumn = (item: SessionItem): ColumnKey => {
  if (item.deleted) return 'done';
  if (item.lastRunState && runStatesDoing.has(item.lastRunState)) return 'doing';
  if (item.lastRole === 'user') return 'doing';
  if (item.lastRole === 'assistant') return 'review';
  return 'backlog';
};

const formatAgo = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const formatDateTime = (value?: number) => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
};

const formatDistance = (value?: number) => {
  if (!value) return '—';
  return formatDistanceToNow(value, { addSuffix: true, locale: de });
};

export default function HomePage() {
  const [sessions, setSessions] = useState<Record<string, SessionItem>>({});
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [tick, setTick] = useState(Date.now());
  const logRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      setStatus('live');
    };

    socket.onerror = () => {
      setStatus('error');
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'sessions' && Array.isArray(payload?.payload?.sessions)) {
          const list = payload.payload.sessions as (GatewaySession & { lastMessage?: string | null; lastRole?: string | null })[];
          setSessions((prev) => {
            const next: Record<string, SessionItem> = { ...prev };
            const seen = new Set<string>();
            list.forEach((session) => {
              const key = getSessionKey(session);
              if (!key) return;
              seen.add(key);
              const existing = prev[key];
              const initialSeenAt = existing?.firstSeenAt ?? session.updatedAt ?? Date.now();
              const nextItem: SessionItem = {
                ...existing,
                session,
                lastMessage: session.lastMessage ?? existing?.lastMessage ?? null,
                lastRole: session.lastRole ?? existing?.lastRole ?? null,
                deleted: false,
                firstSeenAt: initialSeenAt
              };
              const previousColumn = existing ? resolveColumn(existing) : null;
              const nextColumn = resolveColumn(nextItem);
              nextItem.columnEnteredAt = previousColumn === nextColumn
                ? existing?.columnEnteredAt ?? (session.updatedAt ?? initialSeenAt)
                : Date.now();
              next[key] = nextItem;
            });
            Object.keys(next).forEach((key) => {
              if (!seen.has(key)) {
                next[key] = { ...next[key], deleted: true };
              }
            });
            return next;
          });
        }

        if (payload?.type === 'chat' && payload?.payload) {
          const chat = payload.payload;
          const key = chat?.sessionKey || chat?.session_id || chat?.sessionId;
          if (!key) return;
          const role = chat?.message?.role ?? null;
          const message = extractText(chat?.message?.content);
          const runState = chat?.state ?? null;

          setSessions((prev) => {
            const existing = prev[key] ?? { session: { key }, firstSeenAt: Date.now() };
            const nextItem: SessionItem = {
              ...existing,
              session: existing.session ?? { key },
              lastRole: role,
              lastMessage: message ?? existing.lastMessage,
              lastRunState: runState,
              deleted: false
            };
            const previousColumn = resolveColumn(existing);
            const nextColumn = resolveColumn(nextItem);
            nextItem.columnEnteredAt = previousColumn === nextColumn
              ? existing?.columnEnteredAt ?? Date.now()
              : Date.now();
            return {
              ...prev,
              [key]: nextItem
            };
          });
        }

        if (payload?.type === 'error') {
          setStatus('error');
        }
      } catch {
        return;
      }
    };

    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    Object.values(logRefs.current).forEach((node) => {
      if (!node) return;
      node.scrollTop = node.scrollHeight;
    });
  }, [sessions]);

  const grouped = useMemo(() => {
    const groups: Record<ColumnKey, SessionItem[]> = {
      backlog: [],
      doing: [],
      review: [],
      done: []
    };

    Object.values(sessions).forEach((item) => {
      const column = resolveColumn(item);
      groups[column].push(item);
    });

    return groups;
  }, [sessions]);

  const copy = (value: string | null) => {
    if (!value) return;
    navigator.clipboard.writeText(value).catch(() => undefined);
  };

  return (
    <main>
      <header>
        <div />
        <div className={`status ${status}`}>{status}</div>
      </header>

      <section className="board">
        {columns.map((column) => (
          <div className={`column ${column}`} key={column}>
            <h2>{column}</h2>
            {grouped[column].length === 0 && <small className="muted">No sessions.</small>}
            {grouped[column].map((item) => {
              const sessionKey = getSessionKey(item.session) ?? 'unknown';
              const sessionId = getSessionId(item.session);
              const label = item.session.displayName || ellipsize(sessionKey);
              const agentLabel = getAgentLabel(item.session);
              const modelLabel = item.session.modelProvider
                ? `${item.session.modelProvider}/${item.session.model ?? ''}`.replace(/\/$/, '')
                : item.session.model ?? '—';
              const updatedAt = item.session.updatedAt ?? 0;
              const isStale = column === 'review' && updatedAt > 0 && Date.now() - updatedAt > 24 * 60 * 60 * 1000;
              const enteredAt = item.columnEnteredAt ?? updatedAt ?? Date.now();
              const elapsed = tick - enteredAt;
              const showReviewTimer = column === 'review' && elapsed < 15 * 60 * 1000;
              const showDoingTimer = column === 'doing';

              return (
                <div className={`card ${column} ${isStale ? 'stale' : ''}`} key={sessionKey}>
                  <div className="card-title">
                    <strong>{label}</strong>
                    <div className="card-badges">
                      {showDoingTimer && <span className="timer">{formatAgo(elapsed)}</span>}
                      {showReviewTimer && <span className="timer">{formatAgo(elapsed)}</span>}
                      {item.deleted && <span className="pill">deleted</span>}
                    </div>
                  </div>

                  <div className="meta">
                    <div className="meta-row">
                      <span className="meta-label">Agent</span>
                      <span className="meta-value">{ellipsize(agentLabel)}</span>
                      <button className="copy" onClick={() => copy(agentLabel)} aria-label="Copy agent">
                        ⧉
                      </button>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Model</span>
                      <span className="meta-value">{modelLabel || '—'}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Session ID</span>
                      <span className="meta-value">{sessionId ? ellipsize(sessionId) : '—'}</span>
                      <button
                        className="copy"
                        onClick={() => copy(sessionId)}
                        aria-label="Copy session id"
                        disabled={!sessionId}
                      >
                        ⧉
                      </button>
                    </div>
                    {item.firstSeenAt && (
                      <div className="meta-row">
                        <span className="meta-label">Created</span>
                        <span className="meta-value" title={formatDateTime(item.firstSeenAt)}>
                          {formatDistance(item.firstSeenAt)}
                        </span>
                        <span />
                      </div>
                    )}
                    <div className="meta-row">
                      <span className="meta-label">Updated</span>
                      <span className="meta-value" title={formatDateTime(updatedAt)}>
                        {formatDistance(updatedAt)}
                      </span>
                      <span />
                    </div>
                  </div>

                  <div
                    className={`message-box ${item.lastMessage ? '' : 'empty'}`}
                    ref={(node) => {
                      logRefs.current[sessionKey] = node;
                    }}
                  >
                    <div className="message-text">
                      {item.lastMessage ? item.lastMessage : 'No message received yet.'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </main>
  );
}
