import { NextRequest } from 'next/server';
import { ApiError } from '@/lib/api-helpers';

/**
 * Cron endpoints are public URLs (cron-job.org hits them over plain
 * HTTPS, no auth headers config on the free tier beyond query
 * params/custom headers). We guard them with a shared secret passed
 * either as a `secret` query param or `x-cron-secret` header, set in
 * CRON_SECRET. Without this, anyone who finds the URL could trigger
 * unlimited deposit scans or, worse, withdrawal processing.
 */
export function requireCronSecret(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    throw new ApiError('CRON_SECRET is not configured on the server', 500);
  }

  const fromHeader = req.headers.get('x-cron-secret');
  const fromQuery  = req.nextUrl.searchParams.get('secret');
  const provided = fromHeader || fromQuery;

  if (provided !== expected) {
    throw new ApiError('Unauthorized', 401);
  }
}
