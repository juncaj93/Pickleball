// A one-event calendar file (.ics). iPhones open it straight into
// Calendar's "Add Event" screen.

function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
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
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pickleball Club//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${input.id}@pickleball-club`,
    `DTSTAMP:${stamp(input.nowIso)}`,
    `DTSTART:${stamp(input.startsAt)}`,
    `DTEND:${stamp(input.endsAt)}`,
    'SUMMARY:Pickleball',
    `LOCATION:${esc(input.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
