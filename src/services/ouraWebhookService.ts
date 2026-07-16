import { createHash, createHmac, timingSafeEqual } from 'crypto';

const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

export interface OuraWebhookEvent {
  event_type: string;
  data_type: string;
  object_id: string;
  user_id: string;
  [key: string]: unknown;
}

export interface QueuedOuraWebhookEvent {
  receivedAt: string;
  event: OuraWebhookEvent;
}

export function verifyOuraWebhookSignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  clientSecret: string,
  now = Date.now()
): boolean {
  if (!timestamp || !signature || !clientSecret || !isRecentTimestamp(timestamp, now)) {
    return false;
  }

  const expected = createHmac('sha256', clientSecret)
    .update(`${timestamp}${rawBody}`)
    .digest('hex')
    .toUpperCase();

  const received = signature.trim().toUpperCase();
  if (expected.length !== received.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function parseOuraWebhookEvent(rawBody: string): OuraWebhookEvent | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object') return null;

    const event = parsed as Partial<OuraWebhookEvent>;
    if (
      typeof event.event_type !== 'string' ||
      typeof event.data_type !== 'string' ||
      typeof event.object_id !== 'string' ||
      typeof event.user_id !== 'string'
    ) {
      return null;
    }

    return event as OuraWebhookEvent;
  } catch {
    return null;
  }
}

export function createOuraWebhookReplayKey(rawBody: string, timestamp: string): string {
  return createHash('sha256').update(`${timestamp}:${rawBody}`).digest('hex');
}

function isRecentTimestamp(timestamp: string, now: number): boolean {
  const numeric = Number(timestamp);
  const parsed = Number.isFinite(numeric)
    ? (numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : Date.parse(timestamp);
  return Number.isFinite(parsed) && Math.abs(now - parsed) <= MAX_WEBHOOK_AGE_MS;
}
