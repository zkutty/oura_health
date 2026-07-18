import { describe, expect, it, vi } from 'vitest';
import {
  PlaylistGenerationGuard,
  PlaylistGenerationState,
  PlaylistGenerationStateStore,
} from './playlistGenerationStateStore';

describe('PlaylistGenerationGuard', () => {
  it('persists success across fresh guard instances and skips same-day retries', async () => {
    const states = new Map<string, PlaylistGenerationState>();
    const store: PlaylistGenerationStateStore = {
      get: vi.fn(async date => states.get(date)),
      recordAttempt: vi.fn(async date => {
        const current = states.get(date);
        states.set(date, {
          date,
          status: 'pending',
          attempts: (current?.attempts || 0) + 1,
          updatedAt: new Date().toISOString(),
        });
      }),
      markGenerated: vi.fn(async date => {
        const current = states.get(date)!;
        states.set(date, { ...current, status: 'generated', updatedAt: new Date().toISOString() });
      }),
    };
    const firstInvocation = new PlaylistGenerationGuard(store, 5);
    expect(await firstInvocation.shouldAttempt('2026-07-18')).toBe(true);
    await firstInvocation.recordAttempt('2026-07-18');
    await firstInvocation.markGenerated('2026-07-18');

    const coldStartInvocation = new PlaylistGenerationGuard(store, 5);
    expect(await coldStartInvocation.shouldAttempt('2026-07-18')).toBe(false);
    expect(await coldStartInvocation.shouldAttempt('2026-07-19')).toBe(true);
  });
});
