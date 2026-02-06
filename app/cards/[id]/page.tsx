'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const columns = ['backlog', 'doing', 'review', 'done'];

type Card = {
  id: number;
  title: string;
  description: string | null;
  column: string;
  session_id: string | null;
  created_at: string;
};

type SessionLog = {
  id: number;
  session_id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  created_at: string;
};

type Comment = {
  id: number;
  card_id: number;
  body: string;
  created_at: string;
};

export default function CardDetail({ params }: { params: { id: string } }) {
  const cardId = Number(params.id);
  const [card, setCard] = useState<Card | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [sessionIdInput, setSessionIdInput] = useState('');

  async function load() {
    const [cardRes, commentRes] = await Promise.all([
      fetch(`/api/cards/${cardId}`),
      fetch(`/api/cards/${cardId}/comments`)
    ]);
    const cardData = await cardRes.json();
    const commentData = await commentRes.json();
    const loadedCard = cardData.card ?? null;
    setCard(loadedCard);
    setComments(commentData.comments ?? []);
    if (loadedCard?.session_id) {
      const logRes = await fetch(`/api/sessions/${encodeURIComponent(loadedCard.session_id)}/logs`);
      const logData = await logRes.json();
      setLogs(logData.logs ?? []);
    } else {
      setLogs([]);
    }
    setSessionIdInput(loadedCard?.session_id ?? '');
  }

  useEffect(() => {
    load();
    const source = new EventSource('/api/stream');
    source.onmessage = (event) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'cards_changed' && payload.cardId === cardId) {
          load();
        }
        if (payload.type === 'comments_changed' && payload.cardId === cardId) {
          load();
        }
        if (payload.type === 'session_log') {
          load();
        }
      } catch {
        return;
      }
    };
    return () => {
      source.close();
    };
  }, [cardId]);

  async function addNewComment(event: React.FormEvent) {
    event.preventDefault();
    if (!commentBody.trim()) return;
    await fetch(`/api/cards/${cardId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: commentBody })
    });
    setCommentBody('');
    await load();
  }

  async function updateColumn(column: string) {
    await fetch(`/api/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column })
    });
    await load();
  }

  async function updateSessionId() {
    await fetch(`/api/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionIdInput || null })
    });
    await load();
  }

  async function sendMessage() {
    if (!card?.session_id || !messageDraft.trim()) return;
    await fetch(`/api/sessions/${encodeURIComponent(card.session_id)}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: messageDraft, direction: 'outbound' })
    });
    setMessageDraft('');
    await load();
  }

  if (!card) {
    return (
      <main>
        <p>Loading...</p>
        <Link href="/">Back to board</Link>
      </main>
    );
  }

  return (
    <main>
      <div className="detail">
        <Link href="/">← Back to board</Link>
        <h1>{card.title}</h1>
        <p>{card.description || 'No description yet.'}</p>
        <label>
          Column
          <select value={card.column} onChange={(e) => updateColumn(e.target.value)}>
            {columns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
        </label>
        <label>
          Session ID
          <div className="session-field">
            <input
              value={sessionIdInput}
              onChange={(e) => setSessionIdInput(e.target.value)}
              placeholder="Session ID"
            />
            <button type="button" className="secondary" onClick={updateSessionId}>
              Save
            </button>
          </div>
        </label>
        {card.session_id ? (
          <section>
            <h2>Session logs</h2>
            <div className="log-list">
              {logs.slice(0, 10).map((log) => (
                <div key={log.id} className={`log-item ${log.direction}`}>
                  <span>{log.direction === 'outbound' ? '→' : '←'}</span>
                  <span>{log.body}</span>
                </div>
              ))}
              {logs.length === 0 && <small className="muted">No logs yet.</small>}
            </div>
            <form
              className="log-form"
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage();
              }}
            >
              <input
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder="Send message to session"
              />
              <button type="submit">Send</button>
            </form>
          </section>
        ) : (
          <small className="muted">Add a session ID to enable logs.</small>
        )}
        <section>
          <h2>Comments</h2>
          <form onSubmit={addNewComment}>
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
              placeholder="Add a comment"
            />
            <button type="submit">Add comment</button>
          </form>
          <div className="comments">
            {comments.map((comment) => (
              <div className="comment" key={comment.id}>
                <small>{new Date(comment.created_at).toLocaleString()}</small>
                <div>{comment.body}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
