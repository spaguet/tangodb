import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useGuestI18n } from "../hooks/useI18n";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";

export default function ForgotPasswordPage() {
  const { t } = useGuestI18n();
  const { resetPasswordForEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await resetPasswordForEmail(email.trim());
    } catch {
      // Do not reveal whether the email exists.
    } finally {
      setSuccess(t("auth.forgotPasswordSuccess"));
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.forgotPassword.subtitle")}>
      <p className="text-sm text-slate-500">{t("auth.forgotPassword.hint")}</p>
      <AuthError message={error} />
      <AuthSuccess message={success} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <AuthButton loading={loading}>{t("auth.forgotPassword.submit")}</AuthButton>
      </form>

      <p className="text-sm text-slate-500 text-center">
        <AuthLink to="/login">{t("auth.forgotPassword.backToLogin")}</AuthLink>
      </p>
    </AuthLayout>
  );
}
