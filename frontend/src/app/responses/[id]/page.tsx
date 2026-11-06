"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient, ensureWorkspaceSession } from "@/lib/supabase/client";
import AsciiRainBackdrop from "@/components/AsciiRainBackdrop";
import { parseScaleConfig } from "@/lib/scale";

type Form = {
  id: string;
  creator_id: string;
  shareable_slug: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
};

type Question = {
  id: string;
  form_id: string;
  field_key: string;
  question_type: string;
  label: string;
  order_index: number;
  options?: any[];
};

type FormResponse = {
  id: string;
  form_id: string;
  sap_id?: string;
  completion_time_seconds: number | null;
  submitted_at: string;
};

type FormAnswer = {
  response_id: string;
  question_id: string;
  answer_value: any;
};

export default function ResponsesPage() {
  const params = useParams();
  const router = useRouter();
  const formId = params.id as string;

  const [form, setForm] = useState<Form | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [answersMap, setAnswersMap] = useState<Record<string, Record<string, any>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState<FormResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"summary" | "table">("summary");
  const [lastSyncedTime, setLastSyncedTime] = useState<string>("Just now");

  function getOptionLabel(opt: any): string {
    if (typeof opt === "string") return opt;
    if (opt && typeof opt === "object") {
      return opt.label || opt.text || opt.title || opt.value || "";
    }
    return String(opt ?? "");
  }

  async function loadData(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const supabase = createClient();
      await ensureWorkspaceSession(supabase);

      // 1. Fetch Form
      const { data: formData, error: formError } = await supabase
        .from("forms")
        .select("*")
        .eq("id", formId)
        .single();

      if (formError || !formData) {
        router.push("/dashboard");
        return;
      }
      setForm(formData);

      // 2. Fetch Questions ordered
      const { data: questionData } = await supabase
        .from("form_questions")
        .select("id, form_id, field_key, question_type, label, order_index, options")
        .eq("form_id", formId)
        .order("order_index", { ascending: true });

      const qList = (questionData as Question[]) || [];
      setQuestions(qList);

      // 3. Fetch Responses
      const { data: responseData, error: respError } = await supabase
        .from("form_responses")
        .select("id, form_id, sap_id, completion_time_seconds, submitted_at")
        .eq("form_id", formId)
        .order("submitted_at", { ascending: false });

      if (respError) {
        console.error("Responses fetch error:", respError);
        return;
      }

      const rList = (responseData as FormResponse[]) || [];
      setResponses(rList);

      // 4. Fetch Answers for all responses in safe URL-safe batches
      if (rList.length > 0) {
        const responseIds = rList.map((r) => r.id);
        const BATCH_SIZE = 100;
        const batches: string[][] = [];
        for (let i = 0; i < responseIds.length; i += BATCH_SIZE) {
          batches.push(responseIds.slice(i, i + BATCH_SIZE));
        }

        const batchResults = await Promise.all(
          batches.map((batch) =>
            supabase
              .from("form_answers")
              .select("response_id, question_id, answer_value")
              .in("response_id", batch)
          )
        );

        const mapped: Record<string, Record<string, any>> = {};
        for (const res of batchResults) {
          if (!res.error && res.data) {
            for (const ans of res.data as FormAnswer[]) {
              if (!mapped[ans.response_id]) {
                mapped[ans.response_id] = {};
              }
              mapped[ans.response_id][ans.question_id] = ans.answer_value;
            }
          }
        }
        setAnswersMap(mapped);
      } else {
        setAnswersMap({});
      }

      setLastSyncedTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      console.error("Responses page error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (formId) {
      loadData();
    }
  }, [formId]);

  // Metric Computations
  const metrics = useMemo(() => {
    const total = responses.length;
    let avgDuration = "—";
    if (total > 0) {
      const times = responses
        .map((r) => r.completion_time_seconds)
        .filter((t): t is number => typeof t === "number" && t > 0);
      if (times.length > 0) {
        const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        if (avg < 60) avgDuration = `${avg}s`;
        else avgDuration = `${Math.floor(avg / 60)}m ${avg % 60}s`;
      }
    }
    const lastSubmitted =
      responses.length > 0
        ? new Date(responses[0].submitted_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
        : "No submissions yet";

    return { total, avgDuration, lastSubmitted };
  }, [responses]);

  // Search Filter
  const filteredResponses = useMemo(() => {
    if (!searchQuery.trim()) return responses;
    const query = searchQuery.toLowerCase();

    return responses.filter((resp) => {
      if (resp.sap_id && resp.sap_id.toLowerCase().includes(query)) return true;
      const respAnswers = answersMap[resp.id] || {};
      return Object.values(respAnswers).some((val) => {
        if (typeof val === "string") return val.toLowerCase().includes(query);
        if (Array.isArray(val)) return val.join(" ").toLowerCase().includes(query);
        if (typeof val === "number") return val.toString().includes(query);
        return false;
      });
    });
  }, [responses, answersMap, searchQuery]);

  // CSV Export Action
  function handleExportCSV() {
    if (!form || responses.length === 0) return;

    function escapeCSV(val: any): string {
      if (val === null || val === undefined) return '""';
      let str = "";
      if (Array.isArray(val)) {
        str = val.join("; ");
      } else {
        str = String(val);
      }
      return `"${str.replace(/"/g, '""')}"`;
    }

    const headers = [
      "Response ID",
      "Respondent Email",
      "Submitted At",
      "Completion Time (seconds)",
      ...questions.map((q) => q.label),
    ];

    const rows = responses.map((resp) => {
      const respAnswers = answersMap[resp.id] || {};
      return [
        escapeCSV(resp.id),
        escapeCSV(resp.sap_id || "Anonymous"),
        escapeCSV(new Date(resp.submitted_at).toISOString()),
        escapeCSV(resp.completion_time_seconds || ""),
        ...questions.map((q) => escapeCSV(respAnswers[q.id])),
      ].join(",");
    });

    const csvContent = [headers.map((h) => escapeCSV(h)).join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = (form.title || "form").toLowerCase().replace(/[^a-z0-9]/g, "_");
    link.setAttribute("href", url);
    link.setAttribute("download", `${safeTitle}_telemetry_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function formatAnswerDisplay(val: any) {
    if (val === undefined || val === null || val === "") {
      return <span className="text-slate-500 italic font-mono text-[11px]">No answer</span>;
    }
    if (Array.isArray(val)) {
      return (
        <div className="flex flex-wrap gap-1">
          {val.map((item, idx) => (
            <span
              key={idx}
              className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#111c30] border border-[#1e2e4a] text-sky-300"
            >
              {getOptionLabel(item)}
            </span>
          ))}
        </div>
      );
    }
    if (typeof val === "number") {
      return (
        <span className="inline-flex items-center gap-1 font-mono font-bold text-sky-400 bg-sky-950/60 border border-sky-500/30 px-2 py-0.5 rounded text-xs">
          {val}
        </span>
      );
    }
    return <span className="text-slate-200 text-xs">{String(val)}</span>;
  }

  return (
    <div className="bg-[#070b14] text-slate-100 antialiased selection:bg-sky-500/20 selection:text-sky-300 relative min-h-screen flex flex-col font-sans">
      {/* ASCII DIGITAL RAIN BACKDROP */}
      <AsciiRainBackdrop opacity={0.35} />

      {loading ? (
        <div className="flex-1 min-h-screen flex items-center justify-center relative z-10">
          <div className="flex flex-col items-center gap-3 bg-[#0d1527]/90 p-6 rounded-2xl border border-[#1e293b] shadow-2xl">
            <span className="material-symbols-outlined text-4xl text-sky-400 animate-spin">
              progress_activity
            </span>
            <p className="text-xs font-mono tracking-wider text-sky-300 uppercase">
              Loading Response Telemetry...
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* UNIFIED TOP STUDIO NAVIGATION */}
          <header className="fixed top-0 left-0 right-0 h-16 bg-[#0b1120] border-b border-[#1e293b] z-50 flex items-center justify-between px-4 sm:px-6 shadow-xl">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href="/dashboard"
                className="flex items-center gap-2.5 text-slate-400 hover:text-white transition-colors shrink-0 group"
                title="Back to Dashboard"
              >
                <div className="p-1 rounded-lg hover:bg-[#152033] transition-colors flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                </div>
                <img
                  alt="Hypervision Logo"
                  className="w-9 h-9 sm:w-10 sm:h-10 object-contain bg-transparent shrink-0 group-hover:scale-105 transition-transform"
                  src="/hypervision-logo.png"
                />
                <span className="text-base sm:text-lg font-extrabold tracking-tight text-white hidden md:inline">
                  Hypervision
                </span>
              </Link>
              <div className="h-5 w-px bg-slate-800 hidden sm:block shrink-0" />
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
                  {form?.title || "Untitled Form"}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-sky-500/10 border border-sky-500/30 text-sky-400 shrink-0">
                  Analytics
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-2 text-slate-400 text-xs font-mono pr-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Synced {lastSyncedTime}</span>
              </div>

              <button
                type="button"
                onClick={() => loadData(true)}
                disabled={refreshing}
                className="w-9 h-9 rounded-lg border border-slate-700/80 bg-[#111c30] hover:bg-[#172540] text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh Telemetry"
              >
                <span
                  className={`material-symbols-outlined text-[18px] ${refreshing ? "animate-spin text-sky-400" : ""
                    }`}
                >
                  sync
                </span>
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                disabled={responses.length === 0}
                className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-700/80 bg-[#111c30] hover:bg-[#172540] text-slate-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                title="Export CSV"
              >
                <span className="material-symbols-outlined text-[16px] text-sky-400">download</span>
                <span className="hidden sm:inline">Export CSV</span>
              </button>

              <Link
                href={`/editor/${form?.id}`}
                className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors shadow-md shadow-sky-500/20"
                title="Open in Builder"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                <span>Edit Form</span>
              </Link>
            </div>
          </header>

          {/* MAIN RESPONSE DASHBOARD CONTAINER */}
          <main className="relative z-10 pt-20 pb-16 flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-6">
            {/* Top Metric Cards */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Metric 1: Total Responses */}
              <div className="p-5 rounded-xl bg-[#0d1527] border border-[#1e293b] shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold uppercase tracking-wider font-mono">
                    Total Responses
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[18px]">inbox</span>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-extrabold text-white font-mono">
                    {metrics.total}
                  </span>
                  <span className="text-xs font-mono text-emerald-400 font-semibold">
                    100% Verified
                  </span>
                </div>
              </div>

              {/* Metric 2: Form Intake Status */}
              <div className="p-5 rounded-xl bg-[#0d1527] border border-[#1e293b] shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold uppercase tracking-wider font-mono">
                    Intake Pipeline
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[18px]">sensors</span>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-2xl font-bold uppercase font-mono text-emerald-400">
                    {form?.status}
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    {form?.status === "published" ? "Accepting inputs" : "Staged"}
                  </span>
                </div>
              </div>

              {/* Metric 3: Avg Duration */}
              <div className="p-5 rounded-xl bg-[#0d1527] border border-[#1e293b] shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold uppercase tracking-wider font-mono">
                    Avg. Completion
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[18px]">timer</span>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-extrabold text-white font-mono">
                    {metrics.avgDuration}
                  </span>
                  <span className="text-xs font-mono text-slate-400">Telemetry</span>
                </div>
              </div>

              {/* Metric 4: Latest Activity */}
              <div className="p-5 rounded-xl bg-[#0d1527] border border-[#1e293b] shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold uppercase tracking-wider font-mono">
                    Latest Activity
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[18px]">schedule</span>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-base font-bold text-slate-200 truncate">
                    {metrics.lastSubmitted}
                  </span>
                </div>
              </div>
            </section>

            {/* View Tabs & Search Filter Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-2 bg-[#0b1120] border border-[#1e293b] rounded-xl shadow-lg">
              <div className="flex items-center gap-1.5 p-1 bg-[#070b14] rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveTab("summary")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === "summary"
                      ? "bg-sky-500 text-slate-950 shadow-md"
                      : "text-slate-400 hover:text-white"
                    }`}
                >
                  Summary Analytics
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("table")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${activeTab === "table"
                      ? "bg-sky-500 text-slate-950 shadow-md"
                      : "text-slate-400 hover:text-white"
                    }`}
                >
                  <span>Individual Responses</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#1a2942] text-sky-300 font-mono">
                    {responses.length}
                  </span>
                </button>
              </div>

              {/* Search input */}
              <div className="relative min-w-[260px] sm:min-w-[320px]">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-500 text-[18px] pointer-events-none">
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter answers or submissions..."
                  className="w-full bg-[#070b14] border border-slate-700 text-white text-xs pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:border-sky-400 placeholder-slate-500 transition-colors"
                />
              </div>
            </div>

            {/* TAB CONTENT: Summary Analytics View */}
            {activeTab === "summary" && (
              <div className="flex flex-col gap-6">
                {questions.length === 0 ? (
                  <div className="p-12 text-center bg-[#0d1527] border border-[#1e293b] rounded-2xl shadow-xl">
                    <p className="text-slate-400 text-xs">No questions configured for this form.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {questions.map((q, idx) => {
                      const allAnswers = responses
                        .map((r) => answersMap[r.id]?.[q.id])
                        .filter((ans) => ans !== undefined && ans !== null && ans !== "");

                      const totalAnswered = allAnswers.length;

                      return (
                        <div
                          key={q.id}
                          className="p-6 rounded-xl bg-[#0d1527] border border-[#1e293b] shadow-xl flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#1e293b]">
                              <div>
                                <span className="text-[11px] font-mono font-bold text-sky-400 uppercase tracking-wider block">
                                  Question {String(idx + 1).padStart(2, "0")} ·{" "}
                                  {q.question_type.replace("_", " ")}
                                </span>
                                <h3 className="text-sm font-bold text-white mt-1 leading-snug">
                                  {q.label}
                                </h3>
                              </div>
                              <span className="px-2.5 py-1 rounded text-[11px] font-mono font-bold bg-[#111c30] border border-[#1e2e4a] text-sky-300 shrink-0">
                                {totalAnswered} / {responses.length} replied
                              </span>
                            </div>

                            {/* Question Breakdown Displays */}
                            <div className="mt-5">
                              {/* Multiple Choice / Checkboxes option frequency */}
                              {(q.question_type === "multiple_choice" ||
                                q.question_type === "checkboxes" ||
                                q.question_type === "dropdown") && (
                                  <div className="flex flex-col gap-3">
                                    {(q.options || []).map((rawOpt, optIdx) => {
                                      const optLabel = getOptionLabel(rawOpt);
                                      const count = allAnswers.filter((a) =>
                                        Array.isArray(a)
                                          ? a.some((item) => getOptionLabel(item) === optLabel)
                                          : getOptionLabel(a) === optLabel
                                      ).length;
                                      const percent =
                                        totalAnswered > 0
                                          ? Math.round((count / totalAnswered) * 100)
                                          : 0;

                                      return (
                                        <div key={optIdx} className="flex flex-col gap-1.5">
                                          <div className="flex items-center justify-between text-xs">
                                            <span className="font-semibold text-slate-200">
                                              {optLabel}
                                            </span>
                                            <span className="font-mono font-bold text-sky-400">
                                              {percent}% ({count})
                                            </span>
                                          </div>
                                          <div className="w-full bg-[#070b14] h-2 rounded-full overflow-hidden border border-slate-800">
                                            <div
                                              className="bg-sky-500 h-full rounded-full transition-all duration-500"
                                              style={{ width: `${percent}%` }}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                              {/* Linear Scale (Configurable min-max & numbers or stars) */}
                              {q.question_type === "linear_scale" && (() => {
                                const config = parseScaleConfig(q.options as any);
                                const count = Math.max(1, config.max - config.min + 1);
                                const scaleItems = Array.from({ length: count }, (_, i) => config.min + i);

                                return (
                                  <div className="flex flex-col gap-3">
                                    <div className="flex items-end justify-between gap-1.5 h-28 pt-4 px-3 bg-[#070b14] rounded-xl border border-slate-800">
                                      {scaleItems.map((n) => {
                                        const countVotes = allAnswers.filter(
                                          (a) => Number(a) === n
                                        ).length;
                                        const heightPct =
                                          totalAnswered > 0
                                            ? Math.max(8, Math.round((countVotes / totalAnswered) * 100))
                                            : 8;

                                        return (
                                          <div
                                            key={n}
                                            className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end"
                                          >
                                            <div
                                              className={`w-full rounded-t transition-colors ${config.format === "stars"
                                                  ? "bg-amber-400 hover:bg-amber-300"
                                                  : "bg-sky-500 hover:bg-sky-400"
                                                }`}
                                              style={{ height: `${heightPct}%` }}
                                              title={`${n}: ${countVotes} votes`}
                                            />
                                            <span className="text-[10px] font-mono text-slate-400 font-bold flex items-center gap-0.5">
                                              {config.format === "stars" && (
                                                <span className="material-symbols-outlined text-amber-400 text-[12px] leading-none">star</span>
                                              )}
                                              {n}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    {(config.minLabel || config.maxLabel) && (
                                      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 font-mono">
                                        <span>{config.minLabel ? `${config.min} = ${config.minLabel}` : ""}</span>
                                        <span>{config.maxLabel ? `${config.max} = ${config.maxLabel}` : ""}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Text Answers Recent Sample Feed */}
                              {(q.question_type === "short_text" ||
                                q.question_type === "long_text") && (
                                  <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                                    {allAnswers.length === 0 ? (
                                      <p className="text-xs text-slate-500 italic">
                                        No written feedback recorded yet.
                                      </p>
                                    ) : (
                                      allAnswers.slice(0, 5).map((ans, aIdx) => (
                                        <div
                                          key={aIdx}
                                          className="p-3 rounded-lg bg-[#070b14] border border-slate-800 text-xs text-slate-200 leading-relaxed"
                                        >
                                          "{String(ans)}"
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: Submissions Log Table */}
            {activeTab === "table" && (
              <div className="bg-[#0d1527] border border-[#1e293b] rounded-xl overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#070b14] border-b border-[#1e293b] text-slate-400 uppercase tracking-wider text-[10px] font-bold font-mono">
                      <tr>
                        <th className="px-4 py-3.5 font-bold">Response ID</th>
                        <th className="px-4 py-3.5 font-bold">Respondent Email</th>
                        <th className="px-4 py-3.5 font-bold">Timestamp</th>
                        <th className="px-4 py-3.5 font-bold">Duration</th>
                        {questions.map((q) => (
                          <th key={q.id} className="px-4 py-3.5 font-bold min-w-[180px] truncate">
                            {q.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 text-slate-300">
                      {filteredResponses.length === 0 ? (
                        <tr>
                          <td
                            colSpan={questions.length + 4}
                            className="px-6 py-12 text-center text-slate-400 text-xs"
                          >
                            {searchQuery
                              ? "No submissions matched your search query."
                              : "No responses collected yet."}
                          </td>
                        </tr>
                      ) : (
                        filteredResponses.map((resp) => {
                          const respAnswers = answersMap[resp.id] || {};
                          const formattedTime = new Date(resp.submitted_at).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          );

                          return (
                            <tr
                              key={resp.id}
                              onClick={() => setSelectedResponse(resp)}
                              className="hover:bg-[#111c30] transition-colors cursor-pointer group"
                            >
                              <td className="px-4 py-3 font-mono text-[11px] text-sky-400 font-bold group-hover:underline">
                                #{resp.id.slice(0, 8)}
                              </td>
                              <td className="px-4 py-3 font-mono text-slate-200 text-xs font-medium">
                                {resp.sap_id || "Anonymous"}
                              </td>
                              <td className="px-4 py-3 font-mono text-slate-300">
                                {formattedTime}
                              </td>
                              <td className="px-4 py-3 font-mono text-slate-400">
                                {resp.completion_time_seconds
                                  ? `${resp.completion_time_seconds}s`
                                  : "—"}
                              </td>
                              {questions.map((q) => (
                                <td key={q.id} className="px-4 py-3 max-w-xs truncate">
                                  {formatAnswerDisplay(respAnswers[q.id])}
                                </td>
                              ))}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </main>

          {/* RESPONSE DETAIL MODAL */}
          {selectedResponse && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
              <div className="bg-[#0b1120] border border-[#1e293b] rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-[#1e293b] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sky-400 text-xl">
                      receipt_long
                    </span>
                    <h3 className="text-sm font-bold text-white font-mono">
                      Submission #{selectedResponse.id.slice(0, 8)}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedResponse(null)}
                    className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
                  >
                    <span className="material-symbols-outlined text-xl">close</span>
                  </button>
                </div>

                <div className="p-6 overflow-y-auto flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-[#070b14] rounded-xl border border-slate-800 text-xs font-mono">
                    <div className="min-w-0">
                      <span className="text-slate-500 uppercase text-[10px]">Respondent</span>
                      <p className="text-cyan-300 font-bold mt-0.5 truncate" title={selectedResponse.sap_id}>
                        {selectedResponse.sap_id || "Anonymous"}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase text-[10px]">Submitted</span>
                      <p className="text-slate-200 mt-0.5">
                        {new Date(selectedResponse.submitted_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500 uppercase text-[10px]">Completion</span>
                      <p className="text-slate-200 mt-0.5">
                        {selectedResponse.completion_time_seconds
                          ? `${selectedResponse.completion_time_seconds}s`
                          : "Direct intake"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    {questions.map((q, idx) => {
                      const ans = answersMap[selectedResponse.id]?.[q.id];

                      return (
                        <div
                          key={q.id}
                          className="p-4 rounded-xl bg-[#0d1527] border border-[#1e293b] flex flex-col gap-1.5"
                        >
                          <span className="text-[10px] font-mono text-sky-400 uppercase font-bold">
                            Question {String(idx + 1).padStart(2, "0")} ·{" "}
                            {q.question_type.replace("_", " ")}
                          </span>
                          <h4 className="text-xs font-bold text-white">{q.label}</h4>
                          <div className="pt-1">{formatAnswerDisplay(ans)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="px-6 py-3 border-t border-[#1e293b] bg-[#070b14] flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSelectedResponse(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
                  >
                    Close Inspection
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STATIC FOOTER */}
          <footer className="w-full bg-[#0b1120] border-t border-[#1e293b] py-3.5 relative z-10 px-6">
            <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-2 max-w-7xl mx-auto">
              <span className="text-[11px] font-mono text-slate-400 select-none">
                © 2026 HYPERVISION. ALL RIGHT RESERVED.
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-300">All systems normal</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
