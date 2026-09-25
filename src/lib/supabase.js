import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Check your .env file.');
}

// Spelled out rather than left to defaults: staying signed in across launches
// of the home-screen app depends on every one of these. The storage key is
// left at Supabase's default — changing it would sign everyone out once.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  }
);

// Ask the browser not to evict this origin's storage (where the session
// lives) under storage pressure. Installed apps are usually granted this
// silently; a refusal just leaves the default behaviour.
if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted()
    .then((already) => (already ? null : navigator.storage.persist()))
    .catch(() => {});
}
