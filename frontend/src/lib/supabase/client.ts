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

let sessionInitPromise: Promise<any> | null = null;

export async function ensureWorkspaceSession(supabase: ReturnType<typeof createClient>) {
  if (typeof window === "undefined") return null;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) return session;

    if (!sessionInitPromise) {
      sessionInitPromise = (async () => {
        try {
          const { data } = await supabase.auth.signInWithPassword({
            email: "admin@gmail.com",
            password: "123456789",
          });
          return data?.session || null;
        } catch {
          return null;
        } finally {
          sessionInitPromise = null;
        }
      })();
    }

    return await sessionInitPromise;
  } catch {
    return null;
  }
}

