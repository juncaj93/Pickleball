// Types for deploy.mjs (the Zip 28 deploy guard), so tests can use it.
export declare function decide(
  mode: 'production' | 'preview',
  git: { branch: string | null; dirty: boolean },
): { ok: boolean; branch?: string; warn?: string; message?: string };
