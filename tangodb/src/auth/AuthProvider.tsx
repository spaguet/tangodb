import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { setAuthRememberMe, supabase } from "../lib/supabase";
import { requireSiteUrl } from "../lib/siteUrl";
import { t, getGuestLocale } from "../lib/i18n";
import { goTrueCaptchaToken, isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import { isUserAlreadyRegistered } from "./authErrors";

const PASSWORD_RECOVERY_FLAG = "tangodb.password_recovery";

function readPasswordRecoveryFlag(): boolean {
  try {
    return sessionStorage.getItem(PASSWORD_RECOVERY_FLAG) === "1";
  } catch {
    return false;
  }
}

function writePasswordRecoveryFlag(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(PASSWORD_RECOVERY_FLAG, "1");
    else sessionStorage.removeItem(PASSWORD_RECOVERY_FLAG);
  } catch {
    /* private mode / quota */
  }
}

function urlLooksLikePasswordRecovery(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash.replace(/^#/, "");
  const hashParams = new URLSearchParams(hash);
  if (hashParams.get("type") === "recovery") return true;
  if (window.location.hash.includes("type=recovery")) return true;
  const query = new URLSearchParams(window.location.search);
  if (window.location.pathname.includes("/auth/reset-password") && query.has("code")) {
    return true;
  }
  return readPasswordRecoveryFlag();
}

function enterPasswordRecovery(): void {
  writePasswordRecoveryFlag(true);
}

function exitPasswordRecovery(): void {
  writePasswordRecoveryFlag(false);
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  /** True while GoTrue recovery JWT is active — CRM shell must not mount. */
  passwordRecovery: boolean;
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

function applyAuthEvent(
  event: AuthChangeEvent,
  nextSession: Session | null,
  setSession: (s: Session | null) => void,
  setPasswordRecovery: (v: boolean) => void
): void {
  if (event === "PASSWORD_RECOVERY") {
    enterPasswordRecovery();
    setPasswordRecovery(true);
    setSession(null);
    return;
  }
  if (event === "SIGNED_OUT") {
    exitPasswordRecovery();
    setPasswordRecovery(false);
    setSession(null);
    return;
  }
  if (readPasswordRecoveryFlag() || urlLooksLikePasswordRecovery()) {
    enterPasswordRecovery();
    setPasswordRecovery(true);
    setSession(null);
    return;
  }
  setPasswordRecovery(false);
  setSession(nextSession);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(() => urlLooksLikePasswordRecovery());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) return;
      applyAuthEvent(event, nextSession, setSession, setPasswordRecovery);
      setLoading(false);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (readPasswordRecoveryFlag() || urlLooksLikePasswordRecovery()) {
        enterPasswordRecovery();
        setPasswordRecovery(true);
        setSession(null);
        setLoading(false);
        return;
      }
      setSession(data.session);
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
    exitPasswordRecovery();
    setPasswordRecovery(false);
    setSession(null);
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      passwordRecovery,
      signInWithEmail,
      signUpWithEmail,
      resetPasswordForEmail,
      updatePassword,
      signOut,
    }),
    [
      session,
      loading,
      passwordRecovery,
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
