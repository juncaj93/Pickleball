import { HttpError } from './http';

// Every request field is checked here before it touches the database.

function bad(field: string, message: string): never {
  throw new HttpError(400, `invalid_${field}`, message);
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function text(v: unknown, field: string, opts: { max: number; min?: number }): string {
  if (typeof v !== 'string') bad(field, `${field} is required.`);
  const s = v.trim();
  if (s.length < (opts.min ?? 1)) bad(field, `${field} is required.`);
  if (s.length > opts.max) bad(field, `${field} is too long (max ${opts.max}).`);
  if (CONTROL_CHARS.test(s)) bad(field, `${field} has invalid characters.`);
  return s;
}

export function optionalText(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  return text(v, field, { max });
}

export function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') bad(field, `${field} must be true or false.`);
  return v;
}

export function optionalBool(v: unknown, field: string, fallback: boolean): boolean {
  return v === undefined ? fallback : bool(v, field);
}

export function oneOf<T extends string>(v: unknown, field: string, options: readonly T[]): T {
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) bad(field, `${field} is not valid.`);
  return v as T;
}

export function id(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/.test(v)) bad(field, `${field} is not valid.`);
  return v;
}

export function pin(v: unknown, field = 'pin'): string {
  if (typeof v !== 'string' || !/^\d{6,12}$/.test(v)) bad(field, 'PIN must be 6 to 12 digits.');
  return v;
}

export function cents(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10_000_00) bad(field, `${field} must be between $0 and $10,000.`);
  return v;
}

/** Only http(s) links, so nothing like javascript: can end up in an href. */
export function optionalUrl(v: unknown, field: string): string | null {
  const s = optionalText(v, field, 500);
  if (s === null) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    bad(field, `${field} must be a full link starting with https://`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') bad(field, `${field} must start with https://`);
  return u.toString();
}

export function optionalPhone(v: unknown, field = 'phone'): string | null {
  const s = optionalText(v, field, 25);
  if (s === null) return null;
  if (!/^\+?[\d\s().-]{7,25}$/.test(s) || s.replace(/\D/g, '').length < 7) bad(field, 'Phone number looks wrong.');
  return s;
}

export function isoTime(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') bad(field, `${field} is not a valid time.`);
  const ms = Date.parse(v);
  if (Number.isNaN(ms) || !/^\d{4}-\d{2}-\d{2}T/.test(v)) bad(field, `${field} is not a valid time.`);
  return new Date(ms).toISOString();
}

export function playerName(v: unknown): string {
  return text(v, 'name', { max: 40 });
}
