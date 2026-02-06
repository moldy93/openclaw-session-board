import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type Card = {
  id: number;
  title: string;
  description: string | null;
  column: string;
  session_id: string | null;
  created_at: string;
};

export type Comment = {
  id: number;
  card_id: number;
  body: string;
  created_at: string;
};

export type SessionLog = {
  id: number;
  session_id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  created_at: string;
};

const dbPath = path.join(process.cwd(), 'db', 'kanban.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    column TEXT NOT NULL DEFAULT 'backlog',
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS session_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'inbound',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const cardsColumns = db.prepare("PRAGMA table_info(cards)").all() as { name: string }[];
if (!cardsColumns.some((col) => col.name === 'session_id')) {
  db.exec("ALTER TABLE cards ADD COLUMN session_id TEXT");
}

export function listCards(): Card[] {
  return db.prepare('SELECT * FROM cards ORDER BY created_at DESC').all() as Card[];
}

export function getCard(id: number): Card | undefined {
  return db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Card | undefined;
}

export function createCard(title: string, description?: string | null, sessionId?: string | null): Card {
  const stmt = db.prepare('INSERT INTO cards (title, description, session_id) VALUES (?, ?, ?)');
  const result = stmt.run(title, description ?? null, sessionId ?? null);
  return getCard(result.lastInsertRowid as number)!;
}

export function updateCard(
  id: number,
  fields: Partial<Pick<Card, 'title' | 'description' | 'column' | 'session_id'>>
): Card | undefined {
  const existing = getCard(id);
  if (!existing) return undefined;
  const next = {
    title: fields.title ?? existing.title,
    description: fields.description ?? existing.description,
    column: fields.column ?? existing.column,
    session_id: fields.session_id ?? existing.session_id
  };
  db.prepare('UPDATE cards SET title = ?, description = ?, column = ?, session_id = ? WHERE id = ?').run(
    next.title,
    next.description,
    next.column,
    next.session_id,
    id
  );
  return getCard(id);
}

export function deleteCard(id: number) {
  db.prepare('DELETE FROM comments WHERE card_id = ?').run(id);
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
}

export function listComments(cardId: number): Comment[] {
  return db
    .prepare('SELECT * FROM comments WHERE card_id = ? ORDER BY created_at DESC')
    .all(cardId) as Comment[];
}

export function addComment(cardId: number, body: string): Comment {
  const stmt = db.prepare('INSERT INTO comments (card_id, body) VALUES (?, ?)');
  const result = stmt.run(cardId, body);
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid) as Comment;
}

export function listSessionLogs(sessionId: string, limit = 10): SessionLog[] {
  return db
    .prepare('SELECT * FROM session_logs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(sessionId, limit) as SessionLog[];
}

export function addSessionLog(sessionId: string, body: string, direction: SessionLog['direction']): SessionLog {
  const stmt = db.prepare('INSERT INTO session_logs (session_id, body, direction) VALUES (?, ?, ?)');
  const result = stmt.run(sessionId, body, direction);
  return db.prepare('SELECT * FROM session_logs WHERE id = ?').get(result.lastInsertRowid) as SessionLog;
}
