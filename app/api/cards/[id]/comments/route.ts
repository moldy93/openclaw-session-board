import { NextResponse } from 'next/server';
import { addComment, listComments } from '@/lib/db';
import { emitStreamEvent } from '@/lib/events';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const cardId = Number(params.id);
  return NextResponse.json({ comments: listComments(cardId) });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const cardId = Number(params.id);
  const body = await request.json();
  if (!body?.body) {
    return NextResponse.json({ error: 'body required' }, { status: 400 });
  }
  const comment = addComment(cardId, body.body);
  emitStreamEvent({ type: 'comments_changed', cardId });
  return NextResponse.json({ comment });
}
