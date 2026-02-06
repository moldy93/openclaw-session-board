import { EventEmitter } from 'events';

export type StreamEvent =
  | { type: 'cards_changed'; cardId?: number }
  | { type: 'comments_changed'; cardId: number }
  | { type: 'session_log'; sessionId: string };

const emitter = new EventEmitter();

actionCache();

export function onStreamEvent(handler: (event: StreamEvent) => void) {
  emitter.on('event', handler);
}

export function offStreamEvent(handler: (event: StreamEvent) => void) {
  emitter.off('event', handler);
}

export function emitStreamEvent(event: StreamEvent) {
  emitter.emit('event', event);
}

function actionCache() {
  emitter.setMaxListeners(200);
}
