// Types for deploy-export.mjs, so tests can use it.
export type Runner = (args: string[]) => string;
export declare const DB: string;
export declare const PIECE_CHARS: number;
export declare const KEEP_EXPORTS: number;
export declare const SCHEMA: string[];
export declare function pieces(text: string, size?: number): string[];
export declare function looksLikeExport(text: string): boolean;
export declare function saveSql(text: string, fileName: string, note: string | null, id: string, savedAt: string): string;
export declare function joinExport(header: { parts: number; chars: number }, parts: { part: number; data: string }[]): string;
export declare const npxRunner: Runner;
export declare function save(run: Runner, file: string, note?: string | null, now?: Date): { id: string; chars: number; parts: number };
