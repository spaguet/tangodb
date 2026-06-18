import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { acceptInvite } from "../lib/edgeFunctions";
import { useI18n } from "../hooks/useI18n";
import { supabase } from "../lib/supabase";

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
  const { session, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const tokenFromUrl = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (tokenFromUrl) storePendingInviteToken(tokenFromUrl);
  }, [tokenFromUrl]);

  useEffect(() => {
    if (authLoading || !session) return;

    const token = tokenFromUrl || consumePendingInviteToken();
    if (!token) return;

    let cancelled = false;
    setStatus("loading");

    (async () => {
      try {
        await acceptInvite(token);
        if (cancelled) return;
        await supabase.auth.refreshSession();
        setStatus("success");
        setMessage(t("auth.acceptInviteSuccess"));
        setTimeout(() => navigate("/", { replace: true }), 1500);
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

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4 text-center">
          <UserPlus className="w-10 h-10 text-indigo-500 mx-auto" />
          <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
          <p className="text-sm text-slate-500">{t("auth.acceptInviteHint")}</p>
          <div className="flex flex-col gap-2 pt-2">
            <Link
              to="/login"
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Войти
            </Link>
            <Link
              to="/register"
              className="w-full py-2.5 border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors"
            >
              Регистрация
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-3 text-center">
        <h1 className="text-lg font-semibold text-slate-900">{t("auth.acceptInvite")}</h1>
        {status === "loading" && (
          <div className="flex justify-center py-4">
            <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
          </div>
        )}
        {status === "success" && (
          <p className="text-sm text-emerald-600 font-medium">{message}</p>
        )}
        {status === "error" && (
          <>
            <p className="text-sm text-rose-600">{message || t("auth.acceptInviteError")}</p>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mt-2 text-sm text-indigo-600 font-semibold hover:underline cursor-pointer"
            >
              На главную
            </button>
          </>
        )}
        {status === "idle" && !tokenFromUrl && (
          <p className="text-sm text-slate-500">{t("auth.acceptInviteError")}</p>
        )}
      </div>
    </div>
  );
}
