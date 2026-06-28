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

// Telegram login temporarily disabled — email/password only.
// import { useEffect, useRef } from "react";
// import { Send } from "lucide-react";
// import {
//   getTelegramInitData,
//   initTelegramWebApp,
//   isInsideTelegramClient,
//   isTelegramWebApp,
// } from "../lib/telegram";
// import type { TelegramLoginWidgetPayload } from "../lib/telegram";
//
// declare global {
//   interface Window {
//     onTelegramAuth?: (user: TelegramLoginWidgetPayload) => void;
//   }
// }
//
// type LoginTab = "telegram" | "email";

export default function LoginPage() {
  const { t, locale } = useGuestI18n();
  const { signInWithEmail } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(getRememberMePreference);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // const widgetRef = useRef<HTMLDivElement>(null);
  // const [tab, setTab] = useState<LoginTab>(isInsideTelegramClient() ? "telegram" : "email");
  // const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? "";
  // const { signInWithTelegram, session } = useAuth();

  const goAfterLogin = (opts?: { isNewDemo?: boolean; needsOrgPicker?: boolean }) => {
    if (opts?.needsOrgPicker) {
      navigate("/select-organization", { replace: true });
      return;
    }
    navigate(opts?.isNewDemo ? "/onboarding" : "/", { replace: true });
  };

  // useEffect(() => {
  //   if (!isTelegramWebApp() || session) return;
  //
  //   initTelegramWebApp();
  //   const initData = getTelegramInitData();
  //   if (!initData) return;
  //
  //   setLoading(true);
  //   signInWithTelegram({ initData })
  //     .then((result) => {
  //       if (!result.recoveryCode) {
  //         goAfterLogin({ isNewDemo: result.isNewDemo, needsOrgPicker: result.needsOrgPicker });
  //       }
  //     })
  //     .catch((err: Error) => setError(err.message ?? t("auth.login.telegramError")))
  //     .finally(() => setLoading(false));
  // }, [signInWithTelegram, session, t]);
  //
  // useEffect(() => {
  //   if (isInsideTelegramClient() || !botUsername || !widgetRef.current) return;
  //
  //   window.onTelegramAuth = async (user: TelegramLoginWidgetPayload) => {
  //     setLoading(true);
  //     setError(null);
  //     try {
  //       const result = await signInWithTelegram({ widgetPayload: user });
  //       if (!result.recoveryCode) {
  //         goAfterLogin({ isNewDemo: result.isNewDemo, needsOrgPicker: result.needsOrgPicker });
  //       }
  //     } catch (err) {
  //       setError(err instanceof Error ? err.message : t("auth.login.error"));
  //     } finally {
  //       setLoading(false);
  //     }
  //   };
  //
  //   const script = document.createElement("script");
  //   script.src = "https://telegram.org/js/telegram-widget.js?22";
  //   script.async = true;
  //   script.setAttribute("data-telegram-login", botUsername);
  //   script.setAttribute("data-size", "large");
  //   script.setAttribute("data-onauth", "onTelegramAuth(user)");
  //   widgetRef.current.innerHTML = "";
  //   widgetRef.current.appendChild(script);
  //
  //   return () => {
  //     delete window.onTelegramAuth;
  //   };
  // }, [botUsername, signInWithTelegram, navigate]);

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
      {/* Telegram / email tabs — disabled
      <div className="flex rounded-lg border border-slate-200 p-1 bg-slate-50">
        <button
          type="button"
          onClick={() => setTab("telegram")}
          className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors cursor-pointer ${
            tab === "telegram" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500"
          }`}
        >
          {t("auth.login.tabTelegram")}
        </button>
        <button
          type="button"
          onClick={() => setTab("email")}
          className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors cursor-pointer ${
            tab === "email" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500"
          }`}
        >
          {t("auth.login.tabEmail")}
        </button>
      </div>
      */}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
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
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-600">{t("auth.login.rememberMe")}</span>
          </label>
          <AuthLink to="/auth/forgot-password">{t("auth.login.forgotPasswordLink")}</AuthLink>
        </div>
        <AuthButton loading={loading}>{t("auth.login.submit")}</AuthButton>
      </form>

      {/* Telegram login UI — disabled
      {tab === "email" ? (
        ...
      ) : isInsideTelegramClient() ? (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Send className="w-4 h-4 text-indigo-500" />
          {isTelegramWebApp()
            ? t("auth.login.telegramMiniAppAuto")
            : t("auth.login.telegramNoInitData")}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">{t("auth.login.telegramWidgetHint")}</p>
          {botUsername ? (
            <div ref={widgetRef} className="flex justify-center" />
          ) : (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {t("auth.login.telegramBotEnvMissing")}
            </p>
          )}
        </div>
      )}
      */}

      <p className="text-sm text-slate-500 text-center">
        {t("auth.login.noAccount")}{" "}
        <AuthLink to="/register">{t("auth.login.registerLink")}</AuthLink>
      </p>
      <AuthDeveloperContact />
    </AuthLayout>
  );
}
