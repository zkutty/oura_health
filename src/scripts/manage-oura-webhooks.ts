import 'dotenv/config';
import axios from 'axios';

const OURA_WEBHOOK_URL = 'https://api.ouraring.com/v2/webhook/subscription';
const DEFAULT_DATA_TYPES = ['sleep', 'daily_readiness', 'daily_activity', 'daily_resilience'];

interface OuraWebhookSubscription {
  id?: string;
  callback_url?: string;
  event_type?: string;
  data_type?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

async function main(): Promise<void> {
  const callbackUrl = required('OURA_WEBHOOK_CALLBACK_URL');
  const verificationToken = required('OURA_WEBHOOK_VERIFICATION_TOKEN');
  const clientId = required('OURA_CLIENT_ID');
  const clientSecret = required('OURA_CLIENT_SECRET');
  const eventTypes = (process.env.OURA_WEBHOOK_EVENT_TYPES || 'update')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  const client = axios.create({
    headers: {
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
      'Content-Type': 'application/json',
    },
  });

  const response = await client.get(OURA_WEBHOOK_URL);
  const subscriptions: OuraWebhookSubscription[] = Array.isArray(response.data)
    ? response.data
    : response.data?.data || [];

  for (const dataType of DEFAULT_DATA_TYPES) {
    for (const eventType of eventTypes) {
      const exists = subscriptions.some(subscription =>
        subscription.callback_url === callbackUrl &&
        subscription.data_type === dataType &&
        subscription.event_type === eventType
      );

      if (exists) {
        console.log(`Subscription already exists: ${eventType}/${dataType}`);
        continue;
      }

      await client.post(OURA_WEBHOOK_URL, {
        callback_url: callbackUrl,
        verification_token: verificationToken,
        event_type: eventType,
        data_type: dataType,
      });
      console.log(`Created subscription: ${eventType}/${dataType}`);
    }
  }
}

main().catch((error: unknown) => {
  const message = axios.isAxiosError(error)
    ? `Oura webhook subscription request failed: ${error.response?.status || error.message}`
    : error instanceof Error ? error.message : 'Unknown error';
  console.error(message);
  process.exitCode = 1;
});
