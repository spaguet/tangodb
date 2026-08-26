import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { parseAuthError } from "./authErrors";
import { acceptInvite, completeInvite, previewInvite } from "../lib/edgeFunctions";
import { useI18n } from "../hooks/useI18n";
import { supabase } from "../lib/supabase";
import { membershipsQueryKey } from "../organization/OrganizationProvider";
import {
  clearPendingInviteToken,
  peekPendingInviteToken,
  storePendingInviteToken,
} from "./pendingInviteToken";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
} from "./AuthLayout";

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, loading: authLoading, signInWithEmail } = useAuth();
  const { t, locale } = useI18n();
  const tokenFromUrl = searchParams.get("token") ?? "";
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
  const [activeToken, setActiveToken] = useState(
    () => tokenFromUrl || peekPendingInviteToken() || ""
  );
  const acceptStartedRef = useRef(false);
  const inviteAcceptedViaCompleteRef = useRef(false);

  const finishInviteSuccess = async () => {
    await supabase.auth.refreshSession();
    await queryClient.invalidateQueries({ queryKey: membershipsQueryKey });
    setStatus("success");
    setMessage(t("auth.acceptInviteSuccess"));
    setTimeout(() => navigate("/", { replace: true }), 1500);
  };

  useEffect(() => {
    if (tokenFromUrl) {
      storePendingInviteToken(tokenFromUrl);
      setActiveToken(tokenFromUrl);
      return;
    }
    const stored = peekPendingInviteToken();
    if (stored) setActiveToken(stored);
  }, [tokenFromUrl]);

  useEffect(() => {
    if (authLoading || session || !activeToken) return;

    let cancelled = false;

    previewInvite(activeToken)
      .then((data) => {
        if (cancelled) return;
        setAccountExists(data.account_exists === true);
        setOrgName(data.organization_name ?? null);
        setPreviewReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : t("auth.acceptInviteError"));
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, session, activeToken, t]);

  useEffect(() => {
    if (authLoading || !session || acceptStartedRef.current) return;

    const token = tokenFromUrl || peekPendingInviteToken();
    if (!token && !inviteAcceptedViaCompleteRef.current) return;

    acceptStartedRef.current = true;
    let cancelled = false;
    setStatus("loading");

    (async () => {
      try {
        if (!inviteAcceptedViaCompleteRef.current) {
          if (!token) throw new Error(t("auth.acceptInviteError"));
          await acceptInvite(token);
        }
        if (cancelled) return;
        await finishInviteSuccess();
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : t("auth.acceptInviteError"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, session, tokenFromUrl, navigate, t]);

  const handleExistingLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email.trim(), password);
    } catch (err) {
      setFormError(parseAuthError(err, locale));
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
      const result = await completeInvite(activeToken, password, email.trim());
      if (result.needs_login) {
        setAccountExists(true);
        setPassword("");
        setConfirmPassword("");
        return;
      }
      if (!result.ok || result.account_created !== true) {
        throw new Error(t("auth.acceptInviteError"));
      }
      inviteAcceptedViaCompleteRef.current = true;
      clearPendingInviteToken();
      const { error: sessionError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (sessionError) {
        setAccountExists(true);
        throw sessionError;
      }
      acceptStartedRef.current = true;
      await finishInviteSuccess();
    } catch (err) {
      setFormError(parseAuthError(err, locale));
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
            <AuthButton loading={submitting}>{t("auth.login.submit")}</AuthButton>
          </form>

          <p className="text-sm text-slate-500 text-center">
            <AuthLink to="/auth/forgot-password">{t("auth.login.forgotPasswordLink")}</AuthLink>
          </p>
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
          <AuthButton loading={submitting}>{t("auth.acceptInviteSubmit")}</AuthButton>
        </form>
      </AuthLayout>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-3 text-center">
        <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
        {status === "loading" && (
          <div className="flex justify-center py-4">
            <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
          </div>
        )}
        {status === "success" && (
          <p className="text-sm text-indigo-600 font-medium">{message}</p>
        )}
        {status === "error" && (
          <>
            <p className="text-sm text-rose-600">{message || t("auth.acceptInviteError")}</p>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mt-2 text-sm text-indigo-600 font-semibold hover:underline cursor-pointer"
            >
              {t("auth.acceptInvite.goHome")}
            </button>
          </>
        )}
        {status === "idle" && !tokenFromUrl && (
          <p className="text-sm text-slate-500">{t("auth.acceptInviteError")}</p>
        )}
      </div>
    </div>
  );
}
