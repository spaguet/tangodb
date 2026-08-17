import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import {
  AuthButton,
  AuthDeveloperContact,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
} from "./AuthLayout";
import { parseAuthError } from "./authErrors";
import { useGuestI18n } from "../hooks/useI18n";
import { getOrganizationIdFromSession } from "../lib/authClaims";
import { getRememberMePreference } from "../lib/supabase";

export default function LoginPage() {
  const { t, locale } = useGuestI18n();
  const { signInWithEmail } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(getRememberMePreference);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const goAfterLogin = () => {
    navigate("/", { replace: true });
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const nextSession = await signInWithEmail(email.trim(), password, rememberMe);
      if (nextSession.user.email_confirmed_at && !getOrganizationIdFromSession(nextSession)) {
        navigate("/auth/verify-email", { replace: true });
        return;
      }
      goAfterLogin();
    } catch (err) {
      setError(parseAuthError(err, locale));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.login.subtitle")}>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <div className="w-4 h-4 rounded-full border-2 border-gold-200 border-t-gold-600 animate-spin" />
          {t("auth.login.authorizing")}
        </div>
      )}

      <AuthError message={error} />

      <form onSubmit={handleEmailLogin} className="space-y-4">
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
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="rounded border-ink-300 text-gold-700 focus:ring-gold-500"
            />
            <span className="text-sm text-ink-600">{t("auth.login.rememberMe")}</span>
          </label>
          <AuthLink to="/auth/forgot-password">{t("auth.login.forgotPasswordLink")}</AuthLink>
        </div>
        <AuthButton loading={loading}>{t("auth.login.submit")}</AuthButton>
      </form>

      <p className="text-sm text-ink-500 text-center">
        {t("auth.login.noAccount")}{" "}
        <AuthLink to="/register">{t("auth.login.registerLink")}</AuthLink>
      </p>
      <AuthDeveloperContact />
    </AuthLayout>
  );
}
