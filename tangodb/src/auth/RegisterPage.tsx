import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { parseAuthError } from "./authErrors";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";

export default function RegisterPage() {
  const { signUpWithEmail } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      const { needsEmailConfirmation } = await signUpWithEmail(email.trim(), password);
      if (needsEmailConfirmation) {
        setSuccess("Проверьте почту и подтвердите email, затем активируйте ключ доступа.");
      } else {
        navigate("/activate-key", { replace: true });
      }
    } catch (err) {
      setError(parseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle="Регистрация владельца">
      <p className="text-sm text-slate-500">
        Организация создаётся после активации демо- или лицензионного ключа на следующем шаге.
      </p>

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
        <AuthField
          label="Пароль"
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
        <AuthButton loading={loading}>Создать аккаунт</AuthButton>
      </form>

      <p className="text-sm text-slate-500 text-center">
        Уже есть аккаунт? <AuthLink to="/login">Войти</AuthLink>
      </p>
    </AuthLayout>
  );
}
