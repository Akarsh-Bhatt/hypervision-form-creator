"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, ensureWorkspaceSession } from "@/lib/supabase/client";
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

export default function DashboardPage() {
  const router = useRouter();
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingForm, setCreatingForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft" | "closed">("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
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
        await ensureWorkspaceSession(supabase);

        const { data, error } = await supabase
          .from("forms")
          .select("*")
          .order("updated_at", { ascending: false });

        if (error) {
          console.error("Error loading forms:", error.message || error.details || error);
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
  }, []);

  async function handleCreateForm(templateType: "blank" | "csat" | "application" = "blank") {
    if (creatingForm) return;
    setCreatingForm(true);

    try {
      const supabase = createClient();
      await ensureWorkspaceSession(supabase);

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

      let creatorId = "1b76768f-2ddc-4ca4-9478-76a48a4b0f62";
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) creatorId = session.user.id;
      } catch {
        // ignore
      }

      const { data, error } = await supabase
        .from("forms")
        .insert({
          creator_id: creatorId,
          title: initialTitle,
          description: initialDesc,
          shareable_slug: slug,
          status: "draft",
        })
        .select()
        .single();

      if (error) throw error;
      router.push(`/editor/${data.id}`);
    } catch (err: any) {
      console.error("Create form error:", err?.message || err?.details || err);
      alert(err?.message ? `Failed to create form: ${err.message}` : "Failed to create new form. Please try again.");
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
              Loading Workspace...
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
            </div>
          </header>

          {/* MAIN CONTENT CONTAINER */}
          <main className="relative z-10 pt-20 pb-16 flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-7">
            {/* Top Action & Greeting Row */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-6 pt-2">
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl lg:text-3xl text-slate-50 tracking-tight font-bold">
                  Hypervision <span className="text-sky-400">Workspace</span>
                </h1>
              </div>

              <div className="flex items-center gap-2.5 sm:gap-3 w-full lg:w-auto">
                {/* Search Field */}
                <div className="relative flex items-center flex-1 min-w-0 sm:w-72 md:w-80 sm:flex-initial">
                  <svg
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7.5" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-11 bg-[#111827]/80 backdrop-blur-md border border-slate-800 text-slate-200 placeholder-slate-500 text-sm pl-10 pr-4 rounded-xl shadow-sm focus:outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/40 transition-colors"
                    placeholder="Search forms..."
                    type="text"
                  />
                </div>

                {/* New Form Button */}
                <button
                  onClick={() => handleCreateForm("blank")}
                  disabled={creatingForm}
                  className="h-11 px-5 sm:px-6 bg-sky-500 hover:bg-sky-400 active:bg-sky-300 text-slate-950 font-bold text-sm rounded-xl flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap shadow-md shadow-sky-500/20 hover:shadow-sky-500/30 transition-all cursor-pointer disabled:opacity-60 active:scale-[0.98]"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px] leading-none">add</span>
                  <span>{creatingForm ? "Creating..." : "New Form"}</span>
                </button>
              </div>
            </div>

            {/* Executive Metric Cards */}
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
                  <span className="text-[11px] text-slate-400 font-mono">Active intake</span>
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
                </div>

                {/* View Switcher Icons */}
                <div className="flex items-center gap-1 border-l border-slate-800 pl-3">
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
                                className="w-6 h-6 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                                onClick={() => setOpenMenuId(menuOpen ? null : form.id)}
                                type="button"
                                title="Options"
                              >
                                <span className="material-symbols-outlined text-[18px] leading-none">more_vert</span>
                              </button>

                              {menuOpen && (
                                <div className="absolute right-0 top-7 w-32 bg-[#0f172a] border border-slate-800 rounded-lg shadow-2xl py-1 z-30 flex flex-col text-xs animate-in fade-in zoom-in-95 duration-100">
                                  <button
                                    onClick={() => handleRenameForm(form)}
                                    className="px-3 py-1.5 text-left text-slate-300 hover:bg-slate-800/80 hover:text-white transition-colors cursor-pointer flex items-center gap-2"
                                  >
                                    <span className="material-symbols-outlined text-[15px] text-slate-400">drive_file_rename_outline</span>
                                    <span>Rename</span>
                                  </button>
                                  <div className="h-px bg-slate-800 my-1" />
                                  <button
                                    onClick={() => handleDeleteForm(form.id, form.title)}
                                    className="px-3 py-1.5 text-left text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 transition-colors cursor-pointer flex items-center gap-2"
                                  >
                                    <span className="material-symbols-outlined text-[15px] text-rose-400">delete</span>
                                    <span>Delete</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Form Title & Description */}
                          <Link href={`/editor/${form.id}`} className="block group-hover:text-sky-300 transition-colors">
                            <h2 className="text-base font-semibold text-slate-100 group-hover:text-sky-300 transition-colors line-clamp-1">
                              {form.title}
                            </h2>
                            <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed min-h-[2.5rem]">
                              {form.description || "No description provided."}
                            </p>
                          </Link>
                        </div>

                        {/* Metadata Footer and Direct Action Buttons */}
                        <div className="pt-4 mt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                          <span className="font-mono text-[11px] text-slate-400">
                            {formatTimeAgo(form.updated_at)}
                          </span>

                          <div className="flex items-center gap-2">
                            {/* Copy Public Link (if published) */}
                            {isPublished && (
                              <button
                                onClick={() => handleCopyShareLink(form.shareable_slug)}
                                title="Copy Public URL"
                                type="button"
                                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-sky-400 transition-colors cursor-pointer flex items-center justify-center"
                              >
                                <span className="material-symbols-outlined text-[18px]">share</span>
                              </button>
                            )}

                            {/* View Responses */}
                            <Link
                              href={`/responses/${form.id}`}
                              className="px-3 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-medium transition-colors"
                              title="View Responses"
                            >
                              Responses
                            </Link>

                            {/* Open in Editor */}
                            <Link
                              href={`/editor/${form.id}`}
                              className="px-3 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 hover:border-sky-500/40 text-[11px] font-medium transition-all"
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
                <div className="bg-[#111827]/75 backdrop-blur-xl border border-slate-800 rounded-xl overflow-hidden shadow-lg">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 bg-[#0f172a]/60 text-slate-400 font-mono uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-4">Title & Details</th>
                          <th className="py-3 px-4">Deployment</th>
                          <th className="py-3 px-4">Responses</th>
                          <th className="py-3 px-4">Last Updated</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {filteredForms.map((form) => {
                          const isPublished = form.status === "published";
                          const isClosed = form.status === "closed";

                          return (
                            <tr
                              key={form.id}
                              className="hover:bg-slate-800/30 transition-colors group"
                            >
                              <td className="py-3.5 px-4">
                                <Link
                                  href={`/editor/${form.id}`}
                                  className="font-semibold text-slate-100 hover:text-sky-300 text-sm block"
                                >
                                  {form.title}
                                </Link>
                                <span className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                                  {form.description || "No description provided."}
                                </span>
                              </td>
                              <td className="py-3.5 px-4">
                                <button
                                  type="button"
                                  onClick={() => handleToggleStatus(form)}
                                  disabled={togglingId === form.id}
                                  className="cursor-pointer transition hover:opacity-80"
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
                              </td>
                              <td className="py-3.5 px-4 font-mono text-slate-300">
                                <Link
                                  href={`/responses/${form.id}`}
                                  className="hover:text-sky-400 font-semibold inline-block"
                                >
                                  {form.response_count || 0}
                                </Link>
                              </td>
                              <td className="py-3.5 px-4 font-mono text-slate-400 text-[11px]">
                                {formatTimeAgo(form.updated_at)}
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <div className="inline-flex items-center justify-end gap-2">
                                  {isPublished && (
                                    <button
                                      onClick={() => handleCopyShareLink(form.shareable_slug)}
                                      className="p-1 rounded text-slate-400 hover:text-sky-400 transition-colors cursor-pointer"
                                      title="Copy Link"
                                      type="button"
                                    >
                                      <span className="material-symbols-outlined text-[17px]">share</span>
                                    </button>
                                  )}
                                  <Link
                                    href={`/responses/${form.id}`}
                                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
                                  >
                                    Responses
                                  </Link>
                                  <Link
                                    href={`/editor/${form.id}`}
                                    className="px-2.5 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 text-xs font-medium transition-all"
                                  >
                                    Edit
                                  </Link>
                                  <button
                                    onClick={() => handleRenameForm(form)}
                                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer"
                                    type="button"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    onClick={() => handleDeleteForm(form.id, form.title)}
                                    className="px-2.5 py-1 rounded bg-rose-950/30 hover:bg-rose-950/60 border border-rose-900/40 text-rose-300 text-xs transition-colors cursor-pointer"
                                    type="button"
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
              © 2026 HYPERVISION. ALL RIGHT RESERVED.
            </p>
          </footer>
        </>
      )}
    </div>
  );
}
