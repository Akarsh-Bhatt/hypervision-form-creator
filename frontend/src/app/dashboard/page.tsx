"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AsciiRainBackdrop from "@/components/AsciiRainBackdrop";

type Form = {
  id: string;
  creator_id: string;
  shareable_slug: string;
  title: string;
  description: string;
  status: "draft" | "published" | "closed";
  response_count: number;
  created_at: string;
  updated_at: string;
};

type PendingUser = {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userFullName, setUserFullName] = useState<string | null>(null);
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [showApprovalsModal, setShowApprovalsModal] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingForm, setCreatingForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft" | "closed">("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [signingOut, setSigningOut] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut Ctrl+K / Cmd+K to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close menus on outside click
  useEffect(() => {
    function handleGlobalClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-dropdown]")) {
        setOpenMenuId(null);
      }
    }
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  // Initial Data Fetch
  useEffect(() => {
    async function initDashboard() {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          router.push("/");
          return;
        }

        const user = session.user;
        const email = (user.email || "").toLowerCase();
        setUserEmail(user.email || null);

        const isDesignatedAdmin = email === "akarsh.bhatt2007@gmail.com";

        // Verify account approval status for non-admin users
        if (!isDesignatedAdmin) {
          const isApproved =
            user.app_metadata?.is_approved === true ||
            user.user_metadata?.is_approved === true;

          if (!isApproved) {
            try {
              const { data: profile } = await supabase
                .from("profiles")
                .select("is_approved")
                .eq("id", user.id)
                .maybeSingle();

              if (!profile?.is_approved) {
                await supabase.auth.signOut();
                router.push("/?error=pending_approval");
                return;
              }
            } catch {
              await supabase.auth.signOut();
              router.push("/?error=pending_approval");
              return;
            }
          }
        }

        // Retrieve real name
        if (isDesignatedAdmin) {
          setUserFullName("Akarsh");
        } else {
          const metaName =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.user_metadata?.display_name ||
            null;

          if (metaName && typeof metaName === "string" && metaName.trim()) {
            setUserFullName(metaName.trim());
          }
        }

        // Designated admin loads pending account approval requests via secure endpoint
        if (isDesignatedAdmin) {
          try {
            const res = await fetch("/api/admin/users");
            if (res.ok) {
              const json = await res.json();
              setPendingUsers(json.pendingUsers || []);
            }
          } catch (e) {
            console.error("Failed to fetch pending users:", e);
          }
        }

        const { data, error } = await supabase
          .from("forms")
          .select("*")
          .order("updated_at", { ascending: false });

        if (error) {
          console.error("Error loading forms:", error);
        } else {
          setForms(data || []);
        }
      } catch (err) {
        console.error("Dashboard error:", err);
      } finally {
        setLoading(false);
      }
    }

    initDashboard();
  }, [router]);

  async function handleCreateForm(templateType: "blank" | "csat" | "application" = "blank") {
    if (creatingForm) return;
    setCreatingForm(true);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.push("/");
        return;
      }

      const slug = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      let initialTitle = "Untitled Form";
      let initialDesc = "";

      if (templateType === "csat") {
        initialTitle = "Customer Feedback & CSAT Survey";
        initialDesc = "Quarterly net promoter survey gathering user sentiment, feature satisfaction, and churn signals.";
      } else if (templateType === "application") {
        initialTitle = "Official Membership Intake";
        initialDesc = "Applicant screening, project focus domain selection, and portfolio credentials.";
      }

      const { data, error } = await supabase
        .from("forms")
        .insert({
          creator_id: session.user.id,
          title: initialTitle,
          description: initialDesc,
          shareable_slug: slug,
          status: "draft",
        })
        .select()
        .single();

      if (error) throw error;
      router.push(`/editor/${data.id}`);
    } catch (err) {
      console.error("Create form error:", err);
      alert("Failed to create new form. Please try again.");
      setCreatingForm(false);
    }
  }

  async function handleDeleteForm(formId: string, formTitle: string) {
    const confirmed = window.confirm(`Are you sure you want to delete "${formTitle}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const supabase = createClient();
      const { error } = await supabase.from("forms").delete().eq("id", formId);
      if (error) throw error;
      setForms((prev) => prev.filter((f) => f.id !== formId));
      setOpenMenuId(null);
    } catch (err) {
      console.error("Delete form error:", err);
      alert("Failed to delete form.");
    }
  }

  async function handleToggleStatus(form: Form) {
    if (togglingId) return;
    setTogglingId(form.id);
    const nextStatus = form.status === "published" ? "draft" : "published";

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("forms")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", form.id);

      if (error) throw error;

      setForms((prev) =>
        prev.map((f) => (f.id === form.id ? { ...f, status: nextStatus, updated_at: new Date().toISOString() } : f))
      );
    } catch (err) {
      console.error("Status toggle error:", err);
      alert("Failed to update form status. Please try again.");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRenameForm(form: Form) {
    setOpenMenuId(null);
    const newTitle = window.prompt("Enter new form title:", form.title);
    if (!newTitle || newTitle.trim() === "" || newTitle === form.title) return;

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("forms")
        .update({ title: newTitle.trim(), updated_at: new Date().toISOString() })
        .eq("id", form.id);

      if (error) throw error;

      setForms((prev) =>
        prev.map((f) => (f.id === form.id ? { ...f, title: newTitle.trim() } : f))
      );
    } catch (err) {
      console.error("Rename form error:", err);
    }
  }

  function handleCopyShareLink(slug: string) {
    const url = `${window.location.origin}/f/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2500);
    setOpenMenuId(null);
  }

  async function handleApproveUser(userId: string) {
    if (approvingId) return;
    setApprovingId(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to approve user.");

      setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err: any) {
      console.error("Approve user error:", err);
      alert("Failed to approve user: " + (err?.message || "Unknown error"));
    } finally {
      setApprovingId(null);
    }
  }

  async function handleRejectUser(userId: string) {
    if (rejectingId) return;
    const confirmed = window.confirm(
      "Are you sure you want to reject and remove this account request?"
    );
    if (!confirmed) return;

    setRejectingId(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reject user.");

      setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err: any) {
      console.error("Reject user error:", err);
      alert("Failed to reject user: " + (err?.message || "Unknown error"));
    } finally {
      setRejectingId(null);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
    } catch (err) {
      console.error("Sign out error:", err);
      router.push("/");
    } finally {
      setSigningOut(false);
    }
  }

  const filteredForms = useMemo(() => {
    return forms.filter((form) => {
      const matchesSearch =
        form.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (form.description &&
          form.description.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus =
        statusFilter === "all" ? true : form.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [forms, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    const total = forms.length;
    const published = forms.filter((f) => f.status === "published").length;
    const drafts = forms.filter((f) => f.status === "draft").length;
    const closed = forms.filter((f) => f.status === "closed").length;
    return { total, published, drafts, closed };
  }, [forms]);

  function formatTimeAgo(dateString: string) {
    try {
      const now = new Date();
      const past = new Date(dateString);
      const diffMs = now.getTime() - past.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours < 1) return "Just now";
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 7) return `${diffDays}d ago`;
      return past.toLocaleDateString();
    } catch {
      return "Recently";
    }
  }

  function formatFallbackName(email: string | null): string {
    if (!email) return "Creator";
    const localPart = email.split("@")[0] || "Creator";
    return localPart
      .replace(/[._-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  const userName = userFullName || formatFallbackName(userEmail);

  function getUserInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  return (
    <div className="bg-[#090e1a] text-slate-100 antialiased selection:bg-sky-500/20 selection:text-sky-300 relative min-h-screen flex flex-col font-sans">
      {/* ASCII DIGITAL RAIN BACKDROP (Always active and visible) */}
      <AsciiRainBackdrop opacity={0.85} />

      {loading ? (
        <div className="flex-1 min-h-screen flex items-center justify-center relative z-10">
          <div className="flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-4xl text-sky-400 animate-spin">
              progress_activity
            </span>
            <p className="text-xs font-mono tracking-wider text-sky-300 uppercase">
              Loading Workspace Portal...
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* TOP FIXED NAVIGATION HEADER */}
          <header className="fixed top-0 left-0 right-0 h-16 bg-[#0b0f19]/80 backdrop-blur-md border-b border-slate-800/80 z-50 flex items-center justify-between px-6 lg:px-8">
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="flex items-center gap-3 group">
                <img
                  alt="Hypervision Logo"
                  className="w-10 h-10 sm:w-11 sm:h-11 object-contain bg-transparent shrink-0 group-hover:scale-105 transition-transform"
                  src="/hypervision-logo.png"
                />
                <span className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
                  Hypervision <span className="text-sky-400 font-bold">Forms</span>
                </span>
              </Link>
              <div className="h-4 w-px bg-slate-800 hidden sm:block" />
              <span className="text-xs font-mono text-slate-500 hidden md:inline-block">
                WORKSPACE PORTAL
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Admin Approvals Button (Visible only to designated admin Akarsh) */}
              {(userEmail || "").toLowerCase() === "akarsh.bhatt2007@gmail.com" && (
                <button
                  type="button"
                  onClick={() => setShowApprovalsModal(true)}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-[#0f172a]/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-all cursor-pointer shadow-sm"
                  title="Manage Account Approvals"
                >
                  <span className="material-symbols-outlined text-[17px] text-amber-400">admin_panel_settings</span>
                  <span className="hidden sm:inline">Admin Approvals</span>
                  {pendingUsers.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold animate-pulse">
                      {pendingUsers.length}
                    </span>
                  )}
                </button>
              )}

              {userName && (
                <div
                  className="flex items-center gap-2.5 pl-2 border-l border-slate-800"
                  title={userEmail ? `${userName} (${userEmail})` : userName}
                >
                  <div className="w-7 h-7 rounded-full bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-300 text-xs font-bold font-mono">
                    {getUserInitials(userName)}
                  </div>
                  <span className="hidden lg:inline text-xs font-semibold text-slate-200">
                    {userName}
                  </span>
                </div>
              )}

              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                title="Sign Out"
              >
                <span>{signingOut ? "Signing Out..." : "Sign Out"}</span>
              </button>
            </div>
          </header>

          {/* MAIN CONTENT CONTAINER */}
          <main className="relative z-10 pt-20 pb-16 flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-7">
            {/* Top Action & Greeting Row */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-6 pt-2">
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl lg:text-3xl text-slate-50 tracking-tight font-bold">
                  Welcome back, <span className="text-sky-400">{userName}</span>
                </h1>
                <p className="text-xs text-slate-400">
                  Innovate. Collaborate. Elevate. Intelligent data collection designed for high-velocity engineering teams.
                </p>
              </div>

              <div className="flex items-center gap-2.5 sm:gap-3 w-full lg:w-auto">
                {/* Search Field with Shortcut */}
                <div className="relative flex items-center flex-1 min-w-0 sm:w-72 md:w-80 sm:flex-initial">
                  <span className="material-symbols-outlined absolute left-3 text-[19px] text-slate-500 pointer-events-none">
                    search
                  </span>
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-11 bg-[#111827]/80 backdrop-blur-md border border-slate-800 text-slate-200 placeholder-slate-500 text-sm pl-9 sm:pl-10 pr-3 sm:pr-14 rounded-xl shadow-sm focus:outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/40 transition-colors"
                    placeholder="Search forms..."
                    type="text"
                  />
                  <div className="absolute right-3 hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-mono pointer-events-none">
                    <span>⌘</span>
                    <span>K</span>
                  </div>
                </div>

                {/* New Form Button */}
                <button
                  onClick={() => handleCreateForm("blank")}
                  disabled={creatingForm}
                  className="h-11 px-5 sm:px-6 bg-sky-500 hover:bg-sky-400 active:bg-sky-300 text-slate-950 font-bold text-sm rounded-xl flex items-center justify-center shrink-0 whitespace-nowrap shadow-md shadow-sky-500/20 hover:shadow-sky-500/30 transition-all cursor-pointer disabled:opacity-60 active:scale-[0.98]"
                  type="button"
                >
                  <span>{creatingForm ? "Creating..." : "New Form"}</span>
                </button>
              </div>
            </div>

            {/* Executive Metric Cards (Total Responses removed per user instruction) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Card 1: Total Forms */}
              <div className="bg-[#111827]/80 backdrop-blur-md border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span className="font-medium uppercase tracking-wider font-mono text-[11px]">Total Forms</span>
                  <span className="material-symbols-outlined text-sky-400 text-[20px]">dynamic_form</span>
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-slate-50">{stats.total}</span>
                  <span className="text-[11px] text-slate-400 font-mono">Configured schemas</span>
                </div>
              </div>

              {/* Card 2: Published / Live Forms */}
              <div className="bg-[#111827]/80 backdrop-blur-md border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span className="font-medium uppercase tracking-wider font-mono text-[11px]">Live / Published</span>
                  <span className="material-symbols-outlined text-emerald-400 text-[20px]">sensors</span>
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-emerald-400">{stats.published}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400/90">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active intake
                  </span>
                </div>
              </div>

              {/* Card 3: Drafts in Progress */}
              <div className="bg-[#111827]/80 backdrop-blur-md border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm sm:col-span-2 lg:col-span-1">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span className="font-medium uppercase tracking-wider font-mono text-[11px]">Drafts / Staging</span>
                  <span className="material-symbols-outlined text-amber-400 text-[20px]">edit_note</span>
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-amber-400">{stats.drafts}</span>
                  <span className="text-[11px] text-slate-400 font-mono">Unpublished changes</span>
                </div>
              </div>
            </div>

            {/* Central Workspace Layout */}
            <div className="flex flex-col gap-4">
              {/* Tab Bar & View Switcher */}
              <div className="flex items-center justify-between py-1 bg-[#111827]/70 backdrop-blur-xl border border-slate-800 px-3 py-2 rounded-lg">
                <div className="flex items-center gap-1.5 text-xs font-medium overflow-x-auto">
                  <button
                    onClick={() => setStatusFilter("all")}
                    className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                      statusFilter === "all"
                        ? "bg-slate-800 text-slate-100 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    All Forms ({forms.length})
                  </button>
                  <button
                    onClick={() => setStatusFilter("published")}
                    className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                      statusFilter === "published"
                        ? "bg-slate-800 text-emerald-400 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Live ({stats.published})
                  </button>
                  <button
                    onClick={() => setStatusFilter("draft")}
                    className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                      statusFilter === "draft"
                        ? "bg-slate-800 text-amber-400 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Drafts ({stats.drafts})
                  </button>
                  {stats.closed > 0 && (
                    <button
                      onClick={() => setStatusFilter("closed")}
                      className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                        statusFilter === "closed"
                          ? "bg-slate-800 text-slate-200 font-semibold"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Closed ({stats.closed})
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 bg-[#0b1220] p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`p-1.5 rounded-md transition-all cursor-pointer flex items-center justify-center ${
                      viewMode === "grid"
                        ? "bg-slate-800 text-sky-400 shadow-sm"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                    }`}
                    title="Grid View"
                    aria-label="Grid View"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">grid_view</span>
                  </button>
                  <button
                    onClick={() => setViewMode("table")}
                    className={`p-1.5 rounded-md transition-all cursor-pointer flex items-center justify-center ${
                      viewMode === "table"
                        ? "bg-slate-800 text-sky-400 shadow-sm"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                    }`}
                    title="Table View"
                    aria-label="Table View"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">table_rows</span>
                  </button>
                </div>
              </div>

              {/* Toast Notification when link copied */}
              {copiedSlug && (
                <div className="fixed bottom-12 right-6 z-50 bg-sky-500 text-slate-950 px-4 py-2 rounded-lg font-medium text-xs shadow-xl flex items-center gap-2 animate-bounce">
                  <span className="material-symbols-outlined text-sm">content_paste</span>
                  <span>Public link copied to clipboard!</span>
                </div>
              )}

              {/* Forms Grid or Table View or Empty State */}
              {filteredForms.length === 0 ? (
                <div className="bg-[#111827]/75 backdrop-blur-xl border border-slate-800 rounded-xl p-12 text-center shadow-lg">
                  <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mx-auto mb-3">
                    <span className="material-symbols-outlined text-2xl">description</span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-100">
                    {searchQuery || statusFilter !== "all"
                      ? "No matching intake schemas found"
                      : "No intake schemas created yet"}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    {searchQuery || statusFilter !== "all"
                      ? "Try adjusting your search criteria or clearing active filters."
                      : "Start collecting telemetry, feedback, and registrations with a new dynamic form."}
                  </p>
                  {!searchQuery && statusFilter === "all" && (
                    <button
                      onClick={() => handleCreateForm("blank")}
                      className="mt-5 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-medium text-xs transition-colors cursor-pointer"
                    >
                      <span>Create First Form</span>
                    </button>
                  )}
                </div>
              ) : viewMode === "grid" ? (
                /* FORMS GRID MODE */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredForms.map((form) => {
                    const isPublished = form.status === "published";
                    const isClosed = form.status === "closed";
                    const menuOpen = openMenuId === form.id;

                    return (
                      <div
                        key={form.id}
                        className="bg-[#111827]/75 backdrop-blur-xl border border-slate-800 hover:border-sky-500/40 rounded-xl p-5 transition-all flex flex-col justify-between group shadow-lg shadow-black/40 relative"
                      >
                        <div>
                          {/* Status Badge & More Options Menu */}
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(form)}
                              disabled={togglingId === form.id}
                              className="cursor-pointer transition hover:opacity-80"
                              title="Click to toggle status"
                            >
                              {isPublished ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  LIVE
                                </span>
                              ) : isClosed ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-800 border border-slate-700 text-slate-400">
                                  CLOSED
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-800 border border-slate-700 text-slate-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  DRAFT
                                </span>
                              )}
                            </button>

                            <div className="relative" data-dropdown>
                              <button
                                className="w-6 h-6 rounded hover:bg-slate-800 text-slate-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-mono font-bold"
                                onClick={() => setOpenMenuId(menuOpen ? null : form.id)}
                                type="button"
                                title="Options"
                              >
                                •••
                              </button>

                              {menuOpen && (
                                <div className="absolute right-0 mt-1 w-44 bg-slate-900 border border-slate-800 rounded-lg shadow-xl z-20 py-1 flex flex-col text-xs text-slate-300 animate-in fade-in zoom-in-95">
                                  <button
                                    onClick={() => handleRenameForm(form)}
                                    className="px-3 py-1.5 hover:bg-slate-800 text-left cursor-pointer"
                                  >
                                    Rename Title
                                  </button>
                                  <button
                                    onClick={() => handleToggleStatus(form)}
                                    className="px-3 py-1.5 hover:bg-slate-800 text-left cursor-pointer"
                                  >
                                    {isPublished ? "Set to Draft" : "Publish Form"}
                                  </button>
                                  {isPublished && (
                                    <button
                                      onClick={() => handleCopyShareLink(form.shareable_slug)}
                                      className="px-3 py-1.5 hover:bg-slate-800 text-left cursor-pointer"
                                    >
                                      Copy Public URL
                                    </button>
                                  )}
                                  <Link
                                    href={`/editor/${form.id}`}
                                    className="px-3 py-1.5 hover:bg-slate-800 text-left"
                                  >
                                    Builder Settings
                                  </Link>
                                  <div className="h-px bg-slate-800 my-1" />
                                  <button
                                    onClick={() => handleDeleteForm(form.id, form.title)}
                                    className="px-3 py-1.5 hover:bg-rose-950/40 text-left text-rose-400 cursor-pointer"
                                  >
                                    Delete Form
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Title & Description */}
                          <Link href={`/editor/${form.id}`} className="block">
                            <h2 className="text-base font-semibold text-slate-100 group-hover:text-sky-300 transition-colors line-clamp-1">
                              {form.title || "Untitled Form"}
                            </h2>
                          </Link>
                          <p className="text-xs text-slate-400 mt-1 line-clamp-2 min-h-[32px]">
                            {form.description || "No description configured."}
                          </p>

                          {/* Responses & Progress indicator */}
                          <div className="grid grid-cols-2 gap-2 mt-4 py-2.5 bg-slate-950/60 border border-slate-800/80 rounded-lg px-3">
                            <div>
                              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">
                                Submissions
                              </span>
                              <div className="font-mono text-base font-semibold text-slate-200">
                                {form.response_count}
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">
                                Status
                              </span>
                              <div className="font-mono text-base font-semibold capitalize text-sky-400">
                                {form.status}
                              </div>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden mt-3">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isPublished ? "bg-sky-500" : isClosed ? "bg-slate-600" : "bg-amber-500"
                              }`}
                              style={{
                                width: form.response_count > 0 ? `${Math.min(100, form.response_count * 10)}%` : isPublished ? "100%" : "30%",
                              }}
                            />
                          </div>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="mt-4 pt-3 flex items-center justify-between border-t border-slate-800/80">
                          <span className="text-[11px] text-slate-500 font-mono">
                            {formatTimeAgo(form.updated_at)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isPublished && (
                              <a
                                href={`/f/${form.shareable_slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700/80 text-slate-300 text-xs font-medium flex items-center justify-center transition-colors"
                                title="Open live public form"
                              >
                                View
                              </a>
                            )}
                            <Link
                              href={`/responses/${form.id}`}
                              className="h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700/80 text-slate-300 text-xs font-medium flex items-center justify-center transition-colors"
                            >
                              Responses
                            </Link>
                            <Link
                              href={`/editor/${form.id}`}
                              className="h-7 px-2.5 rounded bg-sky-500/10 border border-sky-500/30 hover:bg-sky-500/20 text-sky-400 text-xs font-medium flex items-center justify-center transition-colors"
                            >
                              Edit
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* FORMS TABLE MODE */
                <div className="bg-[#111827]/75 backdrop-blur-xl border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-semibold font-mono">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Form Title</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold">Submissions</th>
                          <th className="px-4 py-3 font-semibold">Intake State</th>
                          <th className="px-4 py-3 font-semibold">Last Modified</th>
                          <th className="px-4 py-3 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-slate-300">
                        {filteredForms.map((form) => {
                          const isPublished = form.status === "published";
                          const isClosed = form.status === "closed";

                          return (
                            <tr key={form.id} className="hover:bg-slate-800/40 transition-colors">
                              <td className="px-4 py-3">
                                <Link
                                  href={`/editor/${form.id}`}
                                  className="font-medium text-slate-200 hover:text-sky-300 transition-colors line-clamp-1"
                                >
                                  {form.title || "Untitled Form"}
                                </Link>
                                <div className="text-[11px] text-slate-500 font-mono line-clamp-1">
                                  /f/{form.shareable_slug}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {isPublished ? (
                                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                                    LIVE
                                  </span>
                                ) : isClosed ? (
                                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-800 border border-slate-700 text-slate-400">
                                    CLOSED
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-800 border border-slate-700 text-slate-400">
                                    DRAFT
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 font-mono text-slate-200">
                                {form.response_count}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sky-400 capitalize">
                                    {form.status}
                                  </span>
                                  <div className="w-16 bg-slate-800 h-1 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        isPublished ? "bg-sky-500" : isClosed ? "bg-slate-600" : "bg-amber-500"
                                      }`}
                                      style={{
                                        width: form.response_count > 0 ? `${Math.min(100, form.response_count * 10)}%` : isPublished ? "100%" : "30%",
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-400 font-mono">
                                {formatTimeAgo(form.updated_at)}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {isPublished && (
                                    <a
                                      href={`/f/${form.shareable_slug}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="px-2 py-1 rounded hover:bg-slate-800 text-slate-400 hover:text-sky-300 text-xs font-medium"
                                      title="View Public Form"
                                    >
                                      View
                                    </a>
                                  )}
                                  <Link
                                    href={`/responses/${form.id}`}
                                    className="px-2 py-1 rounded hover:bg-slate-800 text-slate-400 hover:text-sky-300 text-xs font-medium"
                                    title="Responses"
                                  >
                                    Responses
                                  </Link>
                                  <Link
                                    href={`/editor/${form.id}`}
                                    className="px-2 py-1 rounded hover:bg-slate-800 text-sky-400 text-xs font-medium"
                                    title="Edit"
                                  >
                                    Edit
                                  </Link>
                                  <button
                                    onClick={() => handleDeleteForm(form.id, form.title)}
                                    className="px-2 py-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 text-xs font-medium cursor-pointer"
                                    title="Delete"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* STATIC FOOTER */}
          <footer className="relative z-10 w-full py-4 border-t border-slate-800/80 bg-[#090e1a]/90 backdrop-blur-md text-center">
            <p className="text-[11px] font-mono text-slate-500 tracking-wider select-none">
              • © 2026 HYPERVISION. ALL RIGHT RESERVED.
            </p>
          </footer>

          {/* Admin Approvals Modal */}
          {showApprovalsModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
              <div className="bg-[#0b101b] border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl shadow-black relative overflow-hidden">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-white tracking-tight">
                        Account Access Approvals
                      </h2>
                      <p className="text-xs text-slate-400">
                        Only administrator-approved accounts are allowed to open the site.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowApprovalsModal(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                {pendingUsers.length === 0 ? (
                  <div className="text-center py-10 px-4 bg-[#080d17]/50 rounded-xl border border-slate-800/50">
                    <span className="material-symbols-outlined text-3xl text-emerald-400 mb-2">verified</span>
                    <h3 className="text-sm font-semibold text-white">No Pending Requests</h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                      All user registrations have been verified. Any newly requested accounts will appear here for your approval.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    {pendingUsers.map((pending) => (
                      <div
                        key={pending.id}
                        className="p-3.5 rounded-xl bg-[#0e1626] border border-slate-800 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">
                              {pending.display_name || "New Applicant"}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              Pending
                            </span>
                          </div>
                          <p className="text-xs font-mono text-slate-400 truncate mt-0.5">
                            {pending.email}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={approvingId === pending.id || rejectingId === pending.id}
                            onClick={() => handleApproveUser(pending.id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                          >
                            {approvingId === pending.id ? "Approving..." : "Approve as Admin"}
                          </button>
                          <button
                            type="button"
                            disabled={approvingId === pending.id || rejectingId === pending.id}
                            onClick={() => handleRejectUser(pending.id)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-rose-950/60 hover:border-rose-800 hover:text-rose-300 text-slate-400 text-xs font-medium transition-all cursor-pointer disabled:opacity-50"
                            title="Reject Request"
                          >
                            {rejectingId === pending.id ? "Rejecting..." : "Reject"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5 pt-3 border-t border-slate-800/80 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowApprovalsModal(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 cursor-pointer transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
