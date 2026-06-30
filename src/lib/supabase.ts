import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

/**
 * Service-role client, created exactly once per server process and
 * reused across every call. This matters a lot on Supabase's free
 * tier: createClient() opens its own connection pool, so calling it
 * fresh inside every API route (as this used to do) meant each
 * request — and worse, each cron invocation — spun up its own pool
 * instead of sharing one.
 *
 * The `global.fetch` override below is the fix for a separate,
 * sneakier issue: @supabase/supabase-js calls the Supabase REST API
 * (PostgREST) using the platform's native fetch under the hood, and
 * Next.js 14's App Router patches global fetch to auto-cache GET
 * requests by default. Marking an API route `export const dynamic =
 * 'force-dynamic'` opts the *route* out of static generation, but it
 * does NOT reliably stop Next's fetch-level cache from memoizing the
 * Supabase client's internal HTTP calls — which is exactly how a
 * route can report a "fresh" timestamp on every request while still
 * silently returning data from a stale cached fetch underneath.
 * Passing `cache: 'no-store'` on every request this client makes
 * closes that gap entirely.
 */
let serviceClient: ReturnType<typeof createClient<Database>> | null = null;

export function createServiceClient() {
  if (!serviceClient) {
    serviceClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        // No realtime needed on the service-role server client — disabling
        // it avoids an unnecessary websocket connection per instance.
        realtime: { params: { eventsPerSecond: 1 } },
        global: {
          fetch: (input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, { ...init, cache: 'no-store' }),
        },
      }
    );
  }
  return serviceClient;
}
