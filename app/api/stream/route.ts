import { onStreamEvent, offStreamEvent, StreamEvent } from '@/lib/events';

export async function GET() {
  const encoder = new TextEncoder();

  let handler: ((event: StreamEvent) => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: StreamEvent | { type: 'ping' }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: 'ping' });

      handler = (event: StreamEvent) => send(event);
      onStreamEvent(handler);

      ping = setInterval(() => send({ type: 'ping' }), 15000);

      controller.enqueue(encoder.encode('retry: 3000\n\n'));
    },
    cancel() {
      if (ping) clearInterval(ping);
      if (handler) offStreamEvent(handler);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}
