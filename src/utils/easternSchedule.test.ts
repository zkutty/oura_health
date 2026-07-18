import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isEasternScheduleRange, isEasternScheduleTime } from './easternSchedule';

describe('Eastern automation scheduling', () => {
  it.each([
    ['2026-01-15T12:00:00.000Z', 7, 0],
    ['2026-07-15T11:00:00.000Z', 7, 0],
    ['2026-01-15T12:45:00.000Z', 7, 45],
    ['2026-07-15T11:45:00.000Z', 7, 45],
    ['2026-01-16T02:00:00.000Z', 21, 0],
    ['2026-07-16T01:00:00.000Z', 21, 0],
  ])('maps %s to %i:%i in New York', (timestamp, hour, minute) => {
    expect(isEasternScheduleTime(timestamp, { hour, minute })).toBe(true);
  });

  it('rejects the unused UTC offset in winter and summer', () => {
    expect(isEasternScheduleTime('2026-01-15T11:00:00.000Z', { hour: 7, minute: 0 })).toBe(false);
    expect(isEasternScheduleTime('2026-07-15T12:00:00.000Z', { hour: 7, minute: 0 })).toBe(false);
  });

  it('accepts retry hours from 8 AM through 1 PM Eastern', () => {
    expect(isEasternScheduleRange('2026-01-15T13:00:00.000Z', { startHour: 8, endHour: 13, minute: 0 })).toBe(true);
    expect(isEasternScheduleRange('2026-07-15T17:00:00.000Z', { startHour: 8, endHour: 13, minute: 0 })).toBe(true);
  });

  it('rejects retry invocations outside the Eastern window', () => {
    expect(isEasternScheduleRange('2026-01-15T12:00:00.000Z', { startHour: 8, endHour: 13, minute: 0 })).toBe(false);
    expect(isEasternScheduleRange('2026-07-15T18:00:00.000Z', { startHour: 8, endHour: 13, minute: 0 })).toBe(false);
  });

  it('rejects invalid timestamps', () => {
    expect(() => isEasternScheduleTime('not-a-date', { hour: 7, minute: 0 })).toThrow('Invalid schedule timestamp');
  });

  it('keeps EventBridge rules on both EST and EDT candidate offsets', () => {
    const serverlessConfig = readFileSync(resolve(process.cwd(), 'serverless.yml'), 'utf8');
    expect(serverlessConfig).toContain('cron(0 11,12 * * ? *)');
    expect(serverlessConfig).toContain('cron(45 11,12 * * ? *)');
    expect(serverlessConfig).toContain('cron(0 12-18 * * ? *)');
    expect(serverlessConfig).toContain('cron(0 1,2 * * ? *)');
  });
});
