import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useGuestI18n } from "../hooks/useI18n";
import { isCaptchaAuthError, parseAuthError } from "./authErrors";
import TurnstileWidget, { isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";

export default function ForgotPasswordPage() {
  const { t, locale } = useGuestI18n();
  const { resetPasswordForEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (isTurnstileConfigured() && !turnstileToken) {
        setError(t("auth.register.captchaRequired"));
        return;
      }
      await resetPasswordForEmail(email.trim(), turnstileToken);
      setSuccess(t("auth.forgotPasswordSuccess"));
    } catch (err) {
      if (isCaptchaAuthError(err)) {
        setError(parseAuthError(err, locale));
      } else {
        setSuccess(t("auth.forgotPasswordSuccess"));
      }
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.forgotPassword.subtitle")}>
      <p className="text-sm text-slate-500">{t("auth.forgotPassword.hint")}</p>
      <AuthError message={error} />
      <AuthSuccess message={success} />

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
    </AuthLayout>
  );
}
