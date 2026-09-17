import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { isCaptchaAuthError, parseAuthError } from "./authErrors";
import TurnstileWidget, { isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import AuthSupportHelpBlock from "../components/support/AuthSupportHelpBlock";
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
import { authPasswordErrorKey, validateAuthPassword } from "./authPassword";

export default function RegisterPage() {
  const { t, locale } = useGuestI18n();
  const { signUpWithEmail, resendSignupConfirmation, session, loading: authLoading, signOut } =
    useAuth();
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    document.title = pendingEmail
      ? t("auth.register.checkEmailPageTitle")
      : t("auth.register.pageTitle");
  }, [t, locale, pendingEmail]);

  const beginRegisterAsSomeoneElse = async () => {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
      setShowRegisterForm(true);
    } finally {
      setSigningOut(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResendNotice(null);

    const trimmedLogin = login.trim();
    if (!trimmedLogin) {
      setError(t("auth.register.loginRequired"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordMinLength"));
      return;
    }
    const passwordIssue = validateAuthPassword(password);
    if (passwordIssue) {
      setError(t(authPasswordErrorKey(passwordIssue)));
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
        setPendingEmail(normalizedEmail);
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

  const handleResend = async () => {
    if (!pendingEmail) return;
    setResendLoading(true);
    setError(null);
    setResendNotice(null);
    try {
      if (isTurnstileConfigured() && !turnstileToken) {
        setError(t("auth.register.captchaRequired"));
        return;
      }
      await resendSignupConfirmation(pendingEmail, turnstileToken);
      setResendNotice(t("auth.register.resendSuccess"));
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    } catch (err) {
      const message = errorMessageForResend(err, locale, t);
      setError(message);
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setResendLoading(false);
    }
  };

  if (authLoading) {
    return (
      <AuthLayout compact title="TangoDB" subtitle={t("auth.register.subtitle")}>
        <p className="text-sm text-slate-500">{t("auth.loading.checkingSession")}</p>
      </AuthLayout>
    );
  }

  if (session && !showRegisterForm && !pendingEmail) {
    const sessionEmail = session.user.email?.trim() || t("auth.register.sessionUnknownEmail");
    return (
      <AuthLayout compact title="TangoDB" subtitle={t("auth.register.subtitle")}>
        <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-4 space-y-3">
          <p className="text-sm text-slate-700">{t("auth.register.sessionActiveHint")}</p>
          <p className="text-sm font-semibold text-slate-800 break-all">
            {t("auth.register.sessionLoggedInAs", { email: sessionEmail })}
          </p>
          <div className="flex flex-col gap-2">
            <AuthButton type="button" onClick={() => navigate("/", { replace: true })}>
              {t("auth.register.continueSession")}
            </AuthButton>
            <AuthButton
              type="button"
              variant="secondary"
              loading={signingOut}
              onClick={() => void beginRegisterAsSomeoneElse()}
            >
              {t("auth.register.notMe")}
            </AuthButton>
            <AuthButton
              type="button"
              variant="secondary"
              loading={signingOut}
              onClick={() => void beginRegisterAsSomeoneElse()}
            >
              {t("auth.register.newStudio")}
            </AuthButton>
          </div>
        </div>
        <p className="text-sm text-slate-500 text-center">
          {t("auth.register.hasAccount")}{" "}
          <AuthLink to="/login">{t("auth.register.signInLink")}</AuthLink>
        </p>
      </AuthLayout>
    );
  }

  if (pendingEmail) {
    return (
      <AuthLayout compact title="TangoDB" subtitle={t("auth.register.checkEmailSubtitle")}>
        <AuthSuccess message={t("auth.register.checkEmailDemo")} />
        <p className="text-sm text-slate-600">{t("auth.register.checkEmailSentTo", { email: pendingEmail })}</p>
        <p className="text-sm text-slate-500">{t("auth.register.checkEmailSpamHint")}</p>
        <p className="text-xs text-slate-500">{t("auth.register.checkEmailSubjectHint")}</p>

        <AuthError message={error} />
        <AuthSuccess message={resendNotice} />

        <div className="space-y-3">
          <TurnstileWidget
            resetKey={turnstileResetKey}
            onToken={setTurnstileToken}
            onError={() => setTurnstileToken(null)}
          />
          <AuthButton
            type="button"
            loading={resendLoading}
            disabled={isTurnstileConfigured() && !turnstileToken}
            onClick={() => void handleResend()}
          >
            {t("auth.register.resendConfirmation")}
          </AuthButton>
          <p className="text-xs text-slate-400 text-center">{t("auth.register.resendCooldownHint")}</p>
        </div>

        <p className="text-sm text-slate-500 text-center">
          <AuthLink to="/login">{t("auth.register.signInLink")}</AuthLink>
        </p>
        <AuthSupportHelpBlock
          ticketKind="login_help"
          pagePath="/register"
          titleKey="support.ticket.confirmEmailHelpTitle"
          hintKey="support.ticket.confirmEmailHelpHint"
        />
        <AuthDeveloperContact />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout compact title="TangoDB" subtitle={t("auth.register.subtitle")}>
      <p className="text-xs text-slate-500 leading-snug">{t("auth.register.demoHint")}</p>

      <form onSubmit={handleSubmit} noValidate className="space-y-2.5">
        <AuthField
          label={t("auth.register.loginLabel")}
          value={login}
          onChange={setLogin}
          autoComplete="nickname"
          placeholder={t("auth.register.loginPlaceholder")}
          required
        />
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
        <p className="text-xs text-slate-500 -mt-0.5">{t("auth.passwordRulesHint")}</p>
        <AuthField
          label={t("auth.confirmPassword")}
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          required
        />
        <AuthError message={error} />
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
      <AuthSupportHelpBlock
        ticketKind="login_help"
        pagePath="/register"
        titleKey="support.ticket.registerHelpTitle"
        hintKey="support.ticket.registerHelpHint"
      />
      <AuthDeveloperContact />
      <p className="text-xs text-slate-400 text-center">{t("auth.register.hasLicenseKey")}</p>
    </AuthLayout>
  );
}

function errorMessageForResend(
  err: unknown,
  locale: string,
  t: (key: import("../lib/i18n/keys").I18nKey, vars?: Record<string, string | number>) => string
): string {
  if (isCaptchaAuthError(err)) {
    return parseAuthError(err, locale);
  }
  const message =
    err instanceof Error
      ? err.message.toLowerCase()
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message).toLowerCase()
        : "";
  if (message.includes("rate limit") || message.includes("security purposes")) {
    return t("auth.forgotPassword.rateLimit");
  }
  return parseAuthError(err, locale);
}
