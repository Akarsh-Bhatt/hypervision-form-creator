"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient, ensureWorkspaceSession } from "@/lib/supabase/client";
import AsciiRainBackdrop from "@/components/AsciiRainBackdrop";
import { parseScaleConfig, serializeScaleConfig, type ScaleConfig } from "@/lib/scale";

type QuestionType =
  | "short_text"
  | "long_text"
  | "multiple_choice"
  | "checkboxes"
  | "dropdown"
  | "linear_scale"
  | "rating";

type Question = {
  id: string;
  form_id: string;
  field_key: string;
  question_type: QuestionType;
  label: string;
  description: string;
  order_index: number;
  is_required: boolean;
  options: string[];
};

type Form = {
  id: string;
  creator_id: string;
  shareable_slug: string;
  title: string;
  description: string;
  status: "draft" | "published" | "closed";
  created_at: string;
  updated_at: string;
};

const FIELD_TYPES: Array<{
  type: QuestionType;
  label: string;
  sub: string;
  icon: string;
}> = [
    {
      type: "short_text",
      label: "Short Text",
      sub: "Single-line response",
      icon: "short_text",
    },
    {
      type: "long_text",
      label: "Long Text",
      sub: "Multi-line paragraph",
      icon: "notes",
    },
    {
      type: "multiple_choice",
      label: "Multiple Choice",
      sub: "Single selection radio",
      icon: "radio_button_checked",
    },
    {
      type: "checkboxes",
      label: "Checkboxes",
      sub: "Multi-select list",
      icon: "check_box",
    },
    {
      type: "dropdown",
      label: "Dropdown",
      sub: "Select from dropdown",
      icon: "arrow_drop_down_circle",
    },
    {
      type: "linear_scale",
      label: "Linear Scale / NPS",
      sub: "Numeric or star rating",
      icon: "linear_scale",
    },
  ];

