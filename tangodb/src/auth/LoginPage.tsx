import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { isNativeCrmShell } from "../lib/platform";
import {
  isNativeAuthHandoffSearch,
  NATIVE_AUTH_RETURN_FAILED_EVENT,
} from "../lib/nativeAuthHandoff";
import { openNativeLoginInBrowser, returnSessionToNativeShell } from "../lib/nativeAuthReturn";
import {
  AuthButton,
  AuthDeveloperContact,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
} from "./AuthLayout";
import { parseAuthError } from "./authErrors";
import TurnstileWidget, { isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import { useGuestI18n } from "../hooks/useI18n";
import { getRememberMePreference } from "../lib/supabase";
import { requestOrganizationSelectionAfterLogin } from "../organization/organizationSelectionIntent";
import AuthSupportHelpBlock from "../components/support/AuthSupportHelpBlock";

export default function LoginPage() {
  const { t, locale } = useGuestI18n();
  const { signInWithEmail, session } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(getRememberMePreference);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [browserOpening, setBrowserOpening] = useState(false);
  const nativeShell = isNativeCrmShell();
  const nativeHandoff = isNativeAuthHandoffSearch(window.location.search);
  const showBrowserLogin = nativeShell;
  const nativeNeedsBrowserCaptcha = nativeShell && !isTurnstileConfigured();
  const handoffPending = useRef(false);

  useEffect(() => {
    document.title = t("auth.login.pageTitle");
  }, [t, locale]);

  useEffect(() => {
    if (!nativeShell) return;
    const onFailed = () => setError(t("auth.login.nativeReturnFailed"));
    window.addEventListener(NATIVE_AUTH_RETURN_FAILED_EVENT, onFailed);
    return () => window.removeEventListener(NATIVE_AUTH_RETURN_FAILED_EVENT, onFailed);
  }, [nativeShell, t]);

  useEffect(() => {
    if (!handoffPending.current || !nativeHandoff || nativeShell || !session?.access_token || !session.refresh_token) {
      return;
    }
    handoffPending.current = false;
    let cancelled = false;
    void returnSessionToNativeShell(session, rememberMe).catch((err) => {
      if (!cancelled) setError(parseAuthError(err, locale));
    });
    return () => {
      cancelled = true;
    };
  }, [nativeHandoff, nativeShell, session, rememberMe, locale]);

  const goAfterLogin = () => {
    navigate("/", { replace: true });
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isTurnstileConfigured() && !turnstileToken) {
        setError(t("auth.register.captchaRequired"));
        return;
      }
      if (nativeHandoff && !nativeShell) handoffPending.current = true;
      const nextSession = await signInWithEmail(email.trim(), password, rememberMe, turnstileToken);
      if (nativeHandoff && !nativeShell) return;
      requestOrganizationSelectionAfterLogin(nextSession.user.id);
      goAfterLogin();
    } catch (err) {
      handoffPending.current = false;
      setError(parseAuthError(err, locale));
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.login.subtitle")}>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
          {t("auth.login.authorizing")}
        </div>
      )}

      <AuthError message={error} />

      {showBrowserLogin && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t("auth.login.nativeBrowserHint")}</p>
          <AuthButton
            type="button"
            variant="secondary"
            loading={browserOpening}
            onClick={() => {
              setError(null);
              setBrowserOpening(true);
              void openNativeLoginInBrowser()
                .catch(() => setError(t("auth.login.nativeReturnFailed")))
                .finally(() => setBrowserOpening(false));
            }}
          >
            {t("auth.login.nativeBrowser")}
          </AuthButton>
        </div>
      )}

      {nativeHandoff && !nativeShell && (
        <p className="text-sm text-slate-600">{t("auth.login.nativeHandoffHint")}</p>
      )}

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
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-600">{t("auth.login.rememberMe")}</span>
          </label>
          <AuthLink to="/auth/forgot-password">{t("auth.login.forgotPasswordLink")}</AuthLink>
        </div>
        <TurnstileWidget
          resetKey={turnstileResetKey}
          onToken={setTurnstileToken}
          onError={() => setTurnstileToken(null)}
        />
        <AuthButton loading={loading} disabled={nativeNeedsBrowserCaptcha}>
          {t("auth.login.submit")}
        </AuthButton>
      </form>

      <p className="text-sm text-slate-500 text-center">
        {t("auth.login.noAccount")}{" "}
        <AuthLink to="/register">{t("auth.login.registerLink")}</AuthLink>
      </p>
      <AuthSupportHelpBlock ticketKind="login_help" pagePath="/login" />
      <AuthDeveloperContact />
    </AuthLayout>
  );
}
