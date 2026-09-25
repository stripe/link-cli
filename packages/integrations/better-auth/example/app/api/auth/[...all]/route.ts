import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const { GET, POST } = toNextJsHandler(async (request) =>
  (await getAuth()).handler(request),
);
