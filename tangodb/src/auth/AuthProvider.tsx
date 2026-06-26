import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { getSiteUrl } from "../lib/siteUrl";
import type { TelegramLoginWidgetPayload } from "../lib/telegram";
import { getTelegramInitData, initTelegramWebApp, isTelegramWebApp } from "../lib/telegram";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signInWithTelegram: (payload: {
    initData?: string;
    widgetPayload?: TelegramLoginWidgetPayload;
  }) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName?: string
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function applyTelegramAuthResponse(data: {
  access_token?: string;
  refresh_token?: string;
  needs_org_picker?: boolean;
  error?: string;
}): Promise<void> {
  if (!data?.access_token || !data?.refresh_token) {
    throw new Error(data?.error ?? "Не удалось получить сессию");
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) throw sessionError;

  if (!data.needs_org_picker) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSession() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (data.session) {
        setSession(data.session);
        setLoading(false);
        return;
      }

      if (isTelegramWebApp()) {
        initTelegramWebApp();
        const initData = getTelegramInitData();
        if (initData) {
          try {
            const { data: authData, error } = await supabase.functions.invoke("telegram-auth", {
              body: { initData },
            });
            if (!error && authData?.access_token && authData?.refresh_token) {
              try {
                await applyTelegramAuthResponse(authData);
                const { data: sessionData } = await supabase.auth.getSession();
                if (sessionData.session) {
                  setSession(sessionData.session);
                  setLoading(false);
                  return;
                }
              } catch {
                // LoginPage will show the error
              }
            }
          } catch {
            // LoginPage will show the error
          }
        }
      }

      if (!cancelled) setLoading(false);
    }

    bootstrapSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithTelegram = useCallback(
    async (payload: { initData?: string; widgetPayload?: TelegramLoginWidgetPayload }) => {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: payload,
      });

      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          try {
            const body = await ctx.json();
            if (body?.error) {
              const message =
                body.error === "Forbidden"
                  ? "Нет доступа к организации. Активируйте ключ или попросите приглашение."
                  : body.error === "Unauthorized"
                    ? "Не удалось подтвердить вход через Telegram"
                    : body.error;
              throw new Error(message);
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
          }
        }
        throw error;
      }

      await applyTelegramAuthResponse(data);
    },
    []
  );

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const trimmedName = displayName?.trim();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${getSiteUrl()}/auth/verify-email`,
          data: trimmedName ? { display_name: trimmedName } : undefined,
        },
      });
      if (error) throw error;
      return { needsEmailConfirmation: !data.session };
    },
    []
  );

  const resetPasswordForEmail = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getSiteUrl()}/auth/reset-password`,
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      signInWithTelegram,
      signInWithEmail,
      signUpWithEmail,
      resetPasswordForEmail,
      updatePassword,
      signOut,
    }),
    [
      session,
      loading,
      signInWithTelegram,
      signInWithEmail,
      signUpWithEmail,
      resetPasswordForEmail,
      updatePassword,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
