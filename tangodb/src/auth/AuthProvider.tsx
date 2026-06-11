import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { TelegramLoginWidgetPayload } from "../lib/telegram";
import { getTelegramInitData, initTelegramWebApp, isTelegramWebApp } from "../lib/telegram";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signInWithTelegram: (payload: {
    initData?: string;
    widgetPayload?: TelegramLoginWidgetPayload;
  }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
              const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                access_token: authData.access_token,
                refresh_token: authData.refresh_token,
              });
              if (!sessionError && sessionData.session) {
                setSession(sessionData.session);
                setLoading(false);
                return;
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
            if (body?.error) throw new Error(body.error);
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
          }
        }
        throw error;
      }
      if (!data?.access_token || !data?.refresh_token) {
        throw new Error(data?.error ?? "Не удалось получить сессию");
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (sessionError) throw sessionError;
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, loading, signInWithTelegram, signOut }),
    [session, loading, signInWithTelegram, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
