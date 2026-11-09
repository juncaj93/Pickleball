// Types for weekly-backup.mjs, so tests can use it.
export declare function joinParts(header: { parts: number; bytes: number }, parts: { part: number; data: string }[]): any;
export declare function listLine(r: { week: string; created_at: string; parts: number; rows_json: string; have?: number }, when: (iso: string) => string): string;
export declare function unfinishedLine(u: { week: string; started_at: string; steps: number; done: number }, when: (iso: string) => string): string;
export declare const WEEK: RegExp;
