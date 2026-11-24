import type { ServerTimePayload } from '../src/types.ts';

export interface AcademicPeriodWindow {
  periodNumber: number;
  label: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  startMin: number;
  endMin: number;
}

export const ACADEMIC_PERIODS: AcademicPeriodWindow[] = [
  { periodNumber: 1, label: 'Period 1', startTime: '08:45', endTime: '09:35', startMin: 525, endMin: 575 },
  { periodNumber: 2, label: 'Period 2', startTime: '09:35', endTime: '10:25', startMin: 575, endMin: 625 },
  { periodNumber: 3, label: 'Period 3', startTime: '10:40', endTime: '11:30', startMin: 640, endMin: 690 },
  { periodNumber: 4, label: 'Period 4', startTime: '11:30', endTime: '12:20', startMin: 690, endMin: 740 },
  { periodNumber: 5, label: 'Period 5', startTime: '13:15', endTime: '14:05', startMin: 795, endMin: 845 },
  { periodNumber: 6, label: 'Period 6', startTime: '14:05', endTime: '14:55', startMin: 845, endMin: 895 },
  { periodNumber: 7, label: 'Period 7', startTime: '15:05', endTime: '15:55', startMin: 905, endMin: 955 },
  { periodNumber: 8, label: 'Period 8', startTime: '15:55', endTime: '16:45', startMin: 955, endMin: 1005 },
];

export const VALID_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'Asia/Singapore',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
];

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function computeServerTimeStatus(
  academicTimezone: string,
  departmentName: string,
  now: Date = new Date()
): ServerTimePayload {
  const safeTz = isValidTimezone(academicTimezone) ? academicTimezone : 'Asia/Kolkata';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const isoParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const getIso = (type: string) => isoParts.find((p) => p.type === type)?.value ?? '';
  const weekday = getPart('weekday');
  const day = getPart('day');
  const month = getPart('month');
  const year = getPart('year');
  const isoDate = `${getIso('year')}-${getIso('month')}-${getIso('day')}`;
  const hourNum = Number(getPart('hour')) % 24;
  const minuteNum = Number(getPart('minute'));
  const secondNum = Number(getPart('second'));

  const pad = (n: number) => String(n).padStart(2, '0');
  const formattedDate = `${weekday}, ${day} ${month} ${year}`;
  const formattedTime = `${pad(hourNum)}:${pad(minuteNum)}:${pad(secondNum)}`;
  const minutesSinceMidnight = hourNum * 60 + minuteNum;

  const isAcademicDay = weekday !== 'Sunday';

  let activePeriod: ServerTimePayload['activePeriod'] = null;
  let nextPeriod: ServerTimePayload['nextPeriod'] = null;
  let scheduleState: ServerTimePayload['scheduleState'] = 'weekend';

  if (isAcademicDay) {
    const active = ACADEMIC_PERIODS.find(
      (p) => minutesSinceMidnight >= p.startMin && minutesSinceMidnight < p.endMin
    );
    const upcoming = ACADEMIC_PERIODS.find((p) => p.startMin > minutesSinceMidnight);

    if (active) {
      activePeriod = {
        periodNumber: active.periodNumber,
        label: active.label,
        startTime: active.startTime,
        endTime: active.endTime,
        minutesRemaining: Math.max(1, active.endMin - minutesSinceMidnight),
      };
      scheduleState = 'in_session';
    } else if (minutesSinceMidnight < ACADEMIC_PERIODS[0].startMin) {
      scheduleState = 'before_hours';
    } else if (minutesSinceMidnight >= ACADEMIC_PERIODS[ACADEMIC_PERIODS.length - 1].endMin) {
      scheduleState = 'after_hours';
    } else {
      scheduleState = 'break';
    }

    if (upcoming) {
      nextPeriod = {
        periodNumber: upcoming.periodNumber,
        label: upcoming.label,
        startTime: upcoming.startTime,
        endTime: upcoming.endTime,
        startsInMinutes: upcoming.startMin - minutesSinceMidnight,
      };
    }
  }

  return {
    serverUtcIso: now.toISOString(),
    serverEpochMs: now.getTime(),
    academicTimezone: safeTz,
    departmentName,
    isoDate,
    formattedDate,
    formattedTime,
    weekday,
    minutesSinceMidnight,
    isAcademicDay,
    activePeriod,
    nextPeriod,
    scheduleState,
  };
}
