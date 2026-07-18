import express from 'express';
import { GoogleDocsOuraPublisher } from '../services/googleDocsOuraPublisher';
import { OuraDailyExportWorkflow } from '../services/ouraDailyExportWorkflow';
import { OuraExportService } from '../services/ouraExportService';
import { OuraService } from '../services/ouraService';
import { QueuedOuraWebhookEvent } from '../services/ouraWebhookService';
import { FirestoreOuraExportStateStore } from './firestoreOuraStore';

const app = express();
app.use(express.json({ limit: '256kb' }));

const workflow = new OuraDailyExportWorkflow(
  new OuraService(),
  new OuraExportService(),
  new GoogleDocsOuraPublisher(),
  new FirestoreOuraExportStateStore()
);

app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));

app.post('/tasks/process-oura-webhook', async (request, response) => {
  try {
    const message = request.body as Partial<QueuedOuraWebhookEvent>;
    if (!message.event || typeof message.event.object_id !== 'string' || typeof message.event.data_type !== 'string') {
      return response.status(400).json({ error: 'Invalid queued event.' });
    }
    const state = await workflow.processEvent(message.event);
    return response.status(200).json({ date: state.date, status: state.status });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'oura_webhook_processing_failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(500).json({ error: 'Processing failed.' });
  }
});

app.post('/tasks/reconcile', async (request, response) => {
  try {
    const requestedDays = Number(request.body?.days || 7);
    const days = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 30
      ? requestedDays
      : 7;
    const result = await workflow.reconcile(days);
    console.log(JSON.stringify({ event: 'oura_reconciliation_completed', ...result }));
    return response.status(result.failed > 0 ? 500 : 200).json(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'oura_reconciliation_failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(500).json({ error: 'Reconciliation failed.' });
  }
});

app.post('/admin/reexport', async (request, response) => {
  const date = String(request.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return response.status(400).json({ error: 'Use ?date=YYYY-MM-DD.' });
  }
  try {
    const state = await workflow.processDate(date);
    return response.status(200).json({ date: state.date, status: state.status });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'oura_manual_reexport_failed',
      date,
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(500).json({ error: 'Re-export failed.' });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(JSON.stringify({ event: 'worker_service_started', port })));
