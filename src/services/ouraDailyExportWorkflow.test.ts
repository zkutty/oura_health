import { describe, expect, it, vi } from 'vitest';
import { getEasternDate } from '../utils/easternSchedule';
import { GoogleDocsOuraPublisher } from './googleDocsOuraPublisher';
import {
  OuraDailyExportWorkflow,
  OuraExportState,
  OuraExportStateStore,
} from './ouraDailyExportWorkflow';
import { OuraExportService } from './ouraExportService';
import { OuraService } from './ouraService';

describe('OuraDailyExportWorkflow reconciliation cadence', () => {
  it('refreshes the current Eastern day while skipping completed historical days', async () => {
    const completed = (date: string): OuraExportState => ({
      date,
      status: 'completed',
      missingSections: [],
      updatedAt: new Date().toISOString(),
    });
    const store = {
      get: vi.fn(async (date: string) => completed(date)),
      save: vi.fn(),
    } as unknown as OuraExportStateStore;
    const workflow = new OuraDailyExportWorkflow(
      {} as OuraService,
      {} as OuraExportService,
      {} as GoogleDocsOuraPublisher,
      store
    );
    const processDate = vi.spyOn(workflow, 'processDate')
      .mockImplementation(async date => completed(date));

    const result = await workflow.reconcile(4);

    expect(processDate).toHaveBeenCalledTimes(1);
    expect(processDate).toHaveBeenCalledWith(getEasternDate(new Date()));
    expect(result).toEqual({ processed: 1, completed: 1, pending: 0, failed: 0, skipped: 3 });
  });
});
