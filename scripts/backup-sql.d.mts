// Types for backup-sql.mjs.
export declare const TABLES: string[];
export declare function backupToSql(backup: unknown, columns?: Record<string, Set<string>>): string;
