// Types for check-file-names.mjs (the Zip 28 Mac build check), so tests can use it.
export declare function trackedFiles(root: string): string[];
export declare function findNameProblems(files: string[], read: (file: string) => string): string[];
