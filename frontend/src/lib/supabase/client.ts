import { createBrowserClient } from "@supabase/ssr";

function sanitizeSupabaseUrl(url: string): string {
  return url.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

export function createClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!rawUrl || !key) {
    throw new Error(
      "Supabase is not connected yet. Add the project URL and anon key to frontend/.env.local."
    );
  }

  const url = sanitizeSupabaseUrl(rawUrl);

  return createBrowserClient(url, key);
}

