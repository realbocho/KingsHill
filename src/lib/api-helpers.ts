import { NextResponse } from 'next/server';
import { logger, errorFields } from '@/lib/logger';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Wraps an API route handler with consistent error handling and
 * structured request logging. Any thrown ApiError becomes a clean
 * JSON response with the right status code; any other thrown error
 * is logged with full detail and returns a generic 500 to the client
 * (so internals are never leaked).
 */
export function withApiHandler<T extends unknown[]>(
  routeName: string,
  handler: (...args: T) => Promise<NextResponse>
) {
  return async (...args: T): Promise<NextResponse> => {
    const start = Date.now();
    try {
      const res = await handler(...args);
      logger.info('api_request', { route: routeName, status: res.status, ms: Date.now() - start });
      return res;
    } catch (err) {
      if (err instanceof ApiError) {
        logger.warn('api_error', { route: routeName, status: err.status, message: err.message, ms: Date.now() - start });
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      logger.error('api_unhandled_error', { route: routeName, ms: Date.now() - start, ...errorFields(err) });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}

/** Throws ApiError(400) if value is missing/falsy, narrows the type otherwise. */
export function requireField<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined || value === '') {
    throw new ApiError(`Missing required field: ${name}`, 400);
  }
  return value;
}

/** Validates a numeric amount is finite, positive, and within sane bounds. */
export function requireValidAmount(value: unknown, name = 'amount', max = 1_000_000): number {
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(num) || num <= 0) {
    throw new ApiError(`${name} must be a positive number`, 400);
  }
  if (num > max) {
    throw new ApiError(`${name} exceeds maximum allowed value`, 400);
  }
  return num;
}

/** Basic UUID v4 shape check — guards against malformed IDs hitting the DB. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireUuid(value: unknown, name = 'id'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ApiError(`Invalid ${name}`, 400);
  }
  return value;
}

export function tooManyRequests(limit: number): never {
  throw new ApiError(`Rate limit exceeded (max ${limit} per window). Please slow down.`, 429);
}
