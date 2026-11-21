// Zip 81 (🎾81.venue hours): saving the venue hours. Settings > Schedule > Special venue hours. Organizer only (a read-only PIN is refused
// by the usual guard before any of this runs).
//  - Everything lives in the group's settings_json under `venueHours` ({ normal, specials }): no table, no migration. The general Settings
//    save keeps it untouched (server/admin.ts updateGroup); only these three routes change it.
//  - Each save is read, changed and written in ONE guarded statement (the write lands only if settings_json is still what was read), so two
//    phones saving at once never lose an entry: the second is told to look again.
//  - Entries whose last date has passed are dropped on every save (they already left the list the day after their last date).
//  - The rules for a date (shared/bookingHours.ts dayRule) and the checks (shared/venueHours.ts readSpecial / readWeek) are shared with the
//    screens, so the screen and the server always agree.
import type { Ctx } from './context';
import { newId } from './crypto';
import { HttpError } from './http';
import { requireAdmin } from './auth';
import { audit, type GroupRow } from './repo';
import { dateKeyOf, isDefaultWeek, type SpecialHours, type VenueHoursConfig, venueHoursOf } from '../shared/bookingHours';
import { readSpecial, readWeek, specialLines, weekWords } from '../shared/venueHours';

const lookAgain = () => new HttpError(409, 'venue_hours_changed', 'The hours just changed on another phone. Look again.');

/** The new settings_json with these hours (expired entries dropped), every other key kept. */
function withHours(settingsJson: string | null, config: VenueHoursConfig, today: string): string {
  let obj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(settingsJson || '{}');
    if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
  } catch {
    obj = {};
  }
  const specials = config.specials.filter((e) => e.to >= today);
  const venueHours: Record<string, unknown> = { specials };
  if (!isDefaultWeek(config.normal)) venueHours.normal = config.normal;
  return JSON.stringify({ ...obj, venueHours });
}

async function write(ctx: Ctx, group: GroupRow, config: VenueHoursConfig, today: string): Promise<VenueHoursConfig> {
  const next = withHours(group.settings_json, config, today);
  const res = await ctx.db.prepare('UPDATE groups SET settings_json = ? WHERE id = ? AND settings_json IS ?').bind(next, group.id, group.settings_json).run();
  if ((res.meta?.changes ?? 0) !== 1) throw lookAgain();
  return venueHoursOf(next);
}

const when = (e: SpecialHours) => {
  const l = specialLines(e);
  return `${l.dates} · ${l.closed ? 'Closed' : l.hours}`;
};

/** POST /api/admin/venue-hours/special: add an entry, or change one (`id`). */
export async function saveSpecialHours(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const today = dateKeyOf(ctx.nowMs, group.timezone);
  const config = venueHoursOf(group.settings_json);
  const editing = typeof body.id === 'string' && body.id ? body.id : null;
  if (editing && !config.specials.some((e) => e.id === editing && e.to >= today)) throw lookAgain();
  const others = config.specials.filter((e) => e.id !== editing);
  const r = readSpecial(body, others, today, editing ?? newId().slice(0, 12));
  if (!r.ok) throw new HttpError(400, 'invalid_venue_hours', r.message);
  const specials = editing ? config.specials.map((e) => (e.id === editing ? r.value : e)) : [...config.specials, r.value];
  const saved = await write(ctx, group, { ...config, specials }, today);
  await audit(ctx.db, group.id, null, editing ? 'venue_hours_changed' : 'venue_hours_added', { entry: r.value.name, when: when(r.value) }, ctx.nowIso);
  return { ok: true, id: r.value.id, venueHours: saved };
}

/** POST /api/admin/venue-hours/remove { id }. Removing one that is already gone changes nothing. */
export async function removeSpecialHours(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const today = dateKeyOf(ctx.nowMs, group.timezone);
  const config = venueHoursOf(group.settings_json);
  const gone = config.specials.find((e) => e.id === body.id);
  if (!gone) return { ok: true, changed: false, venueHours: { ...config, specials: config.specials.filter((e) => e.to >= today) } };
  const saved = await write(ctx, group, { ...config, specials: config.specials.filter((e) => e.id !== gone.id) }, today);
  await audit(ctx.db, group.id, null, 'venue_hours_removed', { entry: gone.name }, ctx.nowIso);
  return { ok: true, changed: true, venueHours: saved };
}

/** PUT /api/admin/venue-hours/normal { week }: the normal week (index 0 = Sunday). */
export async function saveNormalHours(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const today = dateKeyOf(ctx.nowMs, group.timezone);
  const r = readWeek(body.week);
  if (!r.ok) throw new HttpError(400, 'invalid_venue_hours', r.message);
  const config = venueHoursOf(group.settings_json);
  const saved = await write(ctx, group, { ...config, normal: r.value }, today);
  await audit(ctx.db, group.id, null, 'venue_hours_normal', { when: weekWords(r.value) }, ctx.nowIso);
  return { ok: true, venueHours: saved };
}
