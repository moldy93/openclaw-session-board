'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  channel?: string;
  lastChannel?: string;
  deliveryContext?: {
    channel?: string;
    to?: string;
    accountId?: string;
  };
  lastMessage?: string | null;
  lastRole?: string | null;
};

type HistoryMessage = {
  role?: string;
  content?: any;
  createdAt?: number;
};

const extractText = (content: any): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const part = content.find((item) => item?.type === 'text');
    return part?.text ?? '';
  }
  return '';
};

const extractToolInfo = (message: HistoryMessage) => {
  const content = message?.content;
  if (message?.role === 'tool' || message?.role === 'toolResult') {
    return { name: 'tool', detail: extractText(content), kind: 'result' };
  }
  if (!Array.isArray(content)) return null;
  const toolPart = content.find((item) => item?.type?.includes('tool'));
  if (!toolPart) return null;
  const name = toolPart?.name || toolPart?.tool || toolPart?.id || 'tool';
  const detail = toolPart?.result?.summary || toolPart?.result?.output || extractText(content);
  return { name, detail, kind: 'call' };
};

const getSessionKey = (session: GatewaySession): string | null =>
  session.key || session.sessionKey || session.session_id || session.id || session.sessionId || null;

export default function ChatView() {
  const [sessions, setSessions] = useState<Record<string, GatewaySession>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [historyLimit, setHistoryLimit] = useState(60);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'sessions' && Array.isArray(payload?.payload?.sessions)) {
          const list = payload.payload.sessions as GatewaySession[];
          setSessions((prev) => {
            const next: Record<string, GatewaySession> = { ...prev };
            list.forEach((session) => {
              const key = getSessionKey(session);
              if (!key) return;
              next[key] = { ...next[key], ...session };
            });
            return next;
          });
          if (!selected && list.length > 0) {
            const first = getSessionKey(list[0]);
            if (first) setSelected(first);
          }
        }
        if (payload?.type === 'chat' && payload?.payload) {
          const chat = payload.payload;
          const key = chat?.sessionKey || chat?.session_id || chat?.sessionId;
          if (!key) return;
          const role = chat?.message?.role ?? null;
          const text = extractText(chat?.message?.content);
          if (selected && key === selected) {
            setMessages((prev) => {
              if (prev.length === 0) return [{ role, content: text, createdAt: Date.now() }];
              const last = prev[prev.length - 1];
              const lastText = extractText(last.content);
              if (role === 'assistant' && last?.role === 'assistant') {
                if (text.startsWith(lastText) || text.length >= lastText.length) {
                  const next = [...prev];
                  next[next.length - 1] = { ...last, content: text, createdAt: Date.now() };
                  return next;
                }
              }
              return [...prev, { role, content: text, createdAt: Date.now() }];
            });
            if (refreshTimer.current) {
              window.clearTimeout(refreshTimer.current);
            }
            refreshTimer.current = window.setTimeout(() => {
              fetch(`/api/openclaw/history?sessionKey=${encodeURIComponent(key)}&limit=120`)
                .then((res) => res.json())
                .then((data) => setMessages(data?.messages ?? []))
                .catch(() => undefined);
            }, 600);
          }
        }
      } catch {
        return;
      }
    };

    return () => socket.close();
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    fetch(`/api/openclaw/history?sessionKey=${encodeURIComponent(selected)}&limit=${historyLimit}`)
      .then((res) => res.json())
      .then((data) => setMessages(data?.messages ?? []))
      .catch(() => undefined);
  }, [selected, historyLimit]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [selected]);

  useEffect(() => {
    if (!hovered) return;
    const timer = window.setTimeout(() => {
      const key = hovered;
      if (!key) return;
      fetch(`/api/openclaw/history?sessionKey=${encodeURIComponent(key)}&limit=80`)
        .then((res) => res.json())
        .then((data) => setMessages(data?.messages ?? []))
        .catch(() => undefined);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [hovered]);

  const ordered = useMemo(() => {
    return Object.values(sessions).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [sessions]);

  const sendMessage = async () => {
    if (!selected || !draft.trim()) return;
    const session = sessions[selected];
    const text = draft.trim();
    setDraft('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    setMessages((prev) => [...prev, { role: 'user', content: text, createdAt: Date.now() }]);
    setSending(true);
    try {
      await fetch('/api/openclaw/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionKey: selected,
          message: text,
          deliveryContext: session?.deliveryContext,
          channel: session?.channel,
          lastChannel: session?.lastChannel
        })
      });
    } finally {
      setSending(false);
    }
  };

  const handleScroll = () => {
    const node = listRef.current;
    if (!node || node.scrollTop > 40) return;
    setHistoryLimit((prev) => Math.min(prev + 60, 500));
  };

  return (
    <main className="chat-layout">
      <a className="chat-close" href="/" aria-label="Close chat">✕</a>
      <button className="chat-menu" onClick={() => setSidebarOpen((prev) => !prev)}>☰</button>
      <aside className={`chat-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="chat-sidebar-header">Sessions</div>
        <div className="chat-list">
          {ordered.map((session) => {
            const key = getSessionKey(session);
            if (!key) return null;
            const label = session.displayName || key;
            return (
              <button
                key={key}
                className={`chat-item ${selected === key ? 'active' : ''}`}
                onClick={() => {
                  setSelected(key);
                  setSidebarOpen(false);
                }}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="chat-item-title">{label}</div>
                <div className="chat-item-sub">{session.lastMessage ?? '—'}</div>
                <div className="chat-item-preview">
                  <div className="chat-item-preview-text">
                    {session.lastMessage ?? 'Keine Vorschau'}
                  </div>
                  <div className="chat-item-preview-fade" />
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="chat-panel">
        <div className="chat-panel-header">
          {selected ? sessions[selected]?.displayName || selected : '—'}
        </div>
        <div className="chat-thread" ref={listRef} onScroll={handleScroll}>
          {(() => {
            const items: JSX.Element[] = [];
            for (let i = 0; i < messages.length; i += 1) {
              const msg = messages[i];
              const toolInfo = extractToolInfo(msg);
              if (toolInfo && toolInfo.kind === 'call') {
                const next = messages[i + 1];
                const nextTool = next ? extractToolInfo(next) : null;
                const detail = (nextTool?.detail || toolInfo.detail || '').trim();
                const insight = detail.slice(0, 160) || 'Tool output';
                items.push(
                  <div key={`tool-${i}`} className="chat-tool" title={detail}>
                    <span className="chat-tool-icon">🛠️</span>
                    <span className="chat-tool-name">{toolInfo.name}</span>
                    <span className="chat-tool-insight">{insight}</span>
                    {detail && <div className="chat-tool-result">{detail}</div>}
                  </div>
                );
                if (nextTool && nextTool.kind === 'result') {
                  i += 1;
                }
                continue;
              }
              if (toolInfo && toolInfo.kind === 'result') {
                const detail = (toolInfo.detail || '').trim();
                if (detail) {
                  const insight = detail.slice(0, 160) || 'Tool output';
                  items.push(
                    <div key={`tool-${i}`} className="chat-tool" title={detail}>
                      <span className="chat-tool-icon">🛠️</span>
                      <span className="chat-tool-name">{toolInfo.name}</span>
                      <span className="chat-tool-insight">{insight}</span>
                      <div className="chat-tool-result">{detail}</div>
                    </div>
                  );
                }
                continue;
              }
              items.push(
                <div key={i} className={`chat-bubble ${msg.role ?? 'assistant'}`}>
                  <div className="chat-bubble-role">{msg.role ?? 'assistant'}</div>
                  <div className="chat-bubble-text">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{extractText(msg.content)}</ReactMarkdown>
                  </div>
                </div>
              );
            }
            return items;
          })()}
        </div>
        <div className="chat-composer">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Nachricht schreiben…"
            value={draft}
            onInput={(event) => {
              const target = event.currentTarget;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
            }}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <button type="button" onClick={sendMessage} disabled={sending}>
            {sending ? <span className="spinner" /> : 'Senden'}
          </button>
        </div>
      </section>
    </main>
  );
}
