// Types for backup-sql.mjs.
export declare const TABLES: string[];
export declare const V2_TABLES: string[];
export declare const VERSIONS: number[];
export declare function isReadOnlyDownload(backup: unknown): boolean;
export declare function backupToSql(backup: unknown, columns?: Record<string, Set<string>>): string;
