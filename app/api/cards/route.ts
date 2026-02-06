import { NextResponse } from 'next/server';
import { createCard, listCards } from '@/lib/db';
import { emitStreamEvent } from '@/lib/events';

export async function GET() {
  return NextResponse.json({ cards: listCards() });
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body?.title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }
  const card = createCard(body.title, body.description, body.session_id);
  emitStreamEvent({ type: 'cards_changed', cardId: card.id });
  return NextResponse.json({ card });
}
