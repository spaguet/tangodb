import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { parseAuthError } from "./authErrors";
import TurnstileWidget, { isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import { useGuestI18n } from "../hooks/useI18n";
import {
  AuthButton,
  AuthDeveloperContact,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";

export default function RegisterPage() {
  const { t, locale } = useGuestI18n();
  const { signUpWithEmail } = useAuth();
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedLogin = login.trim();
    if (!trimmedLogin) {
      setError(t("auth.register.loginRequired"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordMinLength"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (!turnstileToken) {
      setError(
        isTurnstileConfigured()
          ? t("auth.register.captchaRequired")
          : t("auth.register.captchaUnavailable")
      );
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { needsEmailConfirmation } = await signUpWithEmail(
        normalizedEmail,
        password,
        trimmedLogin,
        turnstileToken
      );

      if (needsEmailConfirmation) {
        setSuccess(t("auth.register.checkEmailDemo"));
        setTurnstileResetKey((k) => k + 1);
        setTurnstileToken(null);
      } else {
        navigate("/auth/verify-email", { replace: true });
      }
    } catch (err) {
      setError(parseAuthError(err, locale));
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.register.subtitle")}>
      <p className="text-sm text-slate-500">{t("auth.register.demoHint")}</p>

      <AuthError message={error} />
      <AuthSuccess message={success} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label={t("auth.register.loginLabel")}
          value={login}
          onChange={setLogin}
          autoComplete="nickname"
          placeholder={t("auth.register.loginPlaceholder")}
          required
        />
        <AuthField
          label="Email"
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
        <AuthButton loading={loading}>{t("auth.register.submit")}</AuthButton>
      </form>

      <p className="text-sm text-slate-500 text-center">
        {t("auth.register.hasAccount")}{" "}
        <AuthLink to="/login">{t("auth.register.signInLink")}</AuthLink>
      </p>
      <AuthDeveloperContact />
      <p className="text-xs text-slate-400 text-center">{t("auth.register.hasLicenseKey")}</p>
    </AuthLayout>
  );
}
