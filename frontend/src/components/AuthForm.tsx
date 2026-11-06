"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2, Mail, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isDesignatedAdmin } from "@/lib/auth-config";
import AsciiRainBackdrop from "@/components/AsciiRainBackdrop";

type Mode = "login" | "register" | "forgot" | "reset";

export default function AuthForm({ mode: initialMode = "login" }: { mode?: Mode }) {
  const router = useRouter();
  const [currentMode, setCurrentMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submittedApproval, setSubmittedApproval] = useState(false);
  const [pendingApprovalNotice, setPendingApprovalNotice] = useState(false);

  useEffect(() => {
    setCurrentMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const err = params.get("error");
      if (err === "pending_approval") {
        setPendingApprovalNotice(true);
      } else if (err === "access_denied" || err === "unauthorized") {
        setError("Access Restricted: Only approved accounts can access this workspace.");
      }
    }
  }, []);

  function switchMode(newMode: Mode) {
    setCurrentMode(newMode);
    setError("");
    setMessage("");
    setPendingApprovalNotice(false);
  }

  function getNextUrl(): string {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        return next;
      }
    }
    return "/dashboard";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");
    setPendingApprovalNotice(false);

    try {
      const supabase = createClient();
      const targetUrl = getNextUrl();

      if (currentMode === "login") {
        const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;

        if (!authData.user) {
          throw new Error("Unable to establish user session.");
        }

        const userEmail = (authData.user.email || "").toLowerCase();
        const adminUser = isDesignatedAdmin(userEmail);
        const isApproved =
          adminUser ||
          authData.user.app_metadata?.is_approved === true ||
          authData.user.user_metadata?.is_approved === true;

        if (!isApproved) {
          // Double check profiles table as fallback
          const { data: profile } = await supabase
            .from("profiles")
            .select("is_approved")
            .eq("id", authData.user.id)
            .maybeSingle();

          if (!profile?.is_approved) {
            await supabase.auth.signOut();
            setPendingApprovalNotice(true);
            setError("");
            return;
          }
        }

        router.push(targetUrl);
        router.refresh();
      } else if (currentMode === "register") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        });
        if (signUpError) throw signUpError;

        // Disallow immediate session for unapproved registrations
        await supabase.auth.signOut();
        setSubmittedApproval(true);
      } else if (currentMode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;

        setMessage(
          "If an account exists for this email, a password reset link has been sent."
        );
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;

        setMessage("Password updated successfully.");
        switchMode("login");
      }
    } catch (err) {
      console.error("Authentication error:", err);
      let msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      if (msg === "Failed to fetch") {
        msg = "Unable to reach Supabase. Check your internet connection or adblocker.";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function signInWith(provider: "google" | "github") {
    setError("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to start social sign-in."
      );
    }
  }

  const isAuthTab = currentMode === "login" || currentMode === "register";

  return (
    <div className="bg-[#090e1a] text-[#f1f5f9] antialiased min-h-screen selection:bg-sky-500/20 selection:text-sky-300 relative overflow-x-hidden font-sans flex flex-col justify-between">
      {/* Top Header */}
      <header className="fixed top-0 left-0 right-0 w-full z-20 backdrop-blur-md bg-[#090e1a]/70 border-b border-[#1f293d]/60 px-6 sm:px-12 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <img
            alt="Hypervision Logo"
            className="w-12 h-12 sm:w-14 sm:h-14 object-contain bg-transparent shrink-0"
            src="/hypervision-logo.png"
          />
          <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Hypervision
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#94a3b8] font-mono hidden sm:inline-block">
            WORKSPACE PORTAL
          </span>
        </div>
      </header>

      {/* Full-bleed Fixed ASCII Digital Rain Backdrop */}
      <AsciiRainBackdrop opacity={0.75} />

      <div className="relative z-10 flex-1 w-full flex flex-col lg:flex-row pt-20 pb-16">
        {/* LEFT COLUMN: AUTHENTICATION */}
        <div className="w-full lg:w-[48%] xl:w-[45%] flex flex-col p-6 sm:p-10 lg:p-12 xl:p-16 backdrop-blur-md bg-[#090e1a]/40 border-r border-[#1f293d]/50 order-2 lg:order-1">
          {/* Center Card / Form Section */}
          <div className="py-4 max-w-[440px] w-full mx-auto">
            {/* Centered Card Container */}
            <div className="bg-[#111827]/80 border border-[#1f293d]/90 rounded-2xl p-6 sm:p-7 shadow-2xl shadow-black/70 relative overflow-hidden backdrop-blur-xl md:backdrop-blur-2xl">
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />

              {/* Greeting and heading */}
              <div className="mb-6">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                  {currentMode === "login"
                    ? "Welcome back"
                    : currentMode === "register"
                    ? "Create your account"
                    : currentMode === "forgot"
                    ? "Reset your password"
                    : "Choose a new password"}
                </h1>
                <p className="text-sm text-[#94a3b8] mt-1.5">
                  {currentMode === "login"
                    ? "Enter your credentials to access your workspace"
                    : currentMode === "register"
                    ? "Start building and collaborating in seconds."
                    : currentMode === "forgot"
                    ? "We'll send you a link to reset your password."
                    : "Make sure it's strong and easy to remember."}
                </p>
              </div>

              {/* Segmented Mode Switcher Tabs */}
              {isAuthTab && !submittedApproval && (
                <div className="grid grid-cols-2 p-1 bg-[#0b0f19]/90 border border-[#1f293d] rounded-lg mb-6">
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className={`py-2 text-sm font-medium rounded-md transition-all duration-200 ease-in-out active:scale-[0.98] cursor-pointer ${
                      currentMode === "login"
                        ? "bg-[#1e293b] text-white shadow-sm"
                        : "text-[#94a3b8] hover:text-white"
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode("register")}
                    className={`py-2 text-sm font-medium rounded-md transition-all duration-200 ease-in-out active:scale-[0.98] cursor-pointer ${
                      currentMode === "register"
                        ? "bg-[#1e293b] text-white shadow-sm"
                        : "text-[#94a3b8] hover:text-white"
                    }`}
                  >
                    Request Account
                  </button>
                </div>
              )}

              {/* Status / Error Alerts */}
              {pendingApprovalNotice && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl bg-amber-950/60 border border-amber-500/50 px-4 py-3 shadow-lg shadow-amber-950/40 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-amber-400 text-lg shrink-0">hourglass_top</span>
                    <span className="text-xs font-semibold text-amber-200">
                      Admin approval pending.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingApprovalNotice(false)}
                    className="text-amber-400/60 hover:text-amber-200 text-xs w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer"
                    title="Dismiss"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg bg-rose-950/50 border border-rose-900/60 px-3.5 py-2.5 text-xs text-rose-300"
                >
                  {error}
                </div>
              )}

              {message && (
                <div
                  role="status"
                  className="mb-4 rounded-lg bg-emerald-950/50 border border-emerald-900/60 px-3.5 py-2.5 text-xs text-emerald-300"
                >
                  {message}
                </div>
              )}

              {submittedApproval ? (
                <div className="py-6 px-4 text-center space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto shadow-lg shadow-amber-500/10">
                    <span className="material-symbols-outlined text-2xl">hourglass_top</span>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-white tracking-tight">
                      Admin approval pending
                    </h3>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto">
                      Your account request has been submitted.
                    </p>
                  </div>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSubmittedApproval(false);
                        switchMode("login");
                      }}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs font-medium rounded-xl transition-all cursor-pointer shadow-sm"
                    >
                      Return to Sign In
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Auth Form */}
                  <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Admin Approval Notice for New Accounts */}
                  {currentMode === "register" && (
                    <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2 mb-2">
                      <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0">verified_user</span>
                      <span>Admin approval required for new accounts.</span>
                    </div>
                  )}

                  {/* Full Name (Sign Up Mode) */}
                  {currentMode === "register" && (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-[#94a3b8]" htmlFor="input-fullname">
                        Full Name
                      </label>
                      <div className="relative">
                        <input
                          id="input-fullname"
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Sarah Connor"
                          required
                          className="w-full px-3.5 py-2.5 rounded-lg bg-[#0b0f19]/90 text-white text-sm placeholder-[#64748b] border border-[#334155] hover:border-slate-500 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 transition-all duration-200 ease-in-out"
                        />
                        <User className="absolute right-3 top-2.5 text-[#64748b] pointer-events-none" size={18} />
                      </div>
                    </div>
                  )}

                {/* Email */}
                {currentMode !== "reset" && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#94a3b8]" htmlFor="input-email">
                      Work Email
                    </label>
                    <div className="relative">
                      <input
                        id="input-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="alex@company.com"
                        required
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#0b0f19]/90 text-white text-sm placeholder-[#64748b] border border-[#334155] hover:border-slate-500 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 transition-all duration-200 ease-in-out"
                      />
                      <Mail className="absolute right-3 top-2.5 text-[#64748b] pointer-events-none" size={18} />
                    </div>
                  </div>
                )}

                {/* Password */}
                {currentMode !== "forgot" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-[#94a3b8]" htmlFor="input-password">
                        Password
                      </label>
                      {currentMode === "login" && (
                        <button
                          type="button"
                          onClick={() => switchMode("forgot")}
                          className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        id="input-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        required
                        minLength={currentMode === "register" || currentMode === "reset" ? 8 : 1}
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#0b0f19]/90 text-white text-sm placeholder-[#64748b] border border-[#334155] hover:border-slate-500 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 transition-all duration-200 ease-in-out pr-10"
                      />
                      <button
                        type="button"
                        aria-label="Toggle password visibility"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 text-[#64748b] hover:text-white transition-all duration-200 ease-in-out focus:outline-none active:scale-90"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Remember Device Checkbox */}
                {currentMode === "login" && (
                  <div className="flex items-center pt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded bg-[#0b0f19] border-[#334155] text-sky-500 focus:ring-sky-400 focus:ring-offset-0 focus:ring-offset-transparent cursor-pointer"
                      />
                      <span className="text-xs text-[#94a3b8]">Remember me</span>
                    </label>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-3 py-2.5 px-4 rounded-lg bg-sky-500 hover:bg-sky-400 hover:shadow-lg hover:shadow-sky-500/25 active:scale-[0.98] text-slate-950 font-medium text-sm transition-all duration-200 ease-in-out flex items-center justify-center gap-2 shadow-sm cursor-pointer group disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 size={16} className="animate-spin text-slate-950" />
                  ) : (
                    <>
                      <span>
                        {currentMode === "login"
                          ? "Sign In to Workspace"
                          : currentMode === "register"
                          ? "Create Account"
                          : currentMode === "forgot"
                          ? "Send reset link"
                          : "Update password"}
                      </span>
                      <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5 duration-200" />
                    </>
                  )}
                </button>
              </form>

              {/* Social Login Options */}
              {isAuthTab && (
                <>
                  <div className="relative flex items-center justify-center my-6">
                    <div className="w-full border-t border-[#1f293d]" />
                    <span className="absolute px-3 bg-[#111827] text-[11px] uppercase tracking-wider text-[#64748b]">
                      or continue with
                    </span>
                  </div>

                  <div className="grid gap-3">
                    <button
                      type="button"
                      onClick={() => signInWith("google")}
                      className="flex items-center justify-center gap-2.5 px-3 py-2.5 rounded-lg border border-[#334155] hover:border-slate-500/60 bg-[#161f30]/70 hover:bg-[#1e293b] active:scale-[0.98] text-[#f1f5f9] text-xs font-medium transition-all duration-200 ease-in-out w-full cursor-pointer shadow-sm hover:shadow group backdrop-blur-sm"
                    >
                      <svg className="w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-105" viewBox="0 0 24 24">
                        <path d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.3 8.9 5 12 5z" fill="#EA4335" />
                        <path d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z" fill="#4285F4" />
                        <path d="M5.3 14.7c-.2-.7-.4-1.4-.4-2.2s.2-1.5.4-2.2L1.6 7.4C.6 9.4 0 11.6 0 14s.6 4.6 1.6 6.6l3.7-2.9z" fill="#FBBC05" />
                        <path d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.3-6.7-5.3L1.6 16c1.9 3.8 5.8 7 10.4 7z" fill="#34A853" />
                      </svg>
                      <span>Continue with Google</span>
                    </button>
                  </div>
                </>
              )}
            </>
          )}

              {/* Forgot Mode Switchback */}
              {!isAuthTab && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="text-xs text-sky-400 hover:text-sky-300 underline"
                  >
                    Back to sign in
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: HYPERVISION SHOWCASE */}
        <div className="w-full lg:w-[52%] xl:w-[55%] relative flex flex-col justify-center overflow-hidden bg-transparent order-1 lg:order-2 py-8 lg:py-0">
          {/* Right Center Feature Hero */}
          <div className="relative z-10 px-8 sm:px-14 lg:px-16 max-w-2xl">
            {/* Prominent Title */}
            <h2 className="text-5xl sm:text-6xl xl:text-7xl font-extrabold tracking-tight text-white leading-[1.05]">
              Hypervision <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-sky-200 to-indigo-300">
                Forms
              </span>
            </h2>
            {/* Sub-headline */}
            <p className="mt-5 text-base sm:text-lg text-slate-300/90 leading-relaxed font-normal max-w-lg">
              Innovate. Collaborate. Elevate. Intelligent data collection designed for high-velocity engineering and product teams.
            </p>
          </div>
        </div>
      </div>

      {/* Static / Bottom-Pinned Global Footer */}
      <footer className="fixed bottom-0 left-0 right-0 z-20 w-full py-3 sm:py-3.5 px-6 sm:px-12 flex items-center justify-between text-xs text-slate-500 font-mono border-t border-[#1f293d]/60 bg-[#090e1a]/85 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500 uppercase tracking-wider hidden sm:inline">
            Hypervision Forms Portal
          </span>
        </div>
        <div className="text-[11px] text-slate-500 tracking-wider">
          © 2026 HYPERVISION. ALL RIGHT RESERVED.
        </div>
      </footer>
    </div>
  );
}
