import { CloudTasksClient } from '@google-cloud/tasks';
import { ExpressAdapter } from 'ask-sdk-express-adapter';
import express from 'express';
import { skillBuilder } from '../handlers/alexaHandlers';
import {
  createOuraWebhookReplayKey,
  parseOuraWebhookEvent,
  QueuedOuraWebhookEvent,
  verifyOuraWebhookSignature,
} from '../services/ouraWebhookService';
import { FirestoreWebhookReplayStore } from './firestoreOuraStore';

const app = express();
const tasks = new CloudTasksClient();
const replayStore = new FirestoreWebhookReplayStore();

app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));

const alexaAdapter = new ExpressAdapter(skillBuilder, false, false);
app.post('/alexa', alexaAdapter.getRequestHandlers());

app.get('/oura-webhook', (request, response) => {
  const token = String(request.query.verification_token || '');
  const challenge = String(request.query.challenge || '');
  if (!token || token !== process.env.OURA_WEBHOOK_VERIFICATION_TOKEN || !challenge) {
    console.warn(JSON.stringify({ event: 'oura_webhook_verification_rejected' }));
    return response.status(401).send('Unauthorized');
  }
  return response.status(200).json({ challenge });
});

app.post('/oura-webhook', express.raw({ type: '*/*', limit: '256kb' }), async (request, response) => {
  const rawBody = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '';
  const timestamp = request.header('x-oura-timestamp');
  const signature = request.header('x-oura-signature');

  if (!verifyOuraWebhookSignature(rawBody, timestamp, signature, process.env.OURA_CLIENT_SECRET || '')) {
    console.warn(JSON.stringify({ event: 'oura_webhook_signature_rejected' }));
    return response.status(401).send('Unauthorized');
  }

  const ouraEvent = parseOuraWebhookEvent(rawBody);
  if (!ouraEvent) return response.status(400).send('Invalid payload');

  const eventId = createOuraWebhookReplayKey(rawBody, timestamp!);
  if (!(await replayStore.reserve(eventId))) {
    console.log(JSON.stringify({ event: 'oura_webhook_duplicate', dataType: ouraEvent.data_type }));
    return response.status(200).send('Already accepted');
  }

  try {
    const projectId = required('GCP_PROJECT_ID');
    const location = required('GCP_LOCATION');
    const queue = required('GCP_TASK_QUEUE');
    const workerUrl = required('GCP_WORKER_URL');
    const serviceAccountEmail = required('GCP_TASK_OIDC_SERVICE_ACCOUNT');
    const message: QueuedOuraWebhookEvent = {
      receivedAt: new Date().toISOString(),
      event: ouraEvent,
    };

    await tasks.createTask({
      parent: tasks.queuePath(projectId, location, queue),
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: `${workerUrl}/tasks/process-oura-webhook`,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify(message)),
          oidcToken: {
            serviceAccountEmail,
            audience: workerUrl,
          },
        },
      },
    });

    console.log(JSON.stringify({ event: 'oura_webhook_queued', dataType: ouraEvent.data_type }));
    return response.status(202).send('Accepted');
  } catch (error) {
    await replayStore.release(eventId);
    console.error(JSON.stringify({
      event: 'oura_webhook_queue_failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(503).send('Unavailable');
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(JSON.stringify({ event: 'webhook_service_started', port })));

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
