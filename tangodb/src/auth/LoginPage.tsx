import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
} from "./AuthLayout";
import { parseAuthError } from "./authErrors";
import {
  getTelegramInitData,
  initTelegramWebApp,
  isInsideTelegramClient,
  isTelegramWebApp,
} from "../lib/telegram";
import type { TelegramLoginWidgetPayload } from "../lib/telegram";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramLoginWidgetPayload) => void;
  }
}

type LoginTab = "telegram" | "email";

export default function LoginPage() {
  const { signInWithTelegram, signInWithEmail } = useAuth();
  const navigate = useNavigate();
  const widgetRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<LoginTab>(isInsideTelegramClient() ? "telegram" : "email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? "";

  const goAfterLogin = () => navigate("/", { replace: true });

  useEffect(() => {
    if (!isTelegramWebApp()) return;

    initTelegramWebApp();
    const initData = getTelegramInitData();
    if (!initData) return;

    setLoading(true);
    signInWithTelegram({ initData })
      .then(goAfterLogin)
      .catch((err: Error) => setError(err.message ?? "Ошибка входа через Telegram"))
      .finally(() => setLoading(false));
  }, [signInWithTelegram, navigate]);

  useEffect(() => {
    if (isInsideTelegramClient() || !botUsername || !widgetRef.current) return;

    window.onTelegramAuth = async (user: TelegramLoginWidgetPayload) => {
      setLoading(true);
      setError(null);
      try {
        await signInWithTelegram({ widgetPayload: user });
        goAfterLogin();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка входа");
      } finally {
        setLoading(false);
      }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    widgetRef.current.innerHTML = "";
    widgetRef.current.appendChild(script);

    return () => {
      delete window.onTelegramAuth;
    };
  }, [botUsername, signInWithTelegram, navigate]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signInWithEmail(email.trim(), password);
      goAfterLogin();
    } catch (err) {
      setError(parseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle="Вход в CRM">
      <div className="flex rounded-lg border border-slate-200 p-1 bg-slate-50">
        <button
          type="button"
          onClick={() => setTab("telegram")}
          className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors cursor-pointer ${
            tab === "telegram" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500"
          }`}
        >
          Telegram
        </button>
        <button
          type="button"
          onClick={() => setTab("email")}
          className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors cursor-pointer ${
            tab === "email" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500"
          }`}
        >
          Email
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
          Авторизация...
        </div>
      )}

      <AuthError message={error} />

      {tab === "email" ? (
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <AuthField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />
          <AuthField
            label="Пароль"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
          <div className="text-right">
            <AuthLink to="/auth/forgot-password">Забыли пароль?</AuthLink>
          </div>
          <AuthButton loading={loading}>Войти</AuthButton>
        </form>
      ) : isInsideTelegramClient() ? (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Send className="w-4 h-4 text-indigo-500" />
          {isTelegramWebApp()
            ? "Открыто в Telegram Mini App — вход выполняется автоматически."
            : "Открыто в Telegram, но данные авторизации не получены."}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Войдите через Telegram Login Widget.</p>
          {botUsername ? (
            <div ref={widgetRef} className="flex justify-center" />
          ) : (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Укажите VITE_TELEGRAM_BOT_USERNAME в .env.local
            </p>
          )}
        </div>
      )}

      <p className="text-sm text-slate-500 text-center">
        Нет аккаунта? <AuthLink to="/register">Регистрация</AuthLink>
      </p>
    </AuthLayout>
  );
}
