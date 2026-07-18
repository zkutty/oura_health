export const AUTOMATION_TIME_ZONE = 'America/New_York';

export interface EasternScheduleTime {
  hour: number;
  minute: number;
}

export interface EasternScheduleRange {
  startHour: number;
  endHour: number;
  minute: number;
}

function getEasternTimeParts(timestamp: string | Date): EasternScheduleTime {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid schedule timestamp: ${String(timestamp)}`);
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AUTOMATION_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return { hour, minute };
}

export function isEasternScheduleTime(
  timestamp: string | Date,
  schedule: EasternScheduleTime
): boolean {
  const eastern = getEasternTimeParts(timestamp);
  return eastern.hour === schedule.hour && eastern.minute === schedule.minute;
}

export function isEasternScheduleRange(
  timestamp: string | Date,
  schedule: EasternScheduleRange
): boolean {
  const eastern = getEasternTimeParts(timestamp);
  return eastern.minute === schedule.minute
    && eastern.hour >= schedule.startHour
    && eastern.hour <= schedule.endHour;
}

export function getEasternDate(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid schedule timestamp: ${String(timestamp)}`);
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AUTOMATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
