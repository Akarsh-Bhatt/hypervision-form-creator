import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function sanitizeSupabaseUrl(url: string): string {
  return url.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const protectedRoute =
    path.startsWith("/dashboard") ||
    path.startsWith("/editor") ||
    path.startsWith("/responses");

  const authRoute = path === "/";

  // Fast-path: Check for existence of Supabase auth session cookies
  const allCookies = request.cookies.getAll();
  const hasAuthCookie = allCookies.some(
    (c) =>
      c.name.startsWith("sb-") &&
      (c.name.includes("-auth-token") || c.name.includes("-provider-token"))
  );

  // 1. FAST ZERO-LATENCY REDIRECT: Protected route requested without auth cookie
  if (protectedRoute && !hasAuthCookie) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/";
    destination.searchParams.set("next", path);
    return NextResponse.redirect(destination);
  }

  // 2. FAST ZERO-LATENCY PASS: Unauthenticated user visiting landing auth page
  if (authRoute && !hasAuthCookie) {
    return NextResponse.next();
  }

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!rawUrl || !key) {
    return NextResponse.next();
  }

  const url = sanitizeSupabaseUrl(rawUrl);
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Verify auth user with a 2-second timeout to prevent any network hanging
  let user = null;
  try {
    const userPromise = supabase.auth.getUser();
    const timeoutPromise = new Promise<{ data: { user: null } }>((resolve) =>
      setTimeout(() => resolve({ data: { user: null } }), 2000)
    );
    const result = await Promise.race([userPromise, timeoutPromise]);
    user = result?.data?.user;
  } catch {
    user = null;
  }

  const userEmail = (user?.email || "").toLowerCase();
  const isDesignatedAdmin = userEmail === "akarsh.bhatt2007@gmail.com";
  const isApproved =
    isDesignatedAdmin ||
    user?.app_metadata?.is_approved === true ||
    user?.user_metadata?.is_approved === true;

  if (protectedRoute) {
    if (!user) {
      const destination = request.nextUrl.clone();
      destination.pathname = "/";
      destination.searchParams.set("next", path);

      const redirectResponse = NextResponse.redirect(destination);
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
      });

      return redirectResponse;
    }

    if (!isApproved) {
      const destination = request.nextUrl.clone();
      destination.pathname = "/";
      destination.searchParams.set("error", "pending_approval");

      const redirectResponse = NextResponse.redirect(destination);
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
      });

      return redirectResponse;
    }
  }

  if (authRoute && user && isApproved) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/dashboard";
    destination.search = "";

    const redirectResponse = NextResponse.redirect(destination);
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });

    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/editor/:path*", "/responses/:path*"],
};
