import { describe, expect, it, vi } from 'vitest';
import { OuraService } from './ouraService';

describe('OuraService latest records', () => {
  it('selects the newest sleep record from an unsorted mocked HTTP response', async () => {
    const service = new OuraService();
    const get = vi.fn(async (url: string) => {
      if (url === '/usercollection/daily_sleep') {
        return { data: { data: [
          { day: '2026-07-18', score: 88 },
          { day: '2026-07-16', score: 70 },
          { day: '2026-07-17', score: 80 },
        ] } };
      }
      return { data: { data: [] } };
    });
    (service as unknown as { client: { get: typeof get } }).client.get = get;

    await expect(service.getLatestSleep()).resolves.toMatchObject({ day: '2026-07-18', score: 88 });
    expect(get).toHaveBeenCalledWith('/usercollection/daily_sleep', { params: {} });
  });

  it('selects the newest readiness record from an unsorted mocked HTTP response', async () => {
    const service = new OuraService();
    const get = vi.fn().mockResolvedValue({ data: { data: [
      { day: '2026-07-17', score: 80 },
      { day: '2026-07-18', score: 90 },
      { day: '2026-07-16', score: 70 },
    ] } });
    (service as unknown as { client: { get: typeof get } }).client.get = get;

    await expect(service.getLatestReadiness()).resolves.toMatchObject({ day: '2026-07-18', score: 90 });
  });

  it('derives a real ISO summary date from the newest readiness record', async () => {
    const service = new OuraService();
    const get = vi.fn(async (url: string) => {
      const recordsByUrl: Record<string, object[]> = {
        '/usercollection/daily_sleep': [
          { day: '2026-07-17', score: 70 },
          { day: '2026-07-18', score: 88 },
        ],
        '/usercollection/sleep': [],
        '/usercollection/daily_readiness': [
          { day: '2026-07-16', score: 65 },
          { day: '2026-07-18', score: 91 },
        ],
        '/usercollection/daily_activity': [{ day: '2026-07-17', score: 76 }],
        '/usercollection/daily_resilience': [],
      };
      return { data: { data: recordsByUrl[url] || [] } };
    });
    (service as unknown as { client: { get: typeof get } }).client.get = get;

    await expect(service.getLatestSummary()).resolves.toMatchObject({
      date: '2026-07-18',
      sleep: { day: '2026-07-18', score: 88 },
      readiness: { day: '2026-07-18', score: 91 },
      activity: undefined,
    });
  });
});
