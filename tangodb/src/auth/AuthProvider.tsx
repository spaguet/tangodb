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
import { setAuthRememberMe, supabase } from "../lib/supabase";
import { requireSiteUrl } from "../lib/siteUrl";
import { t, getGuestLocale } from "../lib/i18n";
import { goTrueCaptchaToken, isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import { isUserAlreadyRegistered } from "./authErrors";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signInWithEmail: (
    email: string,
    password: string,
    rememberMe?: boolean,
    captchaToken?: string | null
  ) => Promise<Session>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName: string | undefined,
    captchaToken: string | null
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  resetPasswordForEmail: (email: string, captchaToken?: string | null) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function requireGoTrueCaptcha(captchaToken: string | null | undefined): string | undefined {
  const token = goTrueCaptchaToken(captchaToken);
  if (isTurnstileConfigured() && !token) {
    throw new Error("Captcha verification failed");
  }
  return token;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSession() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      setSession(data.session);
      setLoading(false);
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

  const signInWithEmail = useCallback(
    async (email: string, password: string, rememberMe = false, captchaToken?: string | null) => {
      setAuthRememberMe(rememberMe);
      const token = requireGoTrueCaptcha(captchaToken);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: token ? { captchaToken: token } : undefined,
      });
      if (error) throw error;
      if (!data.session) throw new Error(t(getGuestLocale(), "auth.error.generic"));
      return data.session;
    },
    []
  );

  const signUpWithEmail = useCallback(
    async (
      email: string,
      password: string,
      displayName: string | undefined,
      captchaToken: string | null
    ) => {
      const trimmedName = displayName?.trim();
      const token = requireGoTrueCaptcha(captchaToken);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${requireSiteUrl()}/auth/verify-email`,
          data: trimmedName ? { display_name: trimmedName } : undefined,
          captchaToken: token,
        },
      });
      if (error) {
        if (isUserAlreadyRegistered(error)) {
          return { needsEmailConfirmation: true };
        }
        throw error;
      }
      return { needsEmailConfirmation: !data.session };
    },
    []
  );

  const resetPasswordForEmail = useCallback(async (email: string, captchaToken?: string | null) => {
    const token = requireGoTrueCaptcha(captchaToken);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${requireSiteUrl()}/auth/reset-password`,
      captchaToken: token,
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
      signInWithEmail,
      signUpWithEmail,
      resetPasswordForEmail,
      updatePassword,
      signOut,
    }),
    [session, loading, signInWithEmail, signUpWithEmail, resetPasswordForEmail, updatePassword, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
