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

// signInWithOAuth's redirect is a real browser navigation (window.location),
// not a fetch call, so gotrueFetch above never sees or rewrites it — it
// would otherwise send the browser straight to the broken /auth/v1/authorize
// path. skipBrowserRedirect defers the navigation to us so we can apply the
// same /v1 rewrite by hand before sending the user on their way.
export async function signInWithOAuthRedirect(provider: "google" | "github") {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    throw error ?? new Error(`no OAuth URL returned for provider ${provider}`);
  }
  window.location.href = data.url.replace("/auth/v1/", "/auth/");
}

export { supabase };
