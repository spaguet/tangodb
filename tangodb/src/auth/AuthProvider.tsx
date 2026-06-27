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
import { t, getGuestLocale } from "../lib/i18n";
import type { TelegramLoginWidgetPayload } from "../lib/telegram";
import { getTelegramInitData, initTelegramWebApp, isTelegramWebApp } from "../lib/telegram";

export interface TelegramSignInResult {
  recoveryCode: string | null;
  isNewDemo: boolean;
  needsOrgPicker: boolean;
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  pendingRecoveryCode: string | null;
  clearPendingRecoveryCode: () => void;
  signInWithTelegram: (payload: {
    initData?: string;
    widgetPayload?: TelegramLoginWidgetPayload;
  }) => Promise<TelegramSignInResult>;
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

interface TelegramAuthResponse {
  access_token?: string;
  refresh_token?: string;
  needs_org_picker?: boolean;
  recovery_code?: string;
  is_new_demo?: boolean;
  error?: string;
}

async function applyTelegramAuthResponse(data: TelegramAuthResponse): Promise<void> {
  if (!data?.access_token || !data?.refresh_token) {
    throw new Error(data?.error ?? t(getGuestLocale(), "auth.error.generic"));
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

function parseTelegramAuthError(body: { error?: string }): string {
  const locale = getGuestLocale();
  if (body.error === "Forbidden") {
    return t(locale, "auth.error.orgAccessDenied");
  }
  if (body.error === "Unauthorized") {
    return t(locale, "auth.error.telegramAuthFailed");
  }
  if (body.error === "Demo already used for this telegram account") {
    return t(locale, "auth.error.demoUsedTelegram");
  }
  if (
    body.error === "Authentication failed" ||
    body.error === "Service unavailable" ||
    body.error === "Could not create demo organization"
  ) {
    return t(locale, "auth.error.generic");
  }
  return body.error ?? t(locale, "auth.login.telegramError");
}

async function invokeTelegramAuth(payload: {
  initData?: string;
  widgetPayload?: TelegramLoginWidgetPayload;
}): Promise<TelegramAuthResponse> {
  const { data, error } = await supabase.functions.invoke("telegram-auth", {
    body: payload,
  });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const body = await ctx.json();
        if (body?.error) {
          throw new Error(parseTelegramAuthError(body));
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
      }
    }
    throw error;
  }

  if (data?.error) {
    throw new Error(parseTelegramAuthError(data));
  }

  return data as TelegramAuthResponse;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null);

  const clearPendingRecoveryCode = useCallback(() => {
    setPendingRecoveryCode(null);
  }, []);

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
            const authData = await invokeTelegramAuth({ initData });
            if (authData.access_token && authData.refresh_token) {
              await applyTelegramAuthResponse(authData);
              if (typeof authData.recovery_code === "string") {
                setPendingRecoveryCode(authData.recovery_code);
              }
              const { data: sessionData } = await supabase.auth.getSession();
              if (sessionData.session) {
                setSession(sessionData.session);
                setLoading(false);
                return;
              }
            }
          } catch {
            // LoginPage will show the error when user lands there
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
    async (payload: {
      initData?: string;
      widgetPayload?: TelegramLoginWidgetPayload;
    }): Promise<TelegramSignInResult> => {
      const data = await invokeTelegramAuth(payload);
      await applyTelegramAuthResponse(data);

      const recoveryCode =
        typeof data.recovery_code === "string" ? data.recovery_code : null;
      if (recoveryCode) {
        setPendingRecoveryCode(recoveryCode);
      }

      return {
        recoveryCode,
        isNewDemo: Boolean(data.is_new_demo),
        needsOrgPicker: Boolean(data.needs_org_picker),
      };
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
      pendingRecoveryCode,
      clearPendingRecoveryCode,
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
      pendingRecoveryCode,
      clearPendingRecoveryCode,
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
