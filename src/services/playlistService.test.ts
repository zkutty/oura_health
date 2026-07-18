import { describe, expect, it } from 'vitest';
import spotifyConfig from '../config/spotifyConfig.json';
import { OuraDailySummary } from './ouraService';
import { PlaylistService, PlaylistConfig } from './playlistService';
import { SpotifyService } from './spotifyService';

function determineEnergy(readiness: number, sleep: number) {
  const service = new PlaylistService({} as SpotifyService);
  service.loadConfig(spotifyConfig as PlaylistConfig);
  const summary = {
    date: '2026-07-18',
    readiness: { day: '2026-07-18', score: readiness, temperature_deviation: 0 },
    sleep: { day: '2026-07-18', score: sleep },
  } as OuraDailySummary;
  return (service as unknown as { determineEnergyLevel(value: OuraDailySummary): string }).determineEnergyLevel(summary);
}

describe('PlaylistService energy mapping', () => {
  it('enforces the very-high AND thresholds', () => {
    expect(determineEnergy(90, 90)).toBe('very_high');
    expect(determineEnergy(90, 89)).toBe('high');
  });

  it('accepts either high-energy OR threshold', () => {
    expect(determineEnergy(85, 60)).toBe('high');
    expect(determineEnergy(60, 85)).toBe('high');
  });

  it('falls back to very low below all thresholds', () => {
    expect(determineEnergy(20, 20)).toBe('very_low');
  });
});
