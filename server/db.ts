// The slice of Cloudflare D1's API this app uses. The production binding
// satisfies it directly; tests and local dev use a node:sqlite adapter.

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** Runs all statements in one transaction; any failure rolls back all of them. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface Env {
  DB: D1Database;
  /** One-time secret the organizer types into the setup page. */
  SETUP_TOKEN?: string;
  /** The public site address, e.g. https://pickleball.juncaj.net. Falls back to whatever address was used. */
  SITE_URL?: string;
  /**
   * Set only by the organizer's in-browser demo copy (src/demo/sandbox.ts),
   * never on Cloudflare: there, taps in "View as" really run, on a throwaway
   * copy of the data that lives in that browser tab.
   */
  SANDBOX?: boolean;
  /** Cloudflare secrets for the organizer's Telegram alerts. Never sent to a browser. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  /** Shared with the cron Worker (worker/cron.ts): only a caller that knows it can run the 5-minute alert tick. */
  CRON_SECRET?: string;
  /** "on": night-before alerts link to the direct text page (/go/...). Anything else: the admin link. A wrangler.toml var. */
  GO_LINKS?: string;
  /** "Time may shift" (tilde times, court borders, the Still in notice, Confirmed x of y): on unless "off". A wrangler.toml var. */
  TIME_SHIFT?: string;
  /** "Motion" (animations on the player screens): "on" for everyone; anything else is dark, except a phone with the private test switch. A wrangler.toml var. */
  MOTION?: string;
  /** "Motion" on the organizer screens: "on" switches it on; anything else is dark, except a phone with the private test switch. A wrangler.toml var. */
  MOTION_ADMIN?: string;
  /** "Ask for payment on every game": the kill switch, allowed unless "off". Who sees it: Settings, ?payalways=on, the demo (server/payAlways.ts). A wrangler.toml var. */
  PAY_ALWAYS?: string;
  /** "No Venmo? Pay Alex directly" note: the kill switch, allowed unless "off". Who sees it: Settings > Feature switches, ?paynote=on (server/payNote.ts). A wrangler.toml var. */
  PAY_NOTE?: string;
  /** "New admin layout" (organizer History, Money, Home v2): the kill switch, allowed unless "off". Who sees it: Settings > Feature switches, ?adminv2=on (server/adminV2.ts). A wrangler.toml var. */
  ADMIN_V2?: string;
  /** Tests only: a stand-in for fetch, so no real message is ever sent. */
  TELEGRAM_FETCH?: typeof fetch;
}

/** True when a write was rejected by one of the schema's RAISE(ABORT, ...) triggers. */
export function isTriggerError(err: unknown, code: 'session_full' | 'session_canceled'): boolean {
  return err instanceof Error && err.message.includes(code);
}
