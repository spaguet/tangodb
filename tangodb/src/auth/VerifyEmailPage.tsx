import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { isDemoAlreadyUsedError, isRegistrationCaptchaRequired, parseAuthError } from "./authErrors";
import RecoveryCodeModal from "./RecoveryCodeModal";
import { takeRecoveryCode } from "./recoveryCodeHandoff";
import TurnstileWidget, { isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import { useOrganization } from "../organization/OrganizationProvider";
import { useSelfServiceDemo } from "../hooks/useSelfServiceDemo";
import { useGuestI18n } from "../hooks/useI18n";
import { supabase } from "../lib/supabase";
import { AuthButton, AuthError, AuthLayout, AuthLink } from "./AuthLayout";

type VerifyPhase = "loading" | "creating" | "recovery" | "done" | "idle";

export default function VerifyEmailPage() {
  const { t, locale } = useGuestI18n();
  const { session, loading: authLoading } = useAuth();
  const { memberships, membershipsLoading, refreshOrganization } = useOrganization();
  const { verifyRegistrationChallenge, createDemoOrganization } = useSelfServiceDemo();
  const navigate = useNavigate();
  const location = useLocation();
  const attemptRef = useRef(false);

  const [boot] = useState(() => {
    const code = takeRecoveryCode();
    return {
      code,
      phase: (code ? "recovery" : "idle") as VerifyPhase,
    };
  });
  const [phase, setPhase] = useState<VerifyPhase>(boot.phase);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(boot.code);
  const [error, setError] = useState<string | null>(null);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  useEffect(() => {
    const prev = location.state as { recoveryCode?: unknown } | null;
    if (prev && Object.prototype.hasOwnProperty.call(prev, "recoveryCode")) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  const attemptCreateDemo = useCallback(
    async (opts?: { withCaptcha?: boolean }) => {
      if (attemptRef.current) return;

      attemptRef.current = true;
      setError(null);
      setPhase("creating");

      try {
        const email = session?.user.email?.trim().toLowerCase();
        if (opts?.withCaptcha) {
          if (!email) {
            throw new Error("Email required");
          }
          if (!turnstileToken) {
            setError(
              isTurnstileConfigured()
                ? t("auth.register.captchaRequired")
                : t("auth.register.captchaUnavailable")
            );
            setPhase("idle");
            attemptRef.current = false;
            return;
          }
          await verifyRegistrationChallenge(email, turnstileToken);
        }

        const result = await createDemoOrganization();
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        await refreshOrganization();

        if (result.recoveryCode) {
          setRecoveryCode(result.recoveryCode);
          setPhase("recovery");
          return;
        }

        navigate(result.alreadyHasOrg ? "/" : "/onboarding", { replace: true });
      } catch (err) {
        attemptRef.current = false;
        if (isDemoAlreadyUsedError(err)) {
          navigate("/activate-key", { replace: true, state: { demoUsed: true } });
          return;
        }
        if (isRegistrationCaptchaRequired(err)) {
          setNeedsCaptcha(true);
          setError(null);
        } else {
          setError(parseAuthError(err, locale));
        }
        setTurnstileResetKey((k) => k + 1);
        setTurnstileToken(null);
        setPhase("idle");
      }
    },
    [
      createDemoOrganization,
      locale,
      navigate,
      refreshOrganization,
      session?.user.email,
      t,
      turnstileToken,
      verifyRegistrationChallenge,
    ]
  );

  useEffect(() => {
    if (authLoading || membershipsLoading) {
      setPhase((prev) => (prev === "recovery" ? prev : "loading"));
      return;
    }

    if (!session) {
      setPhase((prev) => (prev === "recovery" ? prev : "idle"));
      return;
    }

    if (!session.user.email_confirmed_at) {
      setPhase((prev) => (prev === "recovery" ? prev : "idle"));
      return;
    }

    if (recoveryCode || phase === "recovery") return;

    if (memberships.length > 0) {
      navigate("/", { replace: true });
      return;
    }

    if (attemptRef.current || needsCaptcha) return;

    void attemptCreateDemo();
  }, [
    authLoading,
    membershipsLoading,
    session,
    memberships.length,
    recoveryCode,
    phase,
    needsCaptcha,
    attemptCreateDemo,
    navigate,
  ]);

  const continueAfterRecovery = () => {
    setRecoveryCode(null);
    setPhase("done");
    navigate("/onboarding", { replace: true });
  };

  if (phase === "recovery" && recoveryCode) {
    return <RecoveryCodeModal code={recoveryCode} onContinue={continueAfterRecovery} />;
  }

  if (phase === "loading" || phase === "creating") {
    return (
      <AuthLayout title="TangoDB" subtitle={t("auth.verifyEmail.preparingSubtitle")}>
        <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
          <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
          <p className="text-xs font-semibold tracking-widest uppercase">
            {phase === "creating"
              ? t("auth.verifyEmail.creatingOrg")
              : t("common.loading.default")}
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.verifyEmail.subtitle")}>
      <AuthError message={error} />

      {!session ? (
        <>
          <p className="text-sm text-slate-500">{t("auth.verifyEmail.noSessionHint")}</p>
          <p className="text-sm text-center">
            <AuthLink to="/login">{t("auth.register.signInLink")}</AuthLink>
          </p>
        </>
      ) : !session.user.email_confirmed_at ? (
        <>
          <p className="text-sm text-slate-500">{t("auth.verifyEmail.notConfirmedHint")}</p>
          <p className="text-sm text-center">
            <AuthLink to="/login">{t("auth.verifyEmail.signInOtherAccount")}</AuthLink>
          </p>
        </>
      ) : needsCaptcha ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{t("auth.verifyEmail.captchaHint")}</p>
          <TurnstileWidget
            resetKey={turnstileResetKey}
            onToken={setTurnstileToken}
            onError={() => setTurnstileToken(null)}
          />
          <AuthButton
            type="button"
            loading={false}
            disabled={isTurnstileConfigured() && !turnstileToken}
            onClick={() => void attemptCreateDemo({ withCaptcha: true })}
          >
            {t("auth.verifyEmail.createDemo")}
          </AuthButton>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{t("auth.verifyEmail.confirmedFallbackHint")}</p>
          <AuthButton type="button" onClick={() => void attemptCreateDemo()}>
            {t("auth.verifyEmail.retryCreate")}
          </AuthButton>
        </div>
      )}
    </AuthLayout>
  );
}
