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
 * instead of sharing one. Under load that exhausts the free tier's
 * tight Postgres connection limit, which manifests as intermittent
 * query failures and, in pooled/PgBouncer setups, occasionally
 * serving a connection that hadn't seen the latest committed data —
 * exactly the symptom of API responses lagging behind SQL Editor
 * results that this fix addresses.
 *
 * On Vercel, a module is evaluated once per cold start and then
 * reused for the lifetime of that serverless instance, so this
 * singleton naturally caps connection creation to "once per warm
 * instance" rather than "once per request".
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
      }
    );
  }
  return serviceClient;
}
