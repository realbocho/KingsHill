import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const method = (init?.method ?? 'GET').toUpperCase();
          if (method === 'GET') {
            return fetch(input, { ...init, cache: 'no-store' });
          }
          return fetch(input, init);
        },
      },
    }
  );
}
