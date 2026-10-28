// Cloudflare Pages Function: every /api/* request lands here.
import { handleApi } from '../../server/app';
import type { Env } from '../../server/db';

export const onRequest = (context: { request: Request; env: Env; waitUntil: (work: Promise<unknown>) => void }) =>
  // waitUntil lets a Telegram alert finish after the player's tap has its answer.
  handleApi(context.request, context.env, Date.now(), (work) => context.waitUntil(work));
