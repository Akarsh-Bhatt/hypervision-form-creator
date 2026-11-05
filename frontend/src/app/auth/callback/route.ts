import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function sanitizeSupabaseUrl(url: string): string {
  return url.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

function getSafeRedirectPath(nextParam: string | null): string {
  if (!nextParam) return "/dashboard";
  // Must start with a single slash, not protocol-relative (//), and contain no backslashes
  if (!nextParam.startsWith("/") || nextParam.startsWith("//") || nextParam.includes("\\")) {
    return "/dashboard";
  }
  return nextParam;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeRedirectPath(searchParams.get("next"));

  if (code) {
    const cookieStore = await cookies();
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
    const url = sanitizeSupabaseUrl(rawUrl);

    const supabase = createServerClient(
      url,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignore if called from route handler
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Return the user to the landing page with an error parameter
  return NextResponse.redirect(`${origin}/?error=Could+not+authenticate+user`);
}
