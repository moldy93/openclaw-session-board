import { NextResponse } from 'next/server';
import { deleteCard, getCard, updateCard } from '@/lib/db';
import { emitStreamEvent } from '@/lib/events';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const card = getCard(id);
  if (!card) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ card });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const body = await request.json();
  const card = updateCard(id, {
    title: body.title,
    description: body.description,
    column: body.column,
    session_id: body.session_id
  });
  if (!card) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  emitStreamEvent({ type: 'cards_changed', cardId: card.id });
  return NextResponse.json({ card });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  deleteCard(id);
  emitStreamEvent({ type: 'cards_changed', cardId: id });
  return NextResponse.json({ ok: true });
}
