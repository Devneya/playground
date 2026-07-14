import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey: string = import.meta.env.VITE_SUPABASE_PUBLIC_KEY || "";

// Our backend is bare GoTrue behind HAProxy (rules strip a leading `/auth`
// but don't know about the extra `/v1` segment the SDK hardcodes onto every
// auth call), not Supabase's hosted gateway. Rewriting it here keeps the SDK
// and <Auth> widget working unmodified against the real routes.
const gotrueFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : (input as Request).url;
  return fetch(url.replace("/auth/v1/", "/auth/"), init);
};

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: gotrueFetch },
});

export { supabase };
