import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { useAuth } from "./AuthProvider";
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

export default function LoginPage() {
  const { session, signInWithTelegram } = useAuth();
  const navigate = useNavigate();
  const widgetRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? "";

  useEffect(() => {
    if (session) {
      navigate("/", { replace: true });
    }
  }, [session, navigate]);

  useEffect(() => {
    if (!isTelegramWebApp()) return;

    initTelegramWebApp();
    const initData = getTelegramInitData();
    if (!initData) return;

    setLoading(true);
    signInWithTelegram({ initData })
      .then(() => navigate("/", { replace: true }))
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
        navigate("/", { replace: true });
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded flex items-center justify-center text-white font-mono font-bold">
            T
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">TangoDB</h1>
            <p className="text-xs text-slate-400 font-mono uppercase tracking-wider">Вход через Telegram</p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <div className="w-4 h-4 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
            Авторизация...
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {isInsideTelegramClient() ? (
          <p className="text-sm text-slate-500 flex items-center gap-2">
            <Send className="w-4 h-4 text-indigo-500" />
            {isTelegramWebApp()
              ? "Открыто в Telegram Mini App — вход выполняется автоматически."
              : "Открыто в Telegram, но данные авторизации не получены. Проверьте URL Web App в BotFather (https://tangodb.vercel.app)."}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Войдите через Telegram, чтобы получить доступ к панели управления студией.
            </p>
            {botUsername ? (
              <div ref={widgetRef} className="flex justify-center" />
            ) : (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Укажите VITE_TELEGRAM_BOT_USERNAME в .env.local
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
