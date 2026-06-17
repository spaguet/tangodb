import { useState } from "react";
import { useAuth } from "./AuthProvider";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";

export default function ForgotPasswordPage() {
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
      setSuccess("Если аккаунт существует, мы отправили ссылку для сброса пароля.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить письмо");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle="Восстановление пароля">
      <p className="text-sm text-slate-500">Введите email, указанный при регистрации.</p>
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
        <AuthButton loading={loading}>Отправить ссылку</AuthButton>
      </form>

      <p className="text-sm text-slate-500 text-center">
        <AuthLink to="/login">Вернуться ко входу</AuthLink>
      </p>
    </AuthLayout>
  );
}
