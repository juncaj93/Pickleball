// Types for restore-backup.mjs, so tests can use it.
export declare const TABLES: string[];
export declare const READ_ONLY_REFUSED: string;
export declare function backupToSql(backup: unknown): string;
export declare function summaryLine(backup: unknown): string;
