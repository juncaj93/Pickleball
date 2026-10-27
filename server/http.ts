export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function json(data: unknown, status = 200, extraHeaders: Record<string, string>[] = []): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  for (const h of extraHeaders) for (const [k, v] of Object.entries(h)) headers.append(k, v);
  return new Response(JSON.stringify(data), { status, headers });
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  sameSite: 'Strict' | 'Lax';
  secure: boolean;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/api',
    'HttpOnly',
    `SameSite=${opts.sameSite}`,
    `Max-Age=${opts.maxAgeSeconds}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('Content-Type') ?? '';
  if (!type.includes('application/json')) throw new HttpError(415, 'json_required', 'Send JSON.');
  const text = await req.text();
  if (text.length > 20_000) throw new HttpError(413, 'too_large', 'Request is too large.');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'bad_json', 'Could not read the request.');
  }
}
