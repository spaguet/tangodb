import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { parseAuthError } from "./authErrors";
import RecoveryCodeModal from "./RecoveryCodeModal";
import { useOrganization } from "../organization/OrganizationProvider";
import { useSelfServiceDemo } from "../hooks/useSelfServiceDemo";
import { useGuestI18n } from "../hooks/useI18n";
import { AuthButton, AuthError, AuthLayout, AuthLink } from "./AuthLayout";

type VerifyPhase = "loading" | "creating" | "recovery" | "done" | "idle";

export default function VerifyEmailPage() {
  const { t, locale } = useGuestI18n();
  const { session, loading: authLoading } = useAuth();
  const { memberships, membershipsLoading, refreshOrganization } = useOrganization();
  const { createDemoOrganization } = useSelfServiceDemo();
  const navigate = useNavigate();
  const location = useLocation();
  const attemptRef = useRef(false);

  const initialRecoveryCode =
    typeof (location.state as { recoveryCode?: string } | null)?.recoveryCode === "string"
      ? (location.state as { recoveryCode: string }).recoveryCode
      : null;

  const [phase, setPhase] = useState<VerifyPhase>(initialRecoveryCode ? "recovery" : "idle");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(initialRecoveryCode);
  const [error, setError] = useState<string | null>(null);

  const attemptCreateDemo = useCallback(async () => {
    if (attemptRef.current) return;

    attemptRef.current = true;
    setError(null);
    setPhase("creating");

    try {
      const result = await createDemoOrganization();
      await refreshOrganization();

      if (result.recoveryCode) {
        setRecoveryCode(result.recoveryCode);
        setPhase("recovery");
        return;
      }

      navigate(result.alreadyHasOrg ? "/" : "/onboarding", { replace: true });
    } catch (err) {
      attemptRef.current = false;
      setError(parseAuthError(err, locale));
      setPhase("idle");
    }
  }, [createDemoOrganization, locale, navigate, refreshOrganization]);

  useEffect(() => {
    if (authLoading || membershipsLoading) {
      setPhase((prev) => (prev === "recovery" ? prev : "loading"));
      return;
    }

    if (!session) {
      setPhase("idle");
      return;
    }

    if (!session.user.email_confirmed_at) {
      setPhase("idle");
      return;
    }

    if (memberships.length > 0) {
      navigate("/", { replace: true });
      return;
    }

    if (recoveryCode || attemptRef.current) return;

    void attemptCreateDemo();
  }, [
    authLoading,
    membershipsLoading,
    session,
    memberships.length,
    recoveryCode,
    attemptCreateDemo,
  ]);

  const continueAfterRecovery = () => {
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
