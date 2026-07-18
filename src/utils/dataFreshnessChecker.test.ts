import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OuraDailySummary, OuraSleepData } from '../services/ouraService';
import { DataFreshnessChecker } from './dataFreshnessChecker';

const sleep = (bedtimeEnd: string): OuraSleepData => ({
  day: '2026-07-18',
  score: 82,
  total_sleep_duration: 28_800,
  deep_sleep_duration: 4_000,
  rem_sleep_duration: 6_000,
  light_sleep_duration: 18_800,
  bedtime_start: '2026-07-18T03:00:00.000Z',
  bedtime_end: bedtimeEnd,
  efficiency: 90,
});

describe('DataFreshnessChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T16:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('treats the exact 12-hour wake boundary as fresh', () => {
    expect(DataFreshnessChecker.isSleepDataFresh(sleep('2026-07-18T04:00:00.000Z'))).toBe(true);
  });

  it('rejects stale and future wake times', () => {
    expect(DataFreshnessChecker.isSleepDataFresh(sleep('2026-07-18T03:59:59.000Z'))).toBe(false);
    expect(DataFreshnessChecker.isSleepDataFresh(sleep('2026-07-18T16:00:01.000Z'))).toBe(false);
  });

  it('requires both sleep and readiness data for playlist generation', () => {
    const summary: OuraDailySummary = { date: '2026-07-18', sleep: sleep('2026-07-18T10:00:00.000Z') };
    expect(DataFreshnessChecker.isDataFreshForPlaylist(summary)).toBe(false);
    expect(DataFreshnessChecker.getDataFreshnessStatus(summary)).toBe('Missing readiness data');
  });

  it('accepts fresh sleep and same-day readiness', () => {
    const summary: OuraDailySummary = {
      date: '2026-07-18',
      sleep: sleep('2026-07-18T10:00:00.000Z'),
      readiness: { day: '2026-07-18', score: 80, temperature_deviation: 0 },
    };
    expect(DataFreshnessChecker.isDataFreshForPlaylist(summary)).toBe(true);
  });
});
