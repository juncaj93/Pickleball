// Zip 24 "Booking hours": the switch's names and the wrangler.toml kill switch. Their own file since Zip 81, so the player screen's script
// (src/lib.ts sends the private test header) never carries the venue hours code in shared/bookingHours.ts, which re-exports both.

export const BOOKING_HOURS = { task: 'booking_hours_on', header: 'X-Booking-Hours', link: 'bookinghours', env: 'BOOKING_HOURS', name: 'Booking hours' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function bookingHoursAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
