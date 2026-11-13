// Types for deploy.mjs (the Zip 28 deploy guard, extended in Zip 35), so tests can use it.
export interface LiveFacts {
  relation: 'same' | 'behind' | 'diverged' | 'unknown';
  sha?: string;
  behind?: number;
  ships?: string[];
}
export interface ProductionChecks {
  nowMs?: number;
  overrideLoud?: boolean;
  needNetwork?: boolean;
  head?: string | null;
  remoteMain?: string | null;
  live?: LiveFacts;
}
export declare function decide(
  mode: 'production' | 'preview',
  git: { branch: string | null; dirty: boolean },
  checks?: ProductionChecks,
): { ok: boolean; branch?: string; warn?: string; message?: string; rule?: string; notes?: string[] };
export declare function loudHours(nowMs: number): { loud: boolean; label: string };
export declare function nextQuiet(nowMs: number): string;
export declare function liveShaFromList(text: string): string | null;
export declare function main(
  argv: string[],
  deps?: {
    git?: () => { branch: string | null; dirty: boolean };
    network?: () => { head?: string | null; remoteMain?: string | null; live?: LiveFacts };
    now?: () => number;
    run?: (cmd: string, args: string[]) => number;
    out?: (s: string) => void;
    err?: (s: string) => void;
  },
): number;
