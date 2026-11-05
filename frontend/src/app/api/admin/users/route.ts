import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@gmail.com").toLowerCase();

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase admin configuration.");
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function verifyIsAdmin(): Promise<{ authorized: boolean; email?: string }> {
  try {
    const cookieStore = await cookies();
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!rawUrl || !anonKey) return { authorized: false };

    const supabase = createServerClient(rawUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !user.email) return { authorized: false };

    if (user.email.toLowerCase() === ADMIN_EMAIL) {
      return { authorized: true, email: user.email };
    }

    return { authorized: false };
  } catch {
    return { authorized: false };
  }
}

// GET: List pending account requests for the Admin
export async function GET() {
  const { authorized } = await verifyIsAdmin();
  if (!authorized) {
    return NextResponse.json(
      { error: "Access denied. Only the designated administrator can view user requests." },
      { status: 403 }
    );
  }

  try {
    const adminClient = getSupabaseAdmin();
    const {
      data: { users },
      error,
    } = await adminClient.auth.admin.listUsers({ perPage: 100 });

    if (error) throw error;

    // Filter for users whose accounts are NOT yet approved, excluding the admin
    const pendingUsers = users
      .filter((u) => {
        const email = (u.email || "").toLowerCase();
        if (email === ADMIN_EMAIL) return false;
        return u.app_metadata?.is_approved !== true;
      })
      .map((u) => ({
        id: u.id,
        email: u.email,
        display_name: u.user_metadata?.full_name || u.user_metadata?.name || null,
        created_at: u.created_at,
      }));

    return NextResponse.json({ pendingUsers });
  } catch (err: any) {
    console.error("List pending users error:", err);
    return NextResponse.json({ error: err?.message || "Failed to list users." }, { status: 500 });
  }
}

// POST: Approve or Reject a user request
export async function POST(request: Request) {
  const { authorized } = await verifyIsAdmin();
  if (!authorized) {
    return NextResponse.json(
      { error: "Access denied. Only the designated administrator can approve accounts." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { action, userId } = body;

    if (!userId || !action) {
      return NextResponse.json({ error: "Missing action or userId." }, { status: 400 });
    }

    const adminClient = getSupabaseAdmin();

    if (action === "approve") {
      const { error } = await adminClient.auth.admin.updateUserById(userId, {
        app_metadata: {
          is_approved: true,
          role: "user",
        },
        user_metadata: {
          is_approved: true,
        },
      });

      if (error) throw error;

      // Try updating profiles table as well if it exists
      try {
        await adminClient
          .from("profiles")
          .update({ is_approved: true, approved_at: new Date().toISOString() })
          .eq("id", userId);
      } catch {
        // Non-critical if table column doesn't exist
      }

      return NextResponse.json({ success: true, message: "User approved successfully." });
    } else if (action === "reject") {
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) throw error;

      try {
        await adminClient.from("profiles").delete().eq("id", userId);
      } catch {
        // Non-critical
      }

      return NextResponse.json({ success: true, message: "User request rejected." });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (err: any) {
    console.error("Admin user action error:", err);
    return NextResponse.json({ error: err?.message || "Failed to process action." }, { status: 500 });
  }
}

