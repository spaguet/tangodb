import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useGuestI18n } from "../hooks/useI18n";
import { isRenterActorFromSession } from "../lib/authClaims";
import { RenterActorDenied } from "./ProtectedRoute";
import { isCaptchaAuthError, parseAuthError, resolveForgotPasswordError } from "./authErrors";
import TurnstileWidget, { isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import {
  AuthButton,
  AuthDeveloperContact,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";

export default function ForgotPasswordPage() {
  const { t, locale } = useGuestI18n();
  const { resetPasswordForEmail, session, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  if (authLoading) {
    return (
      <AuthLayout title="TangoDB" subtitle={t("auth.forgotPassword.subtitle")}>
        <p className="text-sm text-slate-500">{t("auth.loading.checkingSession")}</p>
      </AuthLayout>
    );
  }
  if (session && isRenterActorFromSession(session)) {
    return <RenterActorDenied />;
  }

  const showResetSuccess = (trimmedEmail: string) => {
    setSuccess(t("auth.forgotPasswordSuccess"));
    setError(null);
    if (import.meta.env.DEV) {
      console.info("[TangoDB] Password reset link requested", { email: trimmedEmail });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const trimmedEmail = email.trim();
    try {
      if (isTurnstileConfigured() && !turnstileToken) {
        setError(t("auth.register.captchaRequired"));
        return;
      }
      await resetPasswordForEmail(trimmedEmail, turnstileToken);
      showResetSuccess(trimmedEmail);
    } catch (err) {
      if (isCaptchaAuthError(err)) {
        setError(parseAuthError(err, locale));
      } else {
        const resolved = resolveForgotPasswordError(err, locale);
        if (resolved.kind === "neutralSuccess") {
          showResetSuccess(trimmedEmail);
        } else {
          setError(resolved.message);
        }
      }
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthLayout title="TangoDB" subtitle={t("auth.forgotPassword.subtitle")}>
        <AuthSuccess message={success} />
        <p className="text-sm text-slate-600">{t("auth.forgotPassword.successHint")}</p>
        <p className="text-sm text-slate-500 text-center">
          <AuthLink to="/login">{t("auth.forgotPassword.backToLogin")}</AuthLink>
        </p>
        <AuthDeveloperContact />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.forgotPassword.subtitle")}>
      <p className="text-sm text-slate-500">{t("auth.forgotPassword.hint")}</p>
      <AuthError message={error} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <TurnstileWidget
          resetKey={turnstileResetKey}
          onToken={setTurnstileToken}
          onError={() => setTurnstileToken(null)}
        />
        <AuthButton loading={loading}>{t("auth.forgotPassword.submit")}</AuthButton>
      </form>

      <p className="text-sm text-slate-500 text-center">
        <AuthLink to="/login">{t("auth.forgotPassword.backToLogin")}</AuthLink>
      </p>
      <AuthDeveloperContact />
    </AuthLayout>
  );
}
