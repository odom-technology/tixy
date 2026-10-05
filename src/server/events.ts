import { publish } from '@/server/realtime/pubsub';

export type BroadcastTopic = string | string[];

// Server-side fan-out. Every existing caller keeps the same signature; the
// payload now actually reaches subscribed browsers over the /api/live SSE
// stream instead of being a dev-only console log.
export function broadcast(topic: BroadcastTopic, payload: unknown) {
  if (process.env.NODE_ENV === 'development') {
    console.debug('[arcade:broadcast]', topic, payload);
  }
  publish(topic, payload);
}
