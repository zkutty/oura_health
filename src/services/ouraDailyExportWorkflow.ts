import { GoogleDocsOuraPublisher } from './googleDocsOuraPublisher';
import { OuraExportService } from './ouraExportService';
import { OuraService } from './ouraService';
import { OuraWebhookEvent } from './ouraWebhookService';

export type OuraExportStatus = 'pending' | 'completed' | 'failed';

export interface OuraExportState {
  date: string;
  status: OuraExportStatus;
  missingSections: string[];
  lastEventType?: string;
  lastEventObjectId?: string;
  lastExportedAt?: string;
  lastError?: string;
  updatedAt: string;
}

export interface OuraExportStateStore {
  get(date: string): Promise<OuraExportState | undefined>;
  save(state: Omit<OuraExportState, 'updatedAt'>): Promise<OuraExportState>;
}

export class OuraDailyExportWorkflow {
  private static readonly REQUIRED_SECTIONS = ['sleep', 'readiness'] as const;

  constructor(
    private readonly ouraService: OuraService,
    private readonly exportService: OuraExportService,
    private readonly publisher: GoogleDocsOuraPublisher,
    private readonly stateStore: OuraExportStateStore
  ) {}

  async processEvent(event: OuraWebhookEvent): Promise<OuraExportState> {
    const date = await this.ouraService.getDayForWebhookObject(event.data_type, event.object_id);
    return this.processDate(date, {
      eventType: event.data_type,
      eventObjectId: event.object_id,
    });
  }

  async processDate(
    date: string,
    context: { eventType?: string; eventObjectId?: string } = {}
  ): Promise<OuraExportState> {
    let missingSections: string[] = [];
    try {
      const summary = await this.ouraService.getSummaryForDate(date);
      const record = this.exportService.toDailyExport(summary);
      missingSections = record.derived.missing_sections;
      const missingRequired = OuraDailyExportWorkflow.REQUIRED_SECTIONS.filter(section =>
        missingSections.includes(section)
      );

      if (missingRequired.length > 0) {
        const state = await this.stateStore.save({
          date,
          status: 'pending',
          missingSections,
          lastEventType: context.eventType,
          lastEventObjectId: context.eventObjectId,
        });
        console.log(JSON.stringify({
          event: 'oura_export_pending',
          date,
          missingRequired,
          missingSections,
        }));
        return state;
      }

      const published = await this.publisher.publish(record);
      if (!published) throw new Error('Google Docs Oura publisher is not configured.');

      const state = await this.stateStore.save({
        date,
        status: 'completed',
        missingSections,
        lastEventType: context.eventType,
        lastEventObjectId: context.eventObjectId,
        lastExportedAt: new Date().toISOString(),
      });
      console.log(JSON.stringify({
        event: 'oura_export_completed',
        date,
        updated: published.updated,
        missingSections,
      }));
      return state;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown export failure';
      await this.stateStore.save({
        date,
        status: 'failed',
        missingSections,
        lastEventType: context.eventType,
        lastEventObjectId: context.eventObjectId,
        lastError: message,
      });
      throw error;
    }
  }

  async reconcile(days = 7): Promise<{ processed: number; completed: number; pending: number; failed: number; skipped: number }> {
    let processed = 0;
    let completed = 0;
    let pending = 0;
    let failed = 0;
    let skipped = 0;

    for (const date of recentCalendarDates(days)) {
      const existing = await this.stateStore.get(date);
      if (existing?.status === 'completed' && existing.missingSections.length === 0) {
        skipped++;
        continue;
      }

      try {
        const result = await this.processDate(date);
        processed++;
        if (result.status === 'completed') completed++;
        else pending++;
      } catch (error) {
        processed++;
        failed++;
        console.error(JSON.stringify({
          event: 'oura_reconciliation_day_failed',
          date,
          message: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    }

    return { processed, completed, pending, failed, skipped };
  }
}

function recentCalendarDates(days: number): string[] {
  const dates: string[] = [];
  for (let offset = 1; offset <= days; offset++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    dates.push(date.toISOString().split('T')[0]);
  }
  return dates;
}
