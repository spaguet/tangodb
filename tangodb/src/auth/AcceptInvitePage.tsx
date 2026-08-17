import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { acceptInvite, completeInvite, previewInvite } from "../lib/edgeFunctions";
import { useI18n } from "../hooks/useI18n";
import { supabase } from "../lib/supabase";
import { membershipsQueryKey } from "../organization/OrganizationProvider";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
} from "./AuthLayout";

const PENDING_INVITE_KEY = "tangodb_pending_invite_token";

export function storePendingInviteToken(token: string) {
  sessionStorage.setItem(PENDING_INVITE_KEY, token);
}

export function consumePendingInviteToken(): string | null {
  const token = sessionStorage.getItem(PENDING_INVITE_KEY);
  if (token) sessionStorage.removeItem(PENDING_INVITE_KEY);
  return token;
}

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const tokenFromUrl = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [orgName, setOrgName] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeToken, setActiveToken] = useState("");
  const previewStartedRef = useRef(false);
  const acceptStartedRef = useRef(false);

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
    const stored = sessionStorage.getItem(PENDING_INVITE_KEY);
    if (stored) setActiveToken(stored);
  }, [tokenFromUrl]);

  useEffect(() => {
    if (authLoading || session || !activeToken || previewStartedRef.current) return;

    previewStartedRef.current = true;
    let cancelled = false;
    setPreviewLoading(true);
    setFormError(null);

    previewInvite(activeToken)
      .then((data) => {
        if (cancelled) return;
        setInviteEmail(data.email ?? "");
        setOrgName(data.organization_name ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : t("auth.acceptInviteError"));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, session, activeToken, t]);

  useEffect(() => {
    if (authLoading || !session || acceptStartedRef.current) return;

    const token = tokenFromUrl || sessionStorage.getItem(PENDING_INVITE_KEY);
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
        setStatus("error");
        setMessage(err instanceof Error ? err.message : t("auth.acceptInviteError"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, session, tokenFromUrl, navigate, t]);

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

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
      const result = await completeInvite(activeToken, password);
      if (!result.access_token || !result.refresh_token) {
        throw new Error(t("auth.acceptInviteError"));
      }
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (sessionError) throw sessionError;
      sessionStorage.removeItem(PENDING_INVITE_KEY);
      await finishInviteSuccess();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("auth.acceptInviteError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-50">
        <div className="w-8 h-8 rounded-full border-4 border-gold-200 border-t-gold-600 animate-spin" />
      </div>
    );
  }

  if (!session) {
    if (status === "error") {
      return (
        <div className="min-h-screen flex items-center justify-center bg-ink-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-ink-200 shadow-xs p-6 space-y-3 text-center">
            <h1 className="text-lg font-semibold text-ink-900">{t("auth.acceptInvite")}</h1>
            <p className="text-sm text-garnet-600">{message || t("auth.acceptInviteError")}</p>
          </div>
        </div>
      );
    }

    if (previewLoading || !inviteEmail) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-ink-50">
          <div className="w-8 h-8 rounded-full border-4 border-gold-200 border-t-gold-600 animate-spin" />
        </div>
      );
    }

    return (
      <AuthLayout
        title={t("auth.acceptInvite")}
        subtitle={orgName ? `«${orgName}»` : "TangoDB CRM"}
      >
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <UserPlus className="w-4 h-4 text-gold-500 shrink-0" />
          <p>{t("auth.acceptInviteSetupHint")}</p>
        </div>

        <AuthError message={formError} />

        <form onSubmit={handleSetupPassword} className="space-y-4">
          <AuthField
            label="Email"
            type="email"
            value={inviteEmail}
            onChange={() => {}}
            readOnly
            autoComplete="email"
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
    <div className="min-h-screen flex items-center justify-center bg-ink-50 p-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-ink-200 shadow-xs p-6 space-y-3 text-center">
        <h1 className="text-lg font-semibold text-ink-900">{t("auth.acceptInvite")}</h1>
        {status === "loading" && (
          <div className="flex justify-center py-4">
            <div className="w-8 h-8 rounded-full border-4 border-gold-200 border-t-gold-600 animate-spin" />
          </div>
        )}
        {status === "success" && (
          <p className="text-sm text-gold-700 font-medium">{message}</p>
        )}
        {status === "error" && (
          <>
            <p className="text-sm text-garnet-600">{message || t("auth.acceptInviteError")}</p>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mt-2 text-sm text-gold-700 font-semibold hover:underline cursor-pointer"
            >
              {t("auth.acceptInvite.goHome")}
            </button>
          </>
        )}
        {status === "idle" && !tokenFromUrl && (
          <p className="text-sm text-ink-500">{t("auth.acceptInviteError")}</p>
        )}
      </div>
    </div>
  );
}
