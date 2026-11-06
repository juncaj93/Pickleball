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
  /** "Player screen small fixes, round 1" (Pay on tonight's card, roomier TONIGHT tag): the kill switch, allowed unless "off". Who sees it: Settings > Feature switches, ?playerfix1=on (server/playerFix1.ts). A wrangler.toml var. */
  PLAYER_FIX1?: string;
  /** "Pay sheet" (Pay opens a small bottom sheet): the kill switch, allowed unless "off". Who sees it: Settings > Feature switches, ?paysheet=on (server/paySheet.ts). A wrangler.toml var. */
  PAY_SHEET?: string;
  /** "New admin layout" (organizer History, Money, Home v2): the kill switch, allowed unless "off". Who sees it: Settings > Feature switches, ?adminv2=on (server/adminV2.ts). A wrangler.toml var. */
  ADMIN_V2?: string;
  /** "Admin screens, round 2" (organizer Home cards, Money, Players, History, header): the kill switch, allowed unless "off". Who sees it: Settings > Feature switches, ?adminr2=on (server/adminR2.ts). A wrangler.toml var. */
  ADMIN_R2?: string;
  /** "Admin screens, round 3" (organizer Edit game, Add game, Settings clean-up, Players layout): the kill switch, allowed unless "off". Who sees it: Settings > Feature switches, ?adminr3=on (server/adminR3.ts). Needs round 2 on too. A wrangler.toml var. */
  ADMIN_R3?: string;
  /** "Texts and Telegram alerts, round 2" (new prefilled texts, new alert wording and timing, the cancel sheet answering No): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, /admin?textsr2=on (server/textsR2.ts). A wrangler.toml var. */
  TEXTS_R2?: string;
  /** "Late drops owe $14": the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, ?latefees=on (server/lateFees.ts). A wrangler.toml var. Changes money. */
  LATE_FEES?: string;
  /** "Late-cancel fee split" (a fee-kept cancel inside 12 hours with 5 or more in prices like a played game): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, /admin?latefeesplit=on (server/lateFeeSplit.ts). A wrangler.toml var. */
  LATE_FEE_SPLIT?: string;
  /** "Money page rework" (the reworked Money page, Hide from list, Edit charge, cancel sheet default, tidier Feature switches and History): the kill switch, allowed unless "off". Who sees it: Settings > Feature switches, /admin?moneyrework=on (server/moneyRework.ts). A wrangler.toml var. */
  MONEY_REWORK?: string;
  /** "Instant taps" (the screen changes the instant a button is tapped, the save runs in the background, a failed save puts it back): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, ?instanttaps=on (server/instantTaps.ts). A wrangler.toml var. */
  INSTANT_TAPS?: string;
  /** "Adjust credit" (the organizer adds or removes credit on a player by hand, with a reason): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, /admin?adjustcredit=on (server/adjustCredit.ts). A wrangler.toml var. */
  ADJUST_CREDIT?: string;
  /** "Home collapse" (player Home shows only this week and next week; later games behind one "More sessions" button): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, /?homecollapse=on (server/homeCollapse.ts). A wrangler.toml var. */
  HOME_COLLAPSE?: string;
  /** "Tonight glow" (TONIGHT / TOMORROW tags on date tiles, a green glow on tonight's badge): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, ?tonightglow=on (server/zip7.ts). A wrangler.toml var. */
  TONIGHT_GLOW?: string;
  /** "Color cleanup" (one color system for the whole site): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, ?colorcleanup=on (server/zip7.ts). A wrangler.toml var. */
  COLOR_CLEANUP?: string;
  /** "Simpler player cards" (no court status words or dot, calendar icon only next to You're in): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, ?playercards=on (server/zip7.ts). A wrangler.toml var. */
  PLAYER_CARDS_SIMPLE?: string;
  /** "Venmo request" (a Venmo request link per person who owes, organizer screens): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, /admin?venmorequest=on (server/venmoRequest.ts). A wrangler.toml var. */
  VENMO_REQUEST?: string;
  /** "Last call texts" (the night-before Check-in and Need players words Alex asked for, Zip 8): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, /admin?lastcall=on (server/lastCall.ts). A wrangler.toml var. */
  LAST_CALL_TEXTS?: string;
  /** "Short games" (Zip 9, 1.5 hour games priced from shared/gameLength.ts): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, ?shortgames=on (server/zip9.ts). CHANGES MONEY for 1.5 hour games. */
  SHORT_GAMES?: string;
  /** "Card time and buttons" (Zip 9, time line under the date tile and the joined Calendar | Directions button): the kill switch. Who gets it: Settings > Feature switches, ?cardtime=on. Display only. */
  CARD_TIME_BUTTONS?: string;
  /** "Card cleanup" (Zip 10: cards without count text, people icon and names, tinted Later cards; no waitlist and no Max players cap): the kill switch, allowed unless "off". Who gets it: Settings > Feature switches, ?cardcleanup=on (server/zip10.ts). */
  CARD_CLEANUP?: string;
  /**
   * The read-only organizer PIN (Cloudflare secret, never in git): signs in to every organizer screen with every save refused.
   * Missing or not 6 to 12 digits = off (server/viewOnly.ts).
   */
  ORGANIZER_READONLY_PIN?: string;
  /** Tests only: a stand-in for fetch, so no real message is ever sent. */
  TELEGRAM_FETCH?: typeof fetch;
}

/** True when a write was rejected by one of the schema's RAISE(ABORT, ...) triggers. */
export function isTriggerError(err: unknown, code: 'session_full' | 'session_canceled'): boolean {
  return err instanceof Error && err.message.includes(code);
}
