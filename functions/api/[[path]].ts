// Cloudflare Pages Function: every /api/* request lands here.
import { handleApi } from '../../server/app';
import type { Env } from '../../server/db';

export const onRequest = (context: { request: Request; env: Env }) => handleApi(context.request, context.env);
