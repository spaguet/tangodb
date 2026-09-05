import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { useGuestI18n } from "../hooks/useI18n";
import { isRenterActorFromSession } from "../lib/authClaims";
import { RenterActorDenied } from "./ProtectedRoute";
import {
  AuthButton,
  AuthDeveloperContact,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";
import { parseAuthError } from "./authErrors";

export default function ResetPasswordPage() {
  const { t, locale } = useGuestI18n();
  const { passwordRecovery, loading: authLoading, updatePassword, signOut, session } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (authLoading) {
    return (
      <AuthLayout title="TangoDB" subtitle={t("auth.resetPassword.subtitle")}>
        <p className="text-sm text-slate-500">{t("auth.loading.checkingSession")}</p>
      </AuthLayout>
    );
  }
  if (session && isRenterActorFromSession(session)) {
    return <RenterActorDenied />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!passwordRecovery) {
      setError(t("auth.resetPassword.noSessionHint"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordMinLength"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      setSuccess(t("auth.resetPassword.success"));
      if (import.meta.env.DEV) {
        console.info("[TangoDB] Password updated via recovery flow");
      }
      await signOut();
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (err) {
      setError(parseAuthError(err, locale));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthLayout title="TangoDB" subtitle={t("auth.resetPassword.subtitle")}>
        <AuthSuccess message={success} />
        <AuthDeveloperContact />
      </AuthLayout>
    );
  }

  if (!passwordRecovery) {
    return (
      <AuthLayout title="TangoDB" subtitle={t("auth.resetPassword.subtitle")}>
        <p className="text-sm text-slate-500">
          {t("auth.resetPassword.noSessionHint")}{" "}
          <AuthLink to="/auth/forgot-password">{t("auth.resetPassword.requestNewLink")}</AuthLink>.
        </p>
        <AuthDeveloperContact />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.resetPassword.subtitle")}>
      <AuthError message={error} />
      <AuthSuccess message={success} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label={t("auth.resetPassword.newPasswordLabel")}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
        />
        <AuthField
          label={t("auth.confirmPassword")}
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          required
        />
        <AuthButton loading={loading}>{t("auth.resetPassword.submit")}</AuthButton>
      </form>
      <AuthDeveloperContact />
    </AuthLayout>
  );
}
