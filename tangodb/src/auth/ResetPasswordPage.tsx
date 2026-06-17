import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";

export default function ResetPasswordPage() {
  const { session, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session) return;
  }, [session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password.length < 8) {
      setError("Пароль должен содержать минимум 8 символов");
      return;
    }
    if (password !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      setSuccess("Пароль обновлён. Перенаправляем...");
      setTimeout(() => navigate("/", { replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить пароль");
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return (
      <AuthLayout title="TangoDB" subtitle="Новый пароль">
        <p className="text-sm text-slate-500">
          Откройте ссылку из письма для восстановления пароля или{" "}
          <AuthLink to="/auth/forgot-password">запросите новую</AuthLink>.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="TangoDB" subtitle="Новый пароль">
      <AuthError message={error} />
      <AuthSuccess message={success} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Новый пароль"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
        />
        <AuthField
          label="Подтверждение пароля"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          required
        />
        <AuthButton loading={loading}>Сохранить пароль</AuthButton>
      </form>
    </AuthLayout>
  );
}