export default function FormEditorPage() {
  const params = useParams();
  const router = useRouter();
  const formId = params.id as string;

  const [form, setForm] = useState<Form | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<"saved" | "saving">("saved");
  const [copiedLink, setCopiedLink] = useState(false);
  const [deviceView, setDeviceView] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [inspectorTab, setInspectorTab] = useState<"field" | "form">("field");
  const [showTypeMenuId, setShowTypeMenuId] = useState<string | null>(null);
  const [fieldTypeDropdownOpen, setFieldTypeDropdownOpen] = useState(false);
  const fieldTypeDropdownRef = useRef<HTMLDivElement>(null);

  const metaSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const questionSaveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const pendingMetaUpdatesRef = useRef<Partial<Form> | null>(null);
  const pendingQuestionUpdatesRef = useRef<Record<string, any>>({});

  // Close field type dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        fieldTypeDropdownRef.current &&
        !fieldTypeDropdownRef.current.contains(event.target as Node)
      ) {
        setFieldTypeDropdownOpen(false);
      }
    }
    if (fieldTypeDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [fieldTypeDropdownOpen]);

  // Flush debounced updates on unmount to prevent data loss
  useEffect(() => {
    return () => {
      if (metaSaveTimeoutRef.current) clearTimeout(metaSaveTimeoutRef.current);
      Object.values(questionSaveTimeoutRef.current).forEach(clearTimeout);

      if (pendingMetaUpdatesRef.current && form?.id) {
        const supabase = createClient();
        supabase.from("forms").update(pendingMetaUpdatesRef.current).eq("id", form.id).then();
      }

      Object.entries(pendingQuestionUpdatesRef.current).forEach(([qId, upds]) => {
        if (upds && Object.keys(upds).length > 0) {
          const supabase = createClient();
          supabase.from("form_questions").update(upds).eq("id", qId).then();
        }
      });
    };
  }, [form?.id]);

  useEffect(() => {
    async function loadFormAndQuestions() {
      try {
        const supabase = createClient();
        await ensureWorkspaceSession(supabase);

        const { data: formData, error: formError } = await supabase
          .from("forms")
          .select("*")
          .eq("id", formId)
          .single();

        if (formError || !formData) {
          console.error("Form load error:", formError);
          router.push("/dashboard");
          return;
        }

        setForm(formData);

        const { data: questionData, error: questionError } = await supabase
          .from("form_questions")
          .select("*")
          .eq("form_id", formId)
          .order("order_index", { ascending: true });

        if (questionError) {
          console.error("Questions load error:", questionError);
        } else {
          const loadedQuestions = ((questionData as Question[]) || []).map((q) => ({
            ...q,
            question_type: (q.question_type as string) === "rating" ? "linear_scale" : q.question_type,
          }));
          setQuestions(loadedQuestions);
          if (loadedQuestions.length > 0) {
            setActiveQuestionId(loadedQuestions[0].id);
          }
        }
      } catch (err) {
        console.error("Editor error:", err);
      } finally {
        setLoading(false);
      }
    }

    loadFormAndQuestions();
  }, [formId, router]);

  // Debounced Form Metadata Update with unmount safety
  function handleUpdateFormMeta(updates: Partial<Form>) {
    if (!form) return;
    setSavingStatus("saving");
    const updatedForm = { ...form, ...updates, updated_at: new Date().toISOString() };
    setForm(updatedForm);

    pendingMetaUpdatesRef.current = {
      ...(pendingMetaUpdatesRef.current || {}),
      ...updates,
    };

    if (metaSaveTimeoutRef.current) clearTimeout(metaSaveTimeoutRef.current);
    metaSaveTimeoutRef.current = setTimeout(async () => {
      try {
        const pending = pendingMetaUpdatesRef.current;
        pendingMetaUpdatesRef.current = null;
        if (pending) {
          const supabase = createClient();
          await supabase.from("forms").update(pending).eq("id", form.id);
        }
        setSavingStatus("saved");
      } catch (err) {
        console.error("Form update error:", err);
        setSavingStatus("saved");
      }
    }, 450);
  }

  async function handleTogglePublish() {
    if (!form) return;
    const nextStatus = form.status === "published" ? "draft" : "published";
    handleUpdateFormMeta({ status: nextStatus });
  }

  // Add Question with immediate persistence and order synchronization
  async function handleAddQuestion(type: QuestionType = "short_text", atIndex?: number) {
    if (!form) return;
    setSavingStatus("saving");
    setShowTypeMenuId(null);

    const defaultOptions =
      type === "multiple_choice" || type === "checkboxes" || type === "dropdown"
        ? ["Option 1", "Option 2"]
        : type === "linear_scale"
          ? ["1", "5", "numeric", "", ""]
          : [];

    const targetIndex = atIndex !== undefined ? atIndex : questions.length;
    const questionId = crypto.randomUUID();

    const newQ: Question = {
      id: questionId,
      form_id: form.id,
      field_key: `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      question_type: type,
      label: `Question ${questions.length + 1}`,
      description: "",
      order_index: targetIndex,
      is_required: false,
      options: defaultOptions,
    };

    // Optimistically update question list and focus the new question immediately
    const updatedList = [...questions];
    updatedList.splice(targetIndex, 0, newQ);
    const reindexed = updatedList.map((q, idx) => ({ ...q, order_index: idx }));
    setQuestions(reindexed);
    setActiveQuestionId(newQ.id);

    try {
      const supabase = createClient();
      await supabase.auth.getSession();

      const { data, error } = await supabase
        .from("form_questions")
        .insert({
          id: newQ.id,
          form_id: newQ.form_id,
          field_key: newQ.field_key,
          question_type: newQ.question_type,
          label: newQ.label,
          description: newQ.description,
          order_index: newQ.order_index,
          is_required: newQ.is_required,
          options: newQ.options,
        })
        .select();

      if (error) {
        console.warn("Add question warning:", error.message || error);
        // Rollback optimistic update if failed
        setQuestions((prev) => prev.filter((q) => q.id !== newQ.id));
        return;
      }

      // Persist shifted questions order if inserted into the middle
      if (targetIndex < questions.length) {
        const shiftedUpdates = reindexed.slice(targetIndex + 1).map((q) =>
          supabase
            .from("form_questions")
            .update({ order_index: q.order_index })
            .eq("id", q.id)
        );
        await Promise.all(shiftedUpdates);
      }
    } catch (err: any) {
      console.warn("Add question error:", err?.message || err?.details || String(err));
      setQuestions((prev) => prev.filter((q) => q.id !== newQ.id));
    } finally {
      setSavingStatus("saved");
    }
  }

  // Debounced Question Field Update with DB constraint mapping and unmount safety
  function handleUpdateQuestion(id: string, updates: Partial<Question>, immediate = false) {
    setSavingStatus("saving");
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...updates } : q))
    );

    const dbUpdates = { ...updates };

    if (immediate) {
      if (pendingQuestionUpdatesRef.current[id]) {
        delete pendingQuestionUpdatesRef.current[id];
      }
      (async () => {
        try {
          const supabase = createClient();
          await supabase.from("form_questions").update(dbUpdates).eq("id", id);
        } catch (err: any) {
          console.warn("Question immediate update error:", err?.message || err);
        } finally {
          setSavingStatus("saved");
        }
      })();
      return;
    }

    pendingQuestionUpdatesRef.current[id] = {
      ...(pendingQuestionUpdatesRef.current[id] || {}),
      ...dbUpdates,
    };

    if (questionSaveTimeoutRef.current[id]) {
      clearTimeout(questionSaveTimeoutRef.current[id]);
    }

    questionSaveTimeoutRef.current[id] = setTimeout(async () => {
      try {
        const pending = pendingQuestionUpdatesRef.current[id];
        delete pendingQuestionUpdatesRef.current[id];
        if (pending) {
          const supabase = createClient();
          await supabase.from("form_questions").update(pending).eq("id", id);
        }
        setSavingStatus("saved");
      } catch (err: any) {
        console.warn("Question debounced update error:", err?.message || err);
        setSavingStatus("saved");
      }
    }, 400);
  }

  // Question Reordering
  async function handleMoveQuestion(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= questions.length) return;

    setSavingStatus("saving");
    const newQuestions = [...questions];
    const [moved] = newQuestions.splice(index, 1);
    newQuestions.splice(targetIndex, 0, moved);

    const reindexed = newQuestions.map((q, idx) => ({ ...q, order_index: idx }));
    setQuestions(reindexed);

    try {
      const supabase = createClient();
      await Promise.all([
        supabase
          .from("form_questions")
          .update({ order_index: reindexed[index].order_index })
          .eq("id", reindexed[index].id),
        supabase
          .from("form_questions")
          .update({ order_index: reindexed[targetIndex].order_index })
          .eq("id", reindexed[targetIndex].id),
      ]);
    } catch (err) {
      console.error("Reorder persistence error:", err);
    } finally {
      setSavingStatus("saved");
    }
  }

  function handleTypeChange(questionId: string, newType: QuestionType) {
    const target = questions.find((q) => q.id === questionId);
    if (!target) return;

    let updatedOptions = target.options || [];
    if (
      (newType === "multiple_choice" || newType === "checkboxes" || newType === "dropdown") &&
      (!updatedOptions || updatedOptions.length === 0)
    ) {
      updatedOptions = ["Option 1", "Option 2"];
    } else if (newType === "linear_scale" && (!updatedOptions || updatedOptions.length < 2)) {
      updatedOptions = ["1", "5", "numeric", "", ""];
    }

    handleUpdateQuestion(
      questionId,
      {
        question_type: newType,
        options: updatedOptions,
      },
      true
    );
  }

  function updateScaleConfig(questionId: string, updates: Partial<ScaleConfig>) {
    const target = questions.find((q) => q.id === questionId);
    if (!target) return;
    const current = parseScaleConfig(target.options);
    const newOptions = serializeScaleConfig(updates, current);
    handleUpdateQuestion(questionId, { options: newOptions }, true);
  }

  function getOptionText(opt: any): string {
    if (typeof opt === "string") return opt;
    if (opt && typeof opt === "object") {
      return opt.label || opt.text || opt.title || opt.value || "";
    }
    return String(opt ?? "");
  }

  function handleAddOption(questionId: string) {
    const target = questions.find((q) => q.id === questionId);
    if (!target) return;
    const currentOptions = target.options || [];
    const updatedOptions = [...currentOptions, `Option ${currentOptions.length + 1}`];
    handleUpdateQuestion(questionId, { options: updatedOptions }, true);
  }

  function handleUpdateOption(questionId: string, optIndex: number, newText: string) {
    const target = questions.find((q) => q.id === questionId);
    if (!target) return;
    const updatedOptions = [...(target.options || [])];
    const current = updatedOptions[optIndex];
    if (current && typeof current === "object") {
      updatedOptions[optIndex] = { ...(current as Record<string, any>), label: newText, text: newText, value: newText } as any;
    } else {
      updatedOptions[optIndex] = newText;
    }
    handleUpdateQuestion(questionId, { options: updatedOptions as any });
  }

  function handleDeleteOption(questionId: string, optIndex: number) {
    const target = questions.find((q) => q.id === questionId);
    if (!target) return;
    const currentOptions = target.options || [];
    if (currentOptions.length <= 1) return;
    const updatedOptions = currentOptions.filter((_, idx) => idx !== optIndex);
    handleUpdateQuestion(questionId, { options: updatedOptions }, true);
  }

  async function handleDeleteQuestion(id: string) {
    setSavingStatus("saving");
    const nextList = questions.filter((q) => q.id !== id);
    setQuestions(nextList);
    if (activeQuestionId === id) {
      setActiveQuestionId(nextList.length > 0 ? nextList[0].id : null);
    }

    try {
      const supabase = createClient();
      await supabase.from("form_questions").delete().eq("id", id);
    } catch (err: any) {
      console.warn("Delete question error:", err?.message || err);
    } finally {
      setSavingStatus("saved");
    }
  }

  async function handleDuplicateQuestion(id: string) {
    const target = questions.find((q) => q.id === id);
    if (!target || !form) return;

    setSavingStatus("saving");
    try {
      const supabase = createClient();
      await supabase.auth.getSession();

      const duplicateId = crypto.randomUUID();
      const duplicatePayload = {
        id: duplicateId,
        form_id: form.id,
        field_key: `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        question_type: target.question_type,
        label: `${target.label} (Copy)`,
        description: target.description,
        order_index: questions.length,
        is_required: target.is_required,
        options: target.options || [],
      };

      const { data, error } = await supabase
        .from("form_questions")
        .insert(duplicatePayload)
        .select();

      if (error) {
        console.warn("Duplicate warning:", error.message || error);
        throw error;
      }

      const insertedRow = data && data[0] ? data[0] : duplicatePayload;
      const newQ = {
        ...(insertedRow as Question),
        question_type: target.question_type,
      };
      setQuestions((prev) => [...prev, newQ]);
      setActiveQuestionId(newQ.id);
    } catch (err: any) {
      console.warn("Duplicate error:", err?.message || err?.details || String(err));
    } finally {
      setSavingStatus("saved");
    }
  }

  function handleCopyShareLink() {
    if (!form) return;
    const shareUrl = `${window.location.origin}/f/${form.shareable_slug}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  }

  const activeQuestion = useMemo(() => {
    return questions.find((q) => q.id === activeQuestionId) || null;
  }, [questions, activeQuestionId]);

  const activeIndex = useMemo(() => {
    return questions.findIndex((q) => q.id === activeQuestionId);
  }, [questions, activeQuestionId]);

  const viewportWidthClass = {
    desktop: "w-full max-w-3xl",
    tablet: "w-full max-w-xl",
    mobile: "w-full max-w-md",
  }[deviceView];

  return (
    <div className="bg-[#070b14] text-slate-100 antialiased selection:bg-sky-500/20 selection:text-sky-300 relative min-h-screen flex flex-col font-sans">
      {/* ASCII DIGITAL RAIN BACKDROP - Tuned subtle opacity so it never overpowers text */}
      <AsciiRainBackdrop opacity={0.35} />

      {loading ? (
        <div className="flex-1 min-h-screen flex items-center justify-center relative z-10">
          <div className="flex flex-col items-center gap-3 bg-[#0d1527]/90 p-6 rounded-2xl border border-[#1e293b] shadow-2xl">
            <span className="material-symbols-outlined text-4xl text-sky-400 animate-spin">
              progress_activity
            </span>
            <p className="text-xs font-mono tracking-wider text-sky-300 uppercase">
              Loading Form Studio...
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* UNIFIED STUDIO TOP HEADER (Single bar, no overlap) */}
          <header className="fixed top-0 left-0 right-0 h-16 bg-[#0b1120] border-b border-[#1e293b] z-50 flex items-center justify-between px-4 sm:px-6 shadow-xl">
            {/* Left: Back Arrow, Brand & Form Title */}
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
                <input
                  type="text"
                  value={form?.title || ""}
                  onChange={(e) => handleUpdateFormMeta({ title: e.target.value })}
                  placeholder="Untitled Form"
                  className="bg-transparent text-sm sm:text-base font-bold text-white tracking-tight border-b border-transparent hover:border-slate-700 focus:border-sky-400 focus:outline-none transition-colors px-1 py-0.5 rounded max-w-[180px] sm:max-w-[280px] md:max-w-[340px] truncate"
                />
              </div>
            </div>

            {/* Center: Device Viewport Breakpoints */}
            <div className="hidden md:flex items-center bg-[#111c30] border border-[#1e293b] rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setDeviceView("desktop")}
                className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer ${deviceView === "desktop"
                  ? "bg-sky-500 text-slate-950 font-bold"
                  : "text-slate-400 hover:text-white"
                  }`}
                title="Desktop View"
              >
                <span className="material-symbols-outlined text-[16px]">desktop_windows</span>
                <span className="text-[11px]">Desktop</span>
              </button>
              <button
                type="button"
                onClick={() => setDeviceView("tablet")}
                className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer ${deviceView === "tablet"
                  ? "bg-sky-500 text-slate-950 font-bold"
                  : "text-slate-400 hover:text-white"
                  }`}
                title="Tablet View"
              >
                <span className="material-symbols-outlined text-[16px]">tablet_mac</span>
                <span className="text-[11px]">Tablet</span>
              </button>
              <button
                type="button"
                onClick={() => setDeviceView("mobile")}
                className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer ${deviceView === "mobile"
                  ? "bg-sky-500 text-slate-950 font-bold"
                  : "text-slate-400 hover:text-white"
                  }`}
                title="Mobile View"
              >
                <span className="material-symbols-outlined text-[16px]">smartphone</span>
                <span className="text-[11px]">Mobile</span>
              </button>
            </div>

            {/* Right: Actions, Responses & Publish */}
            <div className="flex items-center gap-2">
              <Link
                href={`/responses/${form?.id}`}
                className="flex items-center justify-center h-9 px-3.5 rounded-lg border border-slate-700/80 bg-[#111c30] hover:bg-[#172540] text-slate-200 text-xs font-semibold transition-colors"
                title="View Submissions"
              >
                <span>Responses</span>
              </Link>

              <button
                type="button"
                onClick={handleCopyShareLink}
                className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-700/80 bg-[#111c30] hover:bg-[#172540] text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                title="Copy Share Link"
              >
                <span className="material-symbols-outlined text-[16px] text-slate-400">
                  {copiedLink ? "check" : "link"}
                </span>
                <span className="hidden sm:inline">
                  {copiedLink ? "Copied!" : "Share"}
                </span>
              </button>

              <a
                href={`/f/${form?.shareable_slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-700/80 bg-[#111c30] hover:bg-[#172540] text-slate-200 text-xs font-semibold transition-colors"
                title="Preview Live Form"
              >
                <span className="material-symbols-outlined text-[16px] text-slate-400">
                  open_in_new
                </span>
                <span className="hidden sm:inline">Preview</span>
              </a>

              {/* Publish Toggle CTA */}
              <button
                type="button"
                onClick={handleTogglePublish}
                className={`flex items-center gap-1.5 h-9 px-3.5 rounded-lg font-bold text-xs transition-colors cursor-pointer shadow-md ${form?.status === "published"
                  ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/30"
                  : "bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-sky-500/25"
                  }`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {form?.status === "published" ? "check_circle" : "send"}
                </span>
                <span>
                  {form?.status === "published" ? "Live" : "Publish"}
                </span>
              </button>
            </div>
          </header>

          {/* MAIN WORKSPACE BODY: Canvas Viewport (Center) + Inspector (Right) */}
          <div className="flex-1 flex flex-col lg:flex-row relative z-10 pt-16">
            {/* CENTER CANVAS VIEWPORT */}
            <main className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col items-center overflow-y-auto">
              <div className={`${viewportWidthClass} flex flex-col gap-5 transition-all duration-300`}>
                {/* Step Progress Tracker Card (Solid high-contrast container) */}
                {questions.length > 0 && (
                  <div className="w-full bg-[#0d1527] border border-[#1e293b] rounded-xl p-4 shadow-xl flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-[#1a2942] text-sky-400 border border-sky-500/30 font-mono">
                          QUESTION {activeIndex >= 0 ? activeIndex + 1 : 1} OF {questions.length}
                        </span>
                        <span className="text-xs font-medium text-slate-200 truncate max-w-[280px]">
                          {activeQuestion?.label || "Untitled Field"}
                        </span>
                      </div>
                      <span className="text-xs font-mono font-semibold text-sky-400">
                        {questions.length > 0
                          ? `${Math.round(((activeIndex + 1) / questions.length) * 100)}% Position`
                          : "0%"}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-[#16233a] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-sky-500 transition-all duration-300"
                        style={{
                          width: `${questions.length > 0
                            ? Math.max(10, ((activeIndex + 1) / questions.length) * 100)
                            : 0
                            }%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Email Authentication Required Banner (Google Forms Parity) */}
                <div className="w-full bg-[#0a1628]/90 border border-sky-500/30 rounded-xl px-4 py-3 shadow-lg flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                      <span className="material-symbols-outlined text-[17px]">mail</span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <span>Required Email Authentication</span>
                        <span className="text-rose-400 font-bold">*</span>
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">
                        Respondents must provide a verified email before submitting
                      </span>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40 shrink-0">
                    ACTIVE
                  </span>
                </div>

                {/* Questions List */}
                {questions.length === 0 ? (
                  <div className="w-full bg-[#0d1527] border-2 border-dashed border-[#1e293b] rounded-2xl p-12 text-center shadow-xl my-6">
                    <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center mx-auto mb-4 shadow-lg">
                      <span className="material-symbols-outlined text-3xl">add_box</span>
                    </div>
                    <h3 className="text-base font-bold text-white">No questions added yet</h3>
                    <p className="text-xs text-slate-300 mt-1 max-w-sm mx-auto">
                      Add intake questions to build your interactive multi-step form schema.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleAddQuestion("short_text")}
                      className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer shadow-lg shadow-sky-500/20"
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
                      <span>Add First Question</span>
                    </button>
                  </div>
                ) : (
                  questions.map((q, idx) => {
                    const isActive = q.id === activeQuestionId;

                    return (
                      <div key={q.id} className="flex flex-col gap-2.5">
                        {isActive ? (
                          /* ACTIVE QUESTION CARD (Opaque dark surface, glowing border, crisp high-contrast text) */
                          <div className="relative w-full bg-[#0d1527] rounded-xl p-5 sm:p-6 border-2 border-sky-500 shadow-2xl shadow-sky-950/40 flex flex-col gap-4">
                            {/* Toolbar Header */}
                            <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold font-mono text-sky-300 bg-sky-950/90 border border-sky-500/40 px-2.5 py-0.5 rounded">
                                  {String(idx + 1).padStart(2, "0")} ACTIVE
                                </span>
                                <span className="text-xs font-mono font-semibold text-slate-300 uppercase">
                                  {q.question_type.replace("_", " ")}
                                </span>
                              </div>

                              {/* Question Reordering & Actions */}
                              <div className="flex items-center gap-1 bg-[#070b14] border border-slate-700 p-1 rounded-lg">
                                <button
                                  type="button"
                                  onClick={() => handleMoveQuestion(idx, "up")}
                                  disabled={idx === 0}
                                  className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                                  title="Move Up"
                                >
                                  <span className="material-symbols-outlined text-[17px]">
                                    arrow_upward
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveQuestion(idx, "down")}
                                  disabled={idx === questions.length - 1}
                                  className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                                  title="Move Down"
                                >
                                  <span className="material-symbols-outlined text-[17px]">
                                    arrow_downward
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDuplicateQuestion(q.id)}
                                  className="p-1 rounded text-slate-300 hover:text-sky-400 hover:bg-slate-800 cursor-pointer"
                                  title="Duplicate"
                                >
                                  <span className="material-symbols-outlined text-[17px]">
                                    content_copy
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteQuestion(q.id)}
                                  className="p-1 rounded text-slate-300 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                                  title="Delete"
                                >
                                  <span className="material-symbols-outlined text-[17px]">
                                    delete
                                  </span>
                                </button>
                              </div>
                            </div>

                            {/* Question Title & Description Inputs */}
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={q.label}
                                  onChange={(e) =>
                                    handleUpdateQuestion(q.id, { label: e.target.value })
                                  }
                                  placeholder="Enter question title..."
                                  className="w-full bg-[#070b14] border border-slate-700 focus:border-sky-400 text-white font-bold text-base px-3 py-2 rounded-lg focus:outline-none transition-colors"
                                />
                                {q.is_required && (
                                  <span className="text-rose-400 text-sm font-bold shrink-0">*</span>
                                )}
                              </div>
                              <input
                                type="text"
                                value={q.description || ""}
                                onChange={(e) =>
                                  handleUpdateQuestion(q.id, { description: e.target.value })
                                }
                                placeholder="Add helpful description or guidance (optional)..."
                                className="w-full bg-[#070b14] border border-slate-800 focus:border-slate-600 text-slate-300 text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors"
                              />
                            </div>

                            {/* Interactive Field Type Preview (Solid High Contrast Inputs) */}
                            <div className="pt-2">
                              {q.question_type === "short_text" && (
                                <div className="w-full bg-[#070b14] border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-400 text-xs select-none">
                                  Short answer input field...
                                </div>
                              )}

                              {q.question_type === "long_text" && (
                                <div className="w-full bg-[#070b14] border border-slate-700 rounded-lg p-3 text-slate-400 text-xs select-none min-h-[80px]">
                                  Long paragraph / detailed feedback comments...
                                </div>
                              )}

                              {(q.question_type === "multiple_choice" ||
                                q.question_type === "checkboxes") && (
                                  <div className="flex flex-col gap-2.5">
                                    {(q.options || []).map((opt, optIdx) => (
                                      <div key={optIdx} className="flex items-center gap-2.5">
                                        <div
                                          className={`w-4 h-4 border border-sky-400 flex items-center justify-center shrink-0 ${q.question_type === "multiple_choice"
                                            ? "rounded-full"
                                            : "rounded"
                                            }`}
                                        >
                                          <div
                                            className={`w-2 h-2 ${optIdx === 0 ? "bg-sky-400" : "bg-transparent"
                                              } ${q.question_type === "multiple_choice"
                                                ? "rounded-full"
                                                : "rounded-xs"
                                              }`}
                                          />
                                        </div>
                                        <input
                                          type="text"
                                          value={getOptionText(opt)}
                                          onChange={(e) =>
                                            handleUpdateOption(q.id, optIdx, e.target.value)
                                          }
                                          className="flex-1 bg-[#070b14] border border-slate-700 hover:border-slate-600 text-xs text-white font-medium px-3 py-1.5 rounded-lg focus:outline-none focus:border-sky-400"
                                        />
                                        {q.options.length > 1 && (
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteOption(q.id, optIdx)}
                                            className="text-slate-400 hover:text-rose-400 p-1 cursor-pointer"
                                            title="Remove option"
                                          >
                                            <span className="material-symbols-outlined text-[16px]">
                                              close
                                            </span>
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() => handleAddOption(q.id)}
                                      className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 font-semibold pt-1 self-start cursor-pointer"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">add</span>
                                      <span>Add another option</span>
                                    </button>
                                  </div>
                                )}

                              {q.question_type === "dropdown" && (
                                <div className="flex flex-col gap-2.5">
                                  <div className="w-full bg-[#060e1d] border border-slate-700/80 hover:border-sky-500/40 rounded-xl px-4 py-3 text-slate-300 text-xs flex items-center justify-between shadow-inner transition-colors">
                                    <span className="flex items-center gap-2">
                                      <span className="material-symbols-outlined text-[16px] text-sky-400">
                                        arrow_drop_down_circle
                                      </span>
                                      <span>{getOptionText(q.options?.[0]) || "Select an option..."}</span>
                                    </span>
                                    <span className="material-symbols-outlined text-[18px] text-slate-400">
                                      expand_more
                                    </span>
                                  </div>
                                  <div className="flex flex-col gap-2 pt-1">
                                    {(q.options || []).map((opt, optIdx) => (
                                      <div key={optIdx} className="flex items-center gap-2">
                                        <span className="text-[11px] font-mono text-slate-400 w-5">
                                          {optIdx + 1}.
                                        </span>
                                        <input
                                          type="text"
                                          value={getOptionText(opt)}
                                          onChange={(e) =>
                                            handleUpdateOption(q.id, optIdx, e.target.value)
                                          }
                                          className="flex-1 bg-[#070e1b] border border-slate-700/80 text-xs text-white font-medium px-3.5 py-2 rounded-xl focus:outline-none focus:border-sky-400 transition-colors"
                                        />
                                        {q.options.length > 1 && (
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteOption(q.id, optIdx)}
                                            className="text-slate-400 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 cursor-pointer transition-colors"
                                            title="Remove option"
                                          >
                                            <span className="material-symbols-outlined text-[16px]">
                                              close
                                            </span>
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() => handleAddOption(q.id)}
                                      className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 font-semibold pt-1 self-start cursor-pointer"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">add</span>
                                      <span>Add dropdown item</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {q.question_type === "linear_scale" && (() => {
                                const config = parseScaleConfig(q.options);
                                const count = Math.max(1, config.max - config.min + 1);
                                const scaleNumbers = Array.from({ length: count }, (_, i) => config.min + i);

                                return (
                                  <div className="flex flex-col gap-3">
                                    {config.format === "stars" ? (
                                      <div className="flex flex-wrap items-center gap-2 pt-1">
                                        {scaleNumbers.map((num) => (
                                          <div
                                            key={num}
                                            className="flex items-center justify-center p-2.5 rounded-xl border border-amber-500/30 bg-amber-950/20 text-amber-300 shadow-sm"
                                          >
                                            <span className="material-symbols-outlined text-[24px] text-amber-400">
                                              star
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-1.5 w-full">
                                        {scaleNumbers.map((num, nIdx) => (
                                          <button
                                            key={num}
                                            type="button"
                                            className={`flex-1 min-w-[34px] h-10 rounded-lg border text-xs font-bold transition-all ${nIdx === scaleNumbers.length - 1
                                                ? "bg-sky-500 text-slate-950 border-sky-400 shadow-md shadow-sky-500/30"
                                                : "bg-[#070b14] hover:bg-[#152238] border-slate-700 text-slate-200"
                                              }`}
                                          >
                                            {num}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    {config.minLabel || config.maxLabel ? (
                                      <div className="flex items-center justify-between text-slate-300 text-xs px-1 font-mono">
                                        <span>{config.minLabel ? `${config.min} = ${config.minLabel}` : `${config.min}`}</span>
                                        <span>{config.maxLabel ? `${config.max} = ${config.maxLabel}` : `${config.max}`}</span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between text-slate-400 text-xs px-1 font-mono">
                                        <span>Scale: {config.min} to {config.max}</span>
                                        <span className="capitalize text-sky-400">{config.format} format</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>

                            {/* Block Footer Meta */}
                            <div className="pt-2 flex items-center justify-between text-xs text-slate-400 border-t border-[#1e293b]">
                              <span className="inline-flex items-center gap-1.5 text-slate-300 text-[11px] font-medium">
                                <span className="material-symbols-outlined text-[15px] text-sky-400">
                                  tune
                                </span>
                                <span>{q.question_type.replace("_", " ")} Block</span>
                              </span>
                            </div>
                          </div>
                        ) : (
                          /* INACTIVE QUESTION CARD (Solid dark surface, clear white text) */
                          <div
                            onClick={() => setActiveQuestionId(q.id)}
                            className="group relative w-full bg-[#0d1527] border border-[#1e293b] hover:border-slate-500 rounded-xl p-4 sm:p-5 shadow-lg transition-all cursor-pointer"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex flex-col gap-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-mono font-bold text-slate-300 px-2 py-0.5 rounded bg-[#16233a] border border-[#233554]">
                                    {String(idx + 1).padStart(2, "0")}
                                  </span>
                                  <h3 className="text-sm font-bold text-white truncate">
                                    {q.label || "Untitled Question"}
                                  </h3>
                                  {q.is_required && (
                                    <span className="text-rose-400 text-xs font-bold">*</span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-300 truncate">
                                  {q.description || `Type: ${q.question_type.replace("_", " ")}`}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 text-slate-400 text-xs font-mono shrink-0">
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-sky-400 font-semibold">
                                  Click to edit
                                </span>
                                <span className="material-symbols-outlined text-[18px]">
                                  edit_note
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Inline Insertion Gap Button */}
                        <div className="relative flex items-center justify-center my-1 group">
                          <div className="w-full h-px bg-[#1e293b] group-hover:bg-sky-500/50 transition-colors" />
                          <button
                            type="button"
                            onClick={() =>
                              setShowTypeMenuId(showTypeMenuId === q.id ? null : q.id)
                            }
                            className="absolute z-10 flex items-center gap-1 px-3 py-1 rounded-full bg-[#0d1527] border border-[#1e293b] text-slate-300 hover:text-sky-300 hover:border-sky-500 text-xs font-semibold transition-all cursor-pointer shadow-md"
                          >
                            <span className="material-symbols-outlined text-[15px] text-sky-400">add</span>
                            <span>Add question here</span>
                          </button>

                          {/* Quick Field Type Popup for Inline Insertion */}
                          {showTypeMenuId === q.id && (
                            <div className="absolute top-8 z-30 bg-[#091122]/95 backdrop-blur-xl border border-sky-500/30 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_25px_rgba(56,189,248,0.15)] p-2.5 grid grid-cols-2 gap-2 text-xs w-80 animate-in fade-in zoom-in-95">
                              <div className="col-span-2 px-1 pb-1 pt-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-sky-400/80 flex items-center justify-between border-b border-slate-800">
                                <span>Choose Field Type</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowTypeMenuId(null);
                                  }}
                                  className="text-slate-500 hover:text-slate-300"
                                >
                                  <span className="material-symbols-outlined text-[14px]">close</span>
                                </button>
                              </div>
                              {(
                                [
                                  { type: "short_text", label: "Short Text", icon: "short_text" },
                                  { type: "long_text", label: "Long Text", icon: "notes" },
                                  {
                                    type: "multiple_choice",
                                    label: "Multiple Choice",
                                    icon: "radio_button_checked",
                                  },
                                  {
                                    type: "checkboxes",
                                    label: "Checkboxes",
                                    icon: "check_box",
                                  },
                                  {
                                    type: "dropdown",
                                    label: "Dropdown",
                                    icon: "arrow_drop_down_circle",
                                  },
                                  {
                                    type: "linear_scale",
                                    label: "Linear Scale / NPS",
                                    icon: "linear_scale",
                                  },
                                ] as const
                              ).map((item) => (
                                <button
                                  key={item.type}
                                  type="button"
                                  onClick={() => handleAddQuestion(item.type, idx + 1)}
                                  className="flex items-center gap-2.5 p-2 rounded-xl border border-transparent hover:border-sky-500/40 hover:bg-[#132238] text-slate-200 hover:text-white text-left font-medium cursor-pointer transition-all group"
                                >
                                  <div className="w-7 h-7 rounded-lg bg-[#070b14] border border-slate-700/80 flex items-center justify-center group-hover:border-sky-400 group-hover:text-sky-300 text-slate-400 shrink-0 transition-colors">
                                    <span className="material-symbols-outlined text-[16px]">
                                      {item.icon}
                                    </span>
                                  </div>
                                  <span className="truncate">{item.label}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Bottom Add Question Button */}
                <div className="pt-2 flex items-center justify-between pb-10">
                  <button
                    type="button"
                    onClick={() => handleAddQuestion("short_text")}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0d1527] hover:bg-[#16233a] border border-[#1e293b] text-white text-xs font-bold transition-colors cursor-pointer shadow-lg"
                  >
                    <span className="material-symbols-outlined text-[18px] text-sky-400">
                      add_circle
                    </span>
                    <span>Add New Question</span>
                  </button>
                  <Link
                    href={`/f/${form?.shareable_slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-sky-500/20"
                  >
                    <span>Test Form Live</span>
                    <span className="material-symbols-outlined text-[17px]">open_in_new</span>
                  </Link>
                </div>
              </div>
            </main>

            {/* RIGHT INSPECTOR SIDEBAR (Solid high-contrast container) */}
            <aside className="w-full lg:w-80 xl:w-96 bg-[#0b1120] border-t lg:border-t-0 lg:border-l border-[#1e293b] p-5 shrink-0 flex flex-col gap-5 shadow-2xl">
              {/* Tab Selector */}
              <div className="flex items-center bg-[#070b14] border border-[#1e293b] p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setInspectorTab("field")}
                  className={`flex-1 py-1.5 rounded-lg font-bold text-xs text-center transition-all cursor-pointer ${inspectorTab === "field"
                    ? "bg-sky-500 text-slate-950 shadow-sm"
                    : "text-slate-300 hover:text-white"
                    }`}
                >
                  Field Settings
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab("form")}
                  className={`flex-1 py-1.5 rounded-lg font-bold text-xs text-center transition-all cursor-pointer ${inspectorTab === "form"
                    ? "bg-sky-500 text-slate-950 shadow-sm"
                    : "text-slate-300 hover:text-white"
                    }`}
                >
                  Form Settings
                </button>
              </div>

              {inspectorTab === "field" ? (
                activeQuestion ? (
                  <div className="flex flex-col gap-4">
                    {/* Question Field Type Custom Dropdown */}
                    {(() => {
                      const activeConfig =
                        FIELD_TYPES.find((ft) => ft.type === activeQuestion.question_type) ||
                        FIELD_TYPES[0];

                      return (
                        <div ref={fieldTypeDropdownRef} className="flex flex-col gap-1.5 relative">
                          <label className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                            Field Type
                          </label>
                          <button
                            type="button"
                            onClick={() => setFieldTypeDropdownOpen((prev) => !prev)}
                            className={`w-full bg-[#070b14] border rounded-xl p-2.5 text-xs flex items-center justify-between transition-all cursor-pointer ${fieldTypeDropdownOpen
                                ? "border-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.2)] bg-[#0b1322]"
                                : "border-slate-700 hover:border-slate-500 hover:bg-[#0c1322]"
                              }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-lg bg-[#111a2e] border border-slate-700 flex items-center justify-center text-sky-400 shrink-0">
                                <span className="material-symbols-outlined text-[17px]">
                                  {activeConfig.icon}
                                </span>
                              </div>
                              <div className="flex flex-col text-left truncate">
                                <span className="text-white font-bold text-xs truncate">
                                  {activeConfig.label}
                                </span>
                                <span className="text-[10px] text-slate-400 truncate">
                                  {activeConfig.sub}
                                </span>
                              </div>
                            </div>
                            <span
                              className={`material-symbols-outlined text-[18px] text-slate-400 transition-transform duration-200 ${fieldTypeDropdownOpen ? "rotate-180 text-sky-400" : ""
                                }`}
                            >
                              expand_more
                            </span>
                          </button>

                          {fieldTypeDropdownOpen && (
                            <div className="absolute top-[calc(100%+4px)] left-0 w-full z-40 bg-[#08101e]/98 backdrop-blur-xl border border-sky-500/30 rounded-xl shadow-[0_15px_40px_rgba(0,0,0,0.85),0_0_20px_rgba(56,189,248,0.12)] p-1.5 flex flex-col gap-1 animate-in fade-in zoom-in-95">
                              {FIELD_TYPES.map((ft) => {
                                const isSelected = activeQuestion.question_type === ft.type;
                                return (
                                  <button
                                    key={ft.type}
                                    type="button"
                                    onClick={() => {
                                      handleTypeChange(activeQuestion.id, ft.type);
                                      setFieldTypeDropdownOpen(false);
                                    }}
                                    className={`w-full p-2 rounded-lg text-left flex items-center justify-between transition-all cursor-pointer ${isSelected
                                        ? "bg-[#14233c] text-white border-l-2 border-sky-400"
                                        : "text-slate-300 hover:text-white hover:bg-[#0f1b30]"
                                      }`}
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <div
                                        className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${isSelected
                                            ? "bg-sky-500/20 text-sky-300"
                                            : "bg-[#060a14] border border-slate-700 text-slate-400"
                                          }`}
                                      >
                                        <span className="material-symbols-outlined text-[15px]">
                                          {ft.icon}
                                        </span>
                                      </div>
                                      <div className="flex flex-col truncate">
                                        <span className="text-xs font-bold truncate">{ft.label}</span>
                                        <span className="text-[10px] text-slate-400 truncate">
                                          {ft.sub}
                                        </span>
                                      </div>
                                    </div>
                                    {isSelected && (
                                      <span className="material-symbols-outlined text-[16px] text-sky-400 shrink-0">
                                        check
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Question Label */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                        Question Title
                      </label>
                      <textarea
                        value={activeQuestion.label}
                        onChange={(e) =>
                          handleUpdateQuestion(activeQuestion.id, { label: e.target.value })
                        }
                        rows={2}
                        className="w-full bg-[#070b14] border border-slate-700 text-white font-semibold text-xs p-3 rounded-lg focus:outline-none focus:border-sky-400 resize-none transition-colors"
                      />
                    </div>

                    {/* Question Description / Help Text */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                        Help Text / Subtitle
                      </label>
                      <input
                        type="text"
                        value={activeQuestion.description || ""}
                        onChange={(e) =>
                          handleUpdateQuestion(activeQuestion.id, { description: e.target.value })
                        }
                        placeholder="Guidance for respondents..."
                        className="w-full bg-[#070b14] border border-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg focus:outline-none focus:border-sky-400 transition-colors"
                      />
                    </div>

                    {/* Linear Scale & Rating Customizer */}
                    {activeQuestion.question_type === "linear_scale" && (() => {
                      const scale = parseScaleConfig(activeQuestion.options);
                      return (
                        <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[#070b14] border border-slate-800">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                              Scale Display
                            </span>
                            <span className="text-[10px] text-sky-400 font-mono font-semibold">
                              {scale.format === "stars" ? "Star Rating" : "Numerical Scale"}
                            </span>
                          </div>

                          {/* Format Selector: Numbers vs Stars */}
                          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0b1120] rounded-lg border border-slate-700">
                            <button
                              type="button"
                              onClick={() => updateScaleConfig(activeQuestion.id, { format: "numeric" })}
                              className={`py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${scale.format === "numeric"
                                  ? "bg-sky-500 text-slate-950 shadow-sm"
                                  : "text-slate-400 hover:text-white"
                                }`}
                            >
                              <span className="material-symbols-outlined text-[16px]">pin</span>
                              <span>Numbers</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => updateScaleConfig(activeQuestion.id, { format: "stars" })}
                              className={`py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${scale.format === "stars"
                                  ? "bg-amber-400 text-slate-950 shadow-sm"
                                  : "text-slate-400 hover:text-white"
                                }`}
                            >
                              <span className="material-symbols-outlined text-[16px]">star</span>
                              <span>Stars</span>
                            </button>
                          </div>

                          {/* Range Selectors: Min and Max */}
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] font-mono font-bold text-slate-300">
                                Min Value
                              </label>
                              <div className="grid grid-cols-2 gap-1 p-1 bg-[#0b1120] rounded-lg border border-slate-700">
                                {[0, 1].map((val) => (
                                  <button
                                    key={val}
                                    type="button"
                                    onClick={() => updateScaleConfig(activeQuestion.id, { min: val })}
                                    className={`py-1 text-xs font-bold font-mono rounded transition-colors cursor-pointer ${scale.min === val
                                        ? "bg-sky-500 text-slate-950 shadow-sm"
                                        : "text-slate-400 hover:text-white"
                                      }`}
                                  >
                                    {val}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] font-mono font-bold text-slate-300">
                                Max Value
                              </label>
                              <div className="relative">
                                <select
                                  value={scale.max}
                                  onChange={(e) =>
                                    updateScaleConfig(activeQuestion.id, { max: Number(e.target.value) })
                                  }
                                  className="w-full appearance-none bg-[#0b1120] border border-slate-700 text-white font-semibold text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-sky-400 cursor-pointer pr-8 font-mono h-[34px]"
                                >
                                  {[3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                                    <option key={v} value={v} className="bg-[#0b1120] text-white">
                                      {v}
                                    </option>
                                  ))}
                                </select>
                                <span className="material-symbols-outlined text-[16px] text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                                  unfold_more
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Optional Labels for Min and Max */}
                          <div className="flex flex-col gap-2 pt-1 border-t border-slate-800/80">
                            <span className="text-[11px] font-mono font-bold text-slate-300">
                              Labels (Optional)
                            </span>
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-mono text-slate-400 w-8">{scale.min}:</span>
                                <input
                                  type="text"
                                  value={scale.minLabel}
                                  placeholder={scale.format === "stars" ? "Poor / Worst" : "Not likely at all"}
                                  onChange={(e) =>
                                    updateScaleConfig(activeQuestion.id, { minLabel: e.target.value })
                                  }
                                  className="flex-1 bg-[#0b1120] border border-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-sky-400"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-mono text-slate-400 w-8">{scale.max}:</span>
                                <input
                                  type="text"
                                  value={scale.maxLabel}
                                  placeholder={scale.format === "stars" ? "Excellent / Best" : "Extremely likely"}
                                  onChange={(e) =>
                                    updateScaleConfig(activeQuestion.id, { maxLabel: e.target.value })
                                  }
                                  className="flex-1 bg-[#0b1120] border border-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-sky-400"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Required Answer Toggle */}
                    <div
                      onClick={() =>
                        handleUpdateQuestion(
                          activeQuestion.id,
                          { is_required: !activeQuestion.is_required },
                          true
                        )
                      }
                      className="flex items-center justify-between p-3.5 rounded-xl bg-[#070b14] border border-slate-800 hover:border-slate-700 transition cursor-pointer select-none"
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-white">Required Field</span>
                        <span className="text-[11px] text-slate-400">
                          {activeQuestion.is_required
                            ? "Answer is required to submit"
                            : "Optional question (can be skipped)"}
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(activeQuestion.is_required)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateQuestion(
                            activeQuestion.id,
                            { is_required: !activeQuestion.is_required },
                            true
                          );
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${activeQuestion.is_required
                            ? "bg-sky-500"
                            : "bg-[#1e2638] border border-slate-700"
                          }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full shadow-md transition duration-200 ease-in-out ${activeQuestion.is_required
                              ? "translate-x-5 bg-slate-950"
                              : "translate-x-0 bg-slate-400"
                            }`}
                        />
                      </button>
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => handleDuplicateQuestion(activeQuestion.id)}
                        className="flex-1 py-2 rounded-lg bg-[#141f33] hover:bg-[#1a2b47] border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px] text-sky-400">
                          content_copy
                        </span>
                        <span>Duplicate</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteQuestion(activeQuestion.id)}
                        className="flex-1 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    Select a question on the canvas to configure field settings.
                  </div>
                )
              ) : (
                /* FORM SETTINGS TAB */
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                      Form Title
                    </label>
                    <input
                      type="text"
                      value={form?.title || ""}
                      onChange={(e) => handleUpdateFormMeta({ title: e.target.value })}
                      className="w-full bg-[#070b14] border border-slate-700 text-white font-semibold text-xs px-3 py-2.5 rounded-lg focus:outline-none focus:border-sky-400 transition-colors"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                      Description
                    </label>
                    <textarea
                      value={form?.description || ""}
                      onChange={(e) => handleUpdateFormMeta({ description: e.target.value })}
                      rows={3}
                      className="w-full bg-[#070b14] border border-slate-700 text-slate-200 text-xs p-3 rounded-lg focus:outline-none focus:border-sky-400 resize-none transition-colors"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                      Shareable URL
                    </label>
                    <div className="flex items-center gap-1.5 bg-[#070b14] border border-slate-700 px-3 py-2 rounded-lg">
                      <span className="text-[11px] font-mono text-slate-300 truncate flex-1">
                        /f/{form?.shareable_slug}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyShareLink}
                        className="text-sky-400 hover:text-sky-300 text-xs cursor-pointer font-bold"
                        title="Copy Link"
                      >
                        <span className="material-symbols-outlined text-[17px]">
                          {copiedLink ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-[#070b14] border border-slate-800 flex flex-col gap-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-semibold">Intake Status</span>
                      <span
                        className={`font-mono text-[11px] font-bold px-2.5 py-0.5 rounded ${form?.status === "published"
                          ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300"
                          : "bg-slate-800 text-slate-300"
                          }`}
                      >
                        {form?.status.toUpperCase()}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleTogglePublish}
                      className={`w-full py-2.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${form?.status === "published"
                        ? "bg-slate-800 hover:bg-slate-700 text-slate-200"
                        : "bg-sky-500 hover:bg-sky-400 text-slate-950"
                        }`}
                    >
                      {form?.status === "published" ? "Unpublish Form" : "Publish Form Live"}
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </div>

          {/* STATIC FOOTER */}
          <footer className="w-full bg-[#0b1120] border-t border-[#1e293b] py-3 relative z-10 px-6">
            <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-2">
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
