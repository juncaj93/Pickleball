// A one-event calendar file (.ics). iPhones open it straight into
// Calendar's "Add Event" screen. Times are written in the group's own time
// zone (with its daylight-saving rules inside the file), so an iPhone shows
// "8:00 to 10:00 PM" and no second time in GMT.

import { DEFAULT_TIMEZONE, localParts } from './time';

function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 20261103T200000: the wall-clock time in the group's zone, no Z. */
function localStamp(iso: string, tz: string): string {
  const p = localParts(Date.parse(iso), tz);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}${two(p.month)}${two(p.day)}T${two(p.hour)}${two(p.minute)}${two(p.second)}`;
}

/** Standard and daylight UTC offsets (hours) for the US zones offered in Settings. */
const ZONES: Record<string, { std: number; dst?: number; stdName: string; dstName?: string }> = {
  'America/Detroit': { std: -5, dst: -4, stdName: 'EST', dstName: 'EDT' },
  'America/New_York': { std: -5, dst: -4, stdName: 'EST', dstName: 'EDT' },
  'America/Chicago': { std: -6, dst: -5, stdName: 'CST', dstName: 'CDT' },
  'America/Denver': { std: -7, dst: -6, stdName: 'MST', dstName: 'MDT' },
  'America/Phoenix': { std: -7, stdName: 'MST' },
  'America/Los_Angeles': { std: -8, dst: -7, stdName: 'PST', dstName: 'PDT' },
  'America/Anchorage': { std: -9, dst: -8, stdName: 'AKST', dstName: 'AKDT' },
  'Pacific/Honolulu': { std: -10, stdName: 'HST' },
};

function offset(hours: number): string {
  const sign = hours < 0 ? '-' : '+';
  return `${sign}${String(Math.abs(hours)).padStart(2, '0')}00`;
}

/** The zone's rules: daylight time from the 2nd Sunday in March to the 1st Sunday in November, 2:00 AM. */
function vtimezone(tz: string): string[] {
  const z = ZONES[tz] ?? ZONES[DEFAULT_TIMEZONE];
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tz}`];
  if (z.dst === undefined) {
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${offset(z.std)}`, `TZOFFSETTO:${offset(z.std)}`, `TZNAME:${z.stdName}`, 'END:STANDARD');
  } else {
    lines.push(
      'BEGIN:DAYLIGHT',
      'DTSTART:20070311T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      `TZOFFSETFROM:${offset(z.std)}`,
      `TZOFFSETTO:${offset(z.dst)}`,
      `TZNAME:${z.dstName}`,
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:20071104T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      `TZOFFSETFROM:${offset(z.dst)}`,
      `TZOFFSETTO:${offset(z.std)}`,
      `TZNAME:${z.stdName}`,
      'END:STANDARD',
    );
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

/** Escape text for an .ics field (commas, semicolons, backslashes, newlines). */
function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
}

export function sessionCalendar(input: {
  id: string;
  startsAt: string;
  endsAt: string;
  location: string;
  nowIso: string;
  timezone?: string;
}): string {
  const tz = input.timezone && ZONES[input.timezone] ? input.timezone : DEFAULT_TIMEZONE;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pickleball Bros//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...vtimezone(tz),
    'BEGIN:VEVENT',
    `UID:${input.id}@pickleball-club`,
    `DTSTAMP:${stamp(input.nowIso)}`,
    `DTSTART;TZID=${tz}:${localStamp(input.startsAt, tz)}`,
    `DTEND;TZID=${tz}:${localStamp(input.endsAt, tz)}`,
    'SUMMARY:Pickleball',
    `LOCATION:${esc(input.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
