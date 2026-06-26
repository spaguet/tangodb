import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import RecoveryCodeModal from "./RecoveryCodeModal";
import { useOrganization } from "../organization/OrganizationProvider";
import { useSelfServiceDemo } from "../hooks/useSelfServiceDemo";
import { AuthError, AuthLayout, AuthLink } from "./AuthLayout";

type VerifyPhase = "loading" | "creating" | "recovery" | "done" | "idle";

export default function VerifyEmailPage() {
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

    attemptRef.current = true;
    setPhase("creating");

    void (async () => {
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
        const message =
          err instanceof Error ? err.message : "Не удалось создать демо-организацию";
        setError(message);
        setPhase("idle");
      }
    })();
  }, [
    authLoading,
    membershipsLoading,
    session,
    memberships.length,
    createDemoOrganization,
    refreshOrganization,
    navigate,
    recoveryCode,
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
      <AuthLayout title="TangoDB" subtitle="Подготовка демо-CRM">
        <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
          <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
          <p className="text-xs font-semibold tracking-widest uppercase">
            {phase === "creating" ? "Создаём демо-организацию..." : "Загрузка..."}
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="TangoDB" subtitle="Подтверждение email">
      <AuthError message={error} />

      {!session ? (
        <>
          <p className="text-sm text-slate-500">
            Перейдите по ссылке из письма, чтобы подтвердить email. После подтверждения мы
            автоматически создадим демо-CRM на 30 дней.
          </p>
          <p className="text-sm text-center">
            <AuthLink to="/login">Войти</AuthLink>
          </p>
        </>
      ) : !session.user.email_confirmed_at ? (
        <>
          <p className="text-sm text-slate-500">
            Email ещё не подтверждён. Откройте ссылку из письма — демо-CRM создастся автоматически.
          </p>
          <p className="text-sm text-center">
            <AuthLink to="/login">Войти с другим аккаунтом</AuthLink>
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            Email подтверждён. Если демо-CRM не создалась автоматически, вернитесь на{" "}
            <AuthLink to="/register">регистрацию</AuthLink> или активируйте{" "}
            <AuthLink to="/activate-key">лицензионный ключ</AuthLink>.
          </p>
        </>
      )}
    </AuthLayout>
  );
}
