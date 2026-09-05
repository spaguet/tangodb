import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { parseAuthError } from "./authErrors";
import TurnstileWidget, { isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import { acceptInvite, completeInvite, previewInvite } from "../lib/edgeFunctions";
import { useI18n } from "../hooks/useI18n";
import { supabase } from "../lib/supabase";
import { membershipsQueryKey } from "../organization/OrganizationProvider";
import {
  extractInviteTokenFromUrl,
  scrubInviteTokenFromUrl,
  clearStashedInviteToken,
} from "./inviteUrlToken";
import {
  AuthButton,
  AuthDeveloperContact,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
} from "./AuthLayout";

export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, loading: authLoading, signInWithEmail, signOut } = useAuth();
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [orgName, setOrgName] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [accountExists, setAccountExists] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeToken, setActiveToken] = useState(() => extractInviteTokenFromUrl());
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [wrongAccount, setWrongAccount] = useState(false);
  const acceptStartedRef = useRef(false);
  const inviteAcceptedViaCompleteRef = useRef(false);

  const finishInviteSuccess = async () => {
    clearStashedInviteToken();
    await supabase.auth.refreshSession();
    await queryClient.invalidateQueries({ queryKey: membershipsQueryKey });
    setStatus("success");
    setMessage(t("auth.acceptInviteSuccess"));
    setTimeout(() => navigate("/", { replace: true }), 1500);
  };

  useEffect(() => {
    const syncTokenFromUrl = () => {
      const token = extractInviteTokenFromUrl();
      if (!token) return;
      scrubInviteTokenFromUrl();
      setActiveToken((prev) => (prev === token ? prev : token));
      setPreviewReady(false);
      setStatus("idle");
      setWrongAccount(false);
      acceptStartedRef.current = false;
    };

    syncTokenFromUrl();
    window.addEventListener("hashchange", syncTokenFromUrl);
    return () => window.removeEventListener("hashchange", syncTokenFromUrl);
  }, []);

  useEffect(() => {
    if (authLoading || !activeToken || previewReady || status === "error") return;

    let cancelled = false;

    previewInvite(activeToken)
      .then((data) => {
        if (cancelled) return;
        setAccountExists(data.account_exists === true);
        setOrgName(data.organization_name ?? null);
        setPreviewReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        setMessage(t("auth.acceptInviteError"));
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, activeToken, previewReady, status, t]);

  useEffect(() => {
    if (authLoading || !session || !previewReady || acceptStartedRef.current || wrongAccount) {
      return;
    }

    if (inviteAcceptedViaCompleteRef.current) {
      acceptStartedRef.current = true;
      void finishInviteSuccess();
      return;
    }

    const token = activeToken;
    if (!token) return;

    acceptStartedRef.current = true;
    let cancelled = false;
    setStatus("loading");

    (async () => {
      try {
        await acceptInvite(token);
        if (cancelled) return;
        await finishInviteSuccess();
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "";
        if (msg === "invite_email_mismatch" || msg === "Forbidden") {
          setWrongAccount(true);
          setStatus("idle");
          acceptStartedRef.current = false;
          return;
        }
        setStatus("error");
        setMessage(
          msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("expired")
            ? t("auth.acceptInviteError")
            : parseAuthError(err, locale)
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, session, previewReady, activeToken, wrongAccount, navigate, t, locale]);

  const handleExistingLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (isTurnstileConfigured() && !turnstileToken) {
        setFormError(t("auth.register.captchaRequired"));
        return;
      }
      await signInWithEmail(email.trim(), password, false, turnstileToken);
    } catch (err) {
      setFormError(parseAuthError(err, locale));
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!email.trim()) {
      setFormError(t("auth.acceptInviteError"));
      return;
    }
    if (password.length < 8) {
      setFormError(t("auth.passwordMinLength"));
      return;
    }
    if (password !== confirmPassword) {
      setFormError(t("auth.passwordMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      if (isTurnstileConfigured() && !turnstileToken) {
        setFormError(t("auth.register.captchaRequired"));
        return;
      }
      const result = await completeInvite(activeToken, password, email.trim());
      if (result.needs_login) {
        setAccountExists(true);
        setPassword("");
        setConfirmPassword("");
        setTurnstileResetKey((k) => k + 1);
        setTurnstileToken(null);
        return;
      }
      if (!result.ok || result.account_created !== true) {
        throw new Error(t("auth.acceptInviteError"));
      }
      inviteAcceptedViaCompleteRef.current = true;
      await signInWithEmail(email.trim(), password, false, turnstileToken);
      acceptStartedRef.current = true;
      await finishInviteSuccess();
    } catch (err) {
      setFormError(parseAuthError(err, locale));
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOutToContinue = async () => {
    setSubmitting(true);
    try {
      await signOut();
      setWrongAccount(false);
      setStatus("idle");
      acceptStartedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!session) {
    if (status === "error") {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-3 text-center">
            <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
            <p className="text-sm text-rose-600">{message || t("auth.acceptInviteError")}</p>
          </div>
        </div>
      );
    }

    if (!activeToken) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-3 text-center">
            <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
            <p className="text-sm text-slate-500">{t("auth.acceptInviteError")}</p>
          </div>
        </div>
      );
    }

    if (!previewReady) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
        </div>
      );
    }

    if (accountExists) {
      return (
        <AuthLayout
          title={t("auth.acceptInvite")}
          subtitle={orgName ? `«${orgName}»` : "TangoDB CRM"}
        >
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <UserPlus className="w-4 h-4 text-indigo-500 shrink-0" />
            <p>{t("auth.acceptInviteHint")}</p>
          </div>

          <AuthError message={formError} />

          <form onSubmit={handleExistingLogin} className="space-y-4">
            <AuthField
              label={t("auth.login.emailLabel")}
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              required
            />
            <AuthField
              label={t("auth.password")}
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              required
            />
            <TurnstileWidget
              resetKey={turnstileResetKey}
              onToken={setTurnstileToken}
              onError={() => setTurnstileToken(null)}
            />
            <AuthButton loading={submitting}>{t("auth.login.submit")}</AuthButton>
          </form>

          <p className="text-sm text-slate-500 text-center">
            <AuthLink to="/auth/forgot-password">{t("auth.login.forgotPasswordLink")}</AuthLink>
          </p>
          <AuthDeveloperContact />
        </AuthLayout>
      );
    }

    return (
      <AuthLayout
        title={t("auth.acceptInvite")}
        subtitle={orgName ? `«${orgName}»` : "TangoDB CRM"}
      >
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <UserPlus className="w-4 h-4 text-indigo-500 shrink-0" />
          <p>{t("auth.acceptInviteSetupHint")}</p>
        </div>

        <AuthError message={formError} />

        <form onSubmit={handleSetupPassword} className="space-y-4">
          <AuthField
            label={t("auth.login.emailLabel")}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />
          <AuthField
            label={t("auth.password")}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
          />
          <AuthField
            label={t("auth.confirmPassword")}
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            required
          />
          <TurnstileWidget
            resetKey={turnstileResetKey}
            onToken={setTurnstileToken}
            onError={() => setTurnstileToken(null)}
          />
          <AuthButton loading={submitting}>{t("auth.acceptInviteSubmit")}</AuthButton>
        </form>
        <AuthDeveloperContact />
      </AuthLayout>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-3 text-center">
          <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
          <p className="text-sm text-rose-600">{message || t("auth.acceptInviteError")}</p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mt-2 text-sm text-indigo-600 font-semibold hover:underline cursor-pointer"
          >
            {t("auth.acceptInvite.goHome")}
          </button>
        </div>
      </div>
    );
  }

  if (!activeToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-3 text-center">
          <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
          <p className="text-sm text-slate-500">{t("auth.acceptInviteError")}</p>
        </div>
      </div>
    );
  }

  if (!previewReady || (status === "loading" && !wrongAccount)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-3 text-center">
          <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
          <div className="flex justify-center py-4">
            <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-3 text-center">
          <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
          <p className="text-sm text-indigo-600 font-medium">{message}</p>
        </div>
      </div>
    );
  }

  if (wrongAccount) {
    return (
      <AuthLayout
        title={t("auth.acceptInvite")}
        subtitle={orgName ? `«${orgName}»` : "TangoDB CRM"}
      >
        <p className="text-sm text-slate-600">{t("auth.acceptInviteWrongAccount")}</p>
        <AuthButton type="button" loading={submitting} onClick={() => void handleSignOutToContinue()}>
          {t("auth.acceptInvite.signOutToContinue")}
        </AuthButton>
        <AuthDeveloperContact />
      </AuthLayout>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-3 text-center">
        <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
        <div className="flex justify-center py-4">
          <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
        </div>
      </div>
    </div>
  );
}
