"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AsciiRainBackdrop from "@/components/AsciiRainBackdrop";
import { parseScaleConfig } from "@/lib/scale";
import {
  FileText,
  Loader2,
  AlertCircle,
  Clock,
  Archive,
  Star,
  Check,
  CheckCircle2,
  RotateCcw,
  ChevronDown,
  Mail,
} from "lucide-react";

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
  creator_id?: string;
  shareable_slug: string;
  title: string;
  description: string;
  status: "draft" | "published" | "closed";
};

function FormCustomDropdown({
  options,
  value,
  onChange,
  hasError,
  placeholder = "Choose an option...",
}: {
  options: string[];
  value: string;
  onChange: (val: string) => void;
  hasError?: boolean;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full bg-[#060e1d] border rounded-xl px-4 py-3.5 text-sm flex items-center justify-between transition-all cursor-pointer select-none text-left ${
          hasError
            ? "!border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.15)]"
            : isOpen
              ? "border-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.2)] bg-[#071326]"
              : "border-[#162f52] hover:border-cyan-500/50 hover:bg-[#071122]"
        }`}
      >
        <span className={value ? "text-slate-100 font-medium truncate" : "text-slate-500 italic truncate"}>
          {value || placeholder}
        </span>
        <ChevronDown
          size={18}
          className={`text-cyan-400 shrink-0 ml-2 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-cyan-300" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-[calc(100%+6px)] left-0 w-full z-40 bg-[#071224]/95 backdrop-blur-xl border border-cyan-500/30 rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.85),0_0_20px_rgba(0,240,255,0.12)] p-1.5 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500 italic">No options available</div>
          ) : (
            options.map((opt, idx) => {
              const isSelected = value === opt;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-all text-left cursor-pointer ${
                    isSelected
                      ? "bg-cyan-950/60 text-cyan-300 border-l-2 border-cyan-400"
                      : "text-slate-300 hover:text-white hover:bg-cyan-950/30"
                  }`}
                >
                  <span className="truncate">{opt}</span>
                  {isSelected && <Check size={14} className="text-cyan-400 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function PublicFormPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [form, setForm] = useState<Form | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorState, setErrorState] = useState<"not_found" | "draft" | "closed" | null>(null);
  const [respondentEmail, setRespondentEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [authenticatedUserEmail, setAuthenticatedUserEmail] = useState<string | null>(null);

  const startTimeRef = useRef<number>(Date.now());

  // Check if respondent already has an active Supabase session
  useEffect(() => {
    async function checkAuthSession() {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user?.email) {
          setAuthenticatedUserEmail(session.user.email);
          setRespondentEmail(session.user.email);
        }
      } catch {
        // Unauthenticated guest respondent
      }
    }
    checkAuthSession();
  }, []);

  function getOptionLabel(opt: any): string {
    if (typeof opt === "string") return opt;
    if (opt && typeof opt === "object") {
      return opt.label || opt.text || opt.title || opt.value || "";
    }
    return String(opt ?? "");
  }

  useEffect(() => {
    async function fetchPublicForm() {
      try {
        const supabase = createClient();

        // 1. Fetch form using secure RPC (SEC-04) or scoped fallback without creator_id
        let formData: Form | null = null;
        const { data: rpcData, error: rpcError } = await supabase.rpc("get_public_form", {
          p_identifier: slug,
        });

        if (!rpcError && rpcData && rpcData.length > 0) {
          formData = rpcData[0] as Form;
        } else {
          let { data } = await supabase
            .from("forms")
            .select("id, shareable_slug, title, description, status")
            .eq("shareable_slug", slug)
            .maybeSingle();

          if (!data) {
            const res = await supabase
              .from("forms")
              .select("id, shareable_slug, title, description, status")
              .eq("id", slug)
              .maybeSingle();
            data = res.data;
          }
          formData = data as Form | null;
        }

        if (!formData) {
          setErrorState("not_found");
          return;
        }

        if (formData.status === "draft") {
          setErrorState("draft");
          setForm(formData);
          return;
        }

        if (formData.status === "closed") {
          setErrorState("closed");
          setForm(formData);
          return;
        }

        setForm(formData);
        startTimeRef.current = Date.now();

        // 2. Fetch questions ordered by order_index
        const { data: qData, error: qError } = await supabase
          .from("form_questions")
          .select("*")
          .eq("form_id", formData.id)
          .order("order_index", { ascending: true });

        if (qError) {
          console.error("Questions fetch error:", qError);
        } else {
          setQuestions((qData as Question[]) || []);
        }
      } catch (err) {
        console.error("Public form error:", err);
        setErrorState("not_found");
      } finally {
        setLoading(false);
      }
    }

    if (slug) {
      fetchPublicForm();
    }
  }, [slug]);

  function handleAnswerChange(questionId: string, val: any) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: val,
    }));

    // Clear inline error when respondent provides an answer
    if (fieldErrors[questionId]) {
      setFieldErrors((prev) => {
        const updated = { ...prev };
        delete updated[questionId];
        return updated;
      });
    }
  }

  function handleCheckboxToggle(questionId: string, option: string) {
    const currentList: string[] = answers[questionId] || [];
    let updatedList: string[];
    if (currentList.includes(option)) {
      updatedList = currentList.filter((item) => item !== option);
    } else {
      updatedList = [...currentList, option];
    }
    handleAnswerChange(questionId, updatedList);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || submitting) return;

    // 1. Email validation (Required like Google Forms)
    const trimmedEmail = respondentEmail.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail) {
      setEmailError("Email address is required to submit this form.");
      const el = document.getElementById("respondent-email-card");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    } else if (!emailRegex.test(trimmedEmail)) {
      setEmailError("Please enter a valid email address (e.g. name@domain.com).");
      const el = document.getElementById("respondent-email-card");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setEmailError("");

    // 2. Required questions validation
    const errors: Record<string, string> = {};
    for (const q of questions) {
      if (q.is_required) {
        const val = answers[q.id];
        if (
          val === undefined ||
          val === null ||
          val === "" ||
          (Array.isArray(val) && val.length === 0)
        ) {
          errors[q.id] = "This question is required.";
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstErrorId = Object.keys(errors)[0];
      const el = document.getElementById(`q-${firstErrorId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    try {
      const supabase = createClient();
      const completionSeconds = Math.max(
        1,
        Math.round((Date.now() - startTimeRef.current) / 1000)
      );

      // Prepare structured answers payload (SEC-02, SEC-10)
      const answerPayloads = questions
        .filter((q) => answers[q.id] !== undefined && answers[q.id] !== "")
        .map((q) => ({
          question_id: q.id,
          answer_value: answers[q.id],
        }));

      // 3. Submit atomically via secure RPC (SEC-02, SEC-03, SEC-10)
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "submit_form_response",
        {
          p_form_id: form.id,
          p_respondent_email: trimmedEmail.toLowerCase(),
          p_completion_seconds: completionSeconds,
          p_answers: answerPayloads,
        }
      );

      if (rpcError) {
        const errorMsg = rpcError.message || "";
        // If the error was a validated business logic rule (closed, response limit, or required check)
        if (
          errorMsg.includes("closed") ||
          errorMsg.includes("maximum response capacity") ||
          errorMsg.includes("must be answered")
        ) {
          alert(errorMsg);
          setSubmitting(false);
          return;
        }

        // Graceful fallback to direct insert without requiring SELECT permissions
        const responseId = crypto.randomUUID();

        // 3a. Insert response record with client-side UUID (bypasses .select().single() RLS block)
        let insertPayload: any = {
          id: responseId,
          form_id: form.id,
          sap_id: trimmedEmail.toLowerCase(),
          completion_time_seconds: completionSeconds,
        };

        let { error: respError } = await supabase
          .from("form_responses")
          .insert(insertPayload);

        // If sap_id column doesn't exist on legacy schemas, retry with respondent_ip
        if (
          respError &&
          (respError.message?.includes("sap_id") || respError.details?.includes("sap_id"))
        ) {
          insertPayload = {
            id: responseId,
            form_id: form.id,
            respondent_ip: trimmedEmail.toLowerCase(),
            completion_time_seconds: completionSeconds,
          };
          const retry = await supabase.from("form_responses").insert(insertPayload);
          respError = retry.error;
        }

        if (respError) {
          throw new Error(respError.message || respError.details || JSON.stringify(respError));
        }

        // 3b. Batch insert answers using the known responseId
        if (answerPayloads.length > 0) {
          const directPayloads = answerPayloads.map((a) => ({
            id: crypto.randomUUID(),
            response_id: responseId,
            question_id: a.question_id,
            answer_value: a.answer_value,
          }));

          const { error: ansError } = await supabase
            .from("form_answers")
            .insert(directPayloads);

          if (ansError) {
            throw new Error(ansError.message || ansError.details || JSON.stringify(ansError));
          }
        }
      }

      setIsSubmitted(true);
    } catch (err: any) {
      const errMsg =
        err?.message ||
        err?.details ||
        (typeof err === "object" ? JSON.stringify(err) : String(err));
      console.error("Submission error:", errMsg, err);
      alert(
        errMsg && errMsg !== "{}"
          ? `Submission failed: ${errMsg}`
          : "An error occurred while submitting your response. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleResetForm() {
    setAnswers({});
    setFieldErrors({});
    setEmailError("");
    if (!authenticatedUserEmail) {
      setRespondentEmail("");
    }
    setIsSubmitted(false);
    startTimeRef.current = Date.now();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#040915] text-slate-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-cyan-400" />
          <p className="text-xs font-mono tracking-wider text-cyan-300">INITIALIZING FORM...</p>
        </div>
      </div>
    );
  }

  // Gatekeeping: Form Not Found
  if (errorState === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#040915] p-6 text-slate-100">
        <div className="max-w-md w-full rounded-2xl border border-[#162f52] bg-[#0a1628] p-8 text-center shadow-[0_20px_50px_rgba(0,0,0,0.7)]">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
            <AlertCircle size={24} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Form Not Found</h2>
          <p className="text-sm text-slate-400 mb-6">
            The form you are looking for may have been deleted or the link is invalid.
          </p>
          <Link
            href="/"
            className="inline-block rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-xs font-bold text-slate-950 hover:from-cyan-400 hover:to-blue-500 transition shadow-sm"
          >
            Go to Hypervision Home
          </Link>
        </div>
      </div>
    );
  }

  // Gatekeeping: Form in Draft
  if (errorState === "draft") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#040915] p-6 text-slate-100">
        <div className="max-w-md w-full rounded-2xl border border-[#162f52] bg-[#0a1628] p-8 text-center shadow-[0_20px_50px_rgba(0,0,0,0.7)]">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Clock size={24} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Form in Draft Mode</h2>
          <p className="text-sm text-slate-400 mb-6">
            This form is currently in Draft mode and is not yet open for public submissions.
          </p>
          <p className="text-xs text-cyan-400/80 font-mono">
            If you are the creator, please publish this form in your dashboard.
          </p>
        </div>
      </div>
    );
  }

  // Gatekeeping: Form Closed
  if (errorState === "closed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#040915] p-6 text-slate-100">
        <div className="max-w-md w-full rounded-2xl border border-[#162f52] bg-[#0a1628] p-8 text-center shadow-[0_20px_50px_rgba(0,0,0,0.7)]">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-slate-800 text-slate-400">
            <Archive size={24} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Form Closed</h2>
          <p className="text-sm text-slate-400 mb-6">
            This form is no longer accepting responses. Thank you for your interest!
          </p>
        </div>
      </div>
    );
  }

  // Success Confirmation Screen
  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-[#040915] flex items-center justify-center p-6 text-slate-100">
        <div className="max-w-lg w-full rounded-3xl border border-[#162f52] bg-[#0a1628] p-8 sm:p-10 text-center shadow-[0_20px_60px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 duration-200">
          <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shadow-[0_0_25px_rgba(0,240,255,0.25)]">
            <CheckCircle2 size={36} />
          </div>

          <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight">
            Response Recorded
          </h2>

          <p className="text-sm text-slate-300 mb-4 leading-relaxed">
            Thank you! Your submission for <span className="font-semibold text-cyan-400">"{form?.title}"</span> has been successfully recorded.
          </p>

          <div className="mb-6 p-3 rounded-xl bg-[#060e1d] border border-cyan-500/30 text-xs font-mono text-slate-300 flex items-center justify-center gap-2">
            <Mail size={14} className="text-cyan-400" />
            <span>Authenticated Respondent:</span>
            <span className="text-white font-bold">{respondentEmail}</span>
          </div>

          <div className="pt-4 border-t border-[#162f52] flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={handleResetForm}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#162f52] bg-[#060e1d] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-[#0c1d35] hover:border-cyan-500/40 hover:text-white transition shadow-sm cursor-pointer"
            >
              <RotateCcw size={14} />
              <span>Submit another response</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 py-10 px-4 sm:px-6 relative overflow-hidden flex flex-col justify-between">
      {/* ASCII Digital Rain Backdrop */}
      <AsciiRainBackdrop opacity={0.35} />

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto w-full space-y-6 relative z-10 my-auto">
        {/* Form Hero Header Card */}
        <div className="rounded-3xl border border-[#162f52] bg-[#0a1628]/95 backdrop-blur-md p-7 sm:p-9 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#162f52]/80">
            <div className="flex items-center gap-3">
              <img
                alt="Hypervision Logo"
                className="w-8 h-8 object-contain bg-transparent shrink-0"
                src="/hypervision-logo.png"
              />
              <span className="text-sm font-mono font-bold tracking-wider text-cyan-400 uppercase">
                HYPERVISION FORM • INTAKE
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              ACCEPTING RESPONSES
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {form?.title || "Untitled Form"}
          </h1>
          {form?.description && (
            <p className="mt-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
              {form.description}
            </p>
          )}

          {questions.some((q) => q.is_required) && (
            <p className="mt-4 text-xs font-mono text-cyan-400/80">
              * Required fields
            </p>
          )}
        </div>

        {/* Google Forms-style Required Email Authentication Card */}
        <div
          id="respondent-email-card"
          className={`rounded-2xl border transition-all duration-200 bg-[#0a1628]/95 backdrop-blur-md p-6 sm:p-7 shadow-sm space-y-3.5 ${
            emailError
              ? "border-rose-500/80 ring-2 ring-rose-500/20"
              : "border-[#162f52] hover:border-cyan-500/30"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <label className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-1.5">
                  <Mail size={18} className="text-cyan-400" />
                  <span>Email</span>
                  <span className="text-rose-400 font-mono font-bold">*</span>
                </label>
              </div>
              <p className="text-xs text-slate-400">
                Required to authenticate and record your response identity.
              </p>
            </div>

            {authenticatedUserEmail && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-300 bg-cyan-950/50 border border-cyan-500/30 px-2.5 py-1 rounded-full shrink-0">
                <CheckCircle2 size={12} className="text-cyan-400" />
                Verified
              </span>
            )}
          </div>

          {authenticatedUserEmail ? (
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#060e1d] border border-cyan-500/30">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-cyan-950/60 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0 font-bold font-mono text-xs">
                  {authenticatedUserEmail.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-mono font-bold text-white truncate">
                    {respondentEmail}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Recording as submitting account
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAuthenticatedUserEmail(null);
                  setRespondentEmail("");
                }}
                className="text-xs font-mono text-cyan-400 hover:text-cyan-300 hover:underline ml-2 shrink-0 cursor-pointer"
              >
                Switch account
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <input
                type="email"
                required
                value={respondentEmail}
                onChange={(e) => {
                  setRespondentEmail(e.target.value);
                  if (emailError) setEmailError("");
                }}
                placeholder="your.email@example.com"
                className={`form-field ${emailError ? "!border-rose-500" : ""}`}
              />
            </div>
          )}

          {emailError && (
            <p className="text-xs font-mono font-semibold text-rose-400 flex items-center gap-1 mt-1">
              <AlertCircle size={13} />
              <span>{emailError}</span>
            </p>
          )}
        </div>

        {/* Questions List */}
        {questions.length === 0 ? (
          <div className="rounded-3xl border border-[#162f52] bg-[#0a1628] p-8 text-center shadow-sm">
            <p className="text-sm text-slate-400">
              This form does not have any questions yet.
            </p>
          </div>
        ) : (
          questions.map((q, idx) => {
            const hasError = !!fieldErrors[q.id];
            const qNum = String(idx + 1).padStart(2, "0");

            return (
              <div
                key={q.id}
                id={`q-${q.id}`}
                className={`rounded-2xl border transition-all duration-200 bg-[#0a1628]/95 p-6 sm:p-7 shadow-sm space-y-3 ${
                  hasError
                    ? "border-rose-500/80 ring-2 ring-rose-500/20"
                    : "border-[#162f52] hover:border-cyan-500/40"
                }`}
              >
                <div className="space-y-1">
                  <label className="block text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
                    {qNum}. {q.label}
                    {q.is_required && (
                      <span className="text-cyan-300 ml-1" title="Required">
                        *
                      </span>
                    )}
                  </label>
                  {q.description && (
                    <p className="text-xs text-slate-400 leading-normal">
                      {q.description}
                    </p>
                  )}
                </div>

                {/* Render Question Input According to Type */}
                <div className="pt-2">
                  {/* 1. Short Text */}
                  {q.question_type === "short_text" && (
                    <input
                      type="text"
                      value={answers[q.id] || ""}
                      onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                      placeholder="Your answer"
                      className={`form-field ${hasError ? "!border-rose-500" : ""}`}
                    />
                  )}

                  {/* 2. Long Text */}
                  {q.question_type === "long_text" && (
                    <textarea
                      rows={3}
                      value={answers[q.id] || ""}
                      onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                      placeholder="Your answer"
                      className={`form-field resize-none ${hasError ? "!border-rose-500" : ""}`}
                    />
                  )}

                  {/* 3. Multiple Choice */}
                  {q.question_type === "multiple_choice" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(q.options || []).map((rawOpt, optIdx) => {
                        const opt = getOptionLabel(rawOpt);
                        const isSelected = answers[q.id] === opt;
                        return (
                          <button
                            key={optIdx}
                            type="button"
                            onClick={() => handleAnswerChange(q.id, opt)}
                            className={`flex items-center gap-3 p-3.5 rounded-xl border text-left cursor-pointer transition select-none ${
                              isSelected
                                ? "border-cyan-400 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-400/30 font-medium"
                                : "border-[#162f52] bg-[#060e1d] hover:border-cyan-500/40 hover:bg-[#0c1e36] text-slate-300"
                            }`}
                          >
                            <div
                              className={`h-4 w-4 rounded-full border flex items-center justify-center transition ${
                                isSelected
                                  ? "border-cyan-400 bg-cyan-400"
                                  : "border-slate-600 bg-[#060e1d]"
                              }`}
                            >
                              {isSelected && (
                                <div className="h-1.5 w-1.5 rounded-full bg-slate-950" />
                              )}
                            </div>
                            <span className="text-xs font-mono">{opt}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 4. Checkboxes */}
                  {q.question_type === "checkboxes" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(q.options || []).map((rawOpt, optIdx) => {
                        const opt = getOptionLabel(rawOpt);
                        const currentVals: string[] = answers[q.id] || [];
                        const isChecked = currentVals.includes(opt);
                        return (
                          <button
                            key={optIdx}
                            type="button"
                            onClick={() => handleCheckboxToggle(q.id, opt)}
                            className={`flex items-center gap-3 p-3.5 rounded-xl border text-left cursor-pointer transition select-none ${
                              isChecked
                                ? "border-cyan-400 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-400/30 font-medium"
                                : "border-[#162f52] bg-[#060e1d] hover:border-cyan-500/40 hover:bg-[#0c1e36] text-slate-300"
                            }`}
                          >
                            <div
                              className={`h-4 w-4 rounded border flex items-center justify-center transition ${
                                isChecked
                                  ? "border-cyan-400 bg-cyan-400 text-slate-950"
                                  : "border-slate-600 bg-[#060e1d]"
                              }`}
                            >
                              {isChecked && <Check size={12} strokeWidth={3} />}
                            </div>
                            <span className="text-xs font-mono">{opt}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 5. Dropdown */}
                  {q.question_type === "dropdown" && (
                    <FormCustomDropdown
                      options={(q.options || []).map((rawOpt) => getOptionLabel(rawOpt))}
                      value={answers[q.id] || ""}
                      onChange={(val) => handleAnswerChange(q.id, val)}
                      hasError={Boolean(hasError)}
                    />
                  )}

                  {/* 6. Rating / Linear Scale */}
                  {(q.question_type === "rating" || q.question_type === "linear_scale") && (() => {
                    const config = parseScaleConfig(q.options);
                    const count = Math.max(1, config.max - config.min + 1);
                    const scaleNumbers = Array.from({ length: count }, (_, i) => config.min + i);
                    const selectedVal = answers[q.id] !== undefined && answers[q.id] !== "" ? Number(answers[q.id]) : null;

                    return (
                      <div className="flex flex-col gap-2.5 pt-1">
                        {config.format === "stars" ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {scaleNumbers.map((num) => {
                              const isFilled = selectedVal !== null && num <= selectedVal;
                              return (
                                <button
                                  key={num}
                                  type="button"
                                  onClick={() => handleAnswerChange(q.id, num)}
                                  className={`flex items-center justify-center p-3 rounded-xl border transition cursor-pointer ${
                                    isFilled
                                      ? "border-amber-400 bg-amber-950/40 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.25)]"
                                      : "border-[#162f52] bg-[#060e1d] hover:border-amber-500/40 text-slate-400 hover:text-slate-200"
                                  }`}
                                  title={`Rating: ${num}`}
                                  aria-label={`${num} star`}
                                >
                                  <Star
                                    size={24}
                                    className={
                                      isFilled
                                        ? "text-amber-400 fill-amber-400"
                                        : "text-slate-600"
                                    }
                                  />
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {scaleNumbers.map((num) => {
                              const isSelected = selectedVal === num;
                              return (
                                <button
                                  key={num}
                                  type="button"
                                  onClick={() => handleAnswerChange(q.id, num)}
                                  className={`min-w-[44px] h-11 px-3.5 rounded-xl border font-bold text-sm transition cursor-pointer ${
                                    isSelected
                                      ? "border-cyan-400 bg-cyan-950/50 text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.25)]"
                                      : "border-[#162f52] bg-[#060e1d] hover:border-cyan-500/40 text-slate-300 hover:text-white"
                                  }`}
                                >
                                  {num}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {(config.minLabel || config.maxLabel) && (
                          <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono pt-1">
                            <span>{config.minLabel ? `${config.min} = ${config.minLabel}` : ""}</span>
                            <span>{config.maxLabel ? `${config.max} = ${config.maxLabel}` : ""}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Inline Error Message */}
                {hasError && (
                  <p className="text-xs font-mono font-semibold text-rose-400 flex items-center gap-1 mt-1">
                    <AlertCircle size={13} />
                    <span>{fieldErrors[q.id]}</span>
                  </p>
                )}
              </div>
            );
          })
        )}

        {/* Submit Actions Bar */}
        {questions.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 px-6 py-3 text-sm font-bold text-slate-950 shadow-[0_0_25px_rgba(0,240,255,0.25)] transition disabled:opacity-60 cursor-pointer"
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin text-slate-950" />
              ) : null}
              <span>{submitting ? "Submitting..." : "Submit Response"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAnswers({});
                setFieldErrors({});
              }}
              className="text-xs font-mono text-slate-400 hover:text-cyan-400 transition cursor-pointer"
            >
              Clear form
            </button>
          </div>
        )}

        {/* Footer Brand */}
        <footer className="pt-6 pb-4 text-center text-xs font-mono text-slate-500 select-none">
          • © 2026 HYPERVISION. ALL RIGHT RESERVED.
        </footer>
      </form>
    </div>
  );
}
