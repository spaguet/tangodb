import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { parseAuthError } from "./authErrors";
import TurnstileWidget, { isTurnstileConfigured } from "../components/auth/TurnstileWidget";
import { useSelfServiceDemo } from "../hooks/useSelfServiceDemo";
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
  const { verifyRegistrationChallenge, createDemoOrganization } = useSelfServiceDemo();
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedLogin = login.trim();
    if (!trimmedLogin) {
      setError("Укажите логин (отображаемое имя)");
      return;
    }
    if (password.length < 8) {
      setError("Пароль должен содержать минимум 8 символов");
      return;
    }
    if (password !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }
    if (!turnstileToken) {
      setError(
        isTurnstileConfigured()
          ? "Подтвердите, что вы не робот"
          : "Captcha недоступна — обратитесь к администратору"
      );
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await verifyRegistrationChallenge(normalizedEmail, turnstileToken);

      const { needsEmailConfirmation } = await signUpWithEmail(
        normalizedEmail,
        password,
        trimmedLogin
      );

      if (needsEmailConfirmation) {
        setSuccess(
          "Проверьте почту и подтвердите email — после этого откроется демо-версия CRM на 30 дней."
        );
        setTurnstileResetKey((k) => k + 1);
        setTurnstileToken(null);
      } else {
        const result = await createDemoOrganization();
        if (result.recoveryCode) {
          navigate("/auth/verify-email", {
            replace: true,
            state: { recoveryCode: result.recoveryCode },
          });
        } else {
          navigate(result.alreadyHasOrg ? "/" : "/onboarding", { replace: true });
        }
      }
    } catch (err) {
      setError(parseAuthError(err));
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle="Регистрация владельца">
      <p className="text-sm text-slate-500">
        После подтверждения email вы получите демо-CRM на 30 дней — ключ не нужен.
      </p>

      <AuthError message={error} />
      <AuthSuccess message={success} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Логин"
          value={login}
          onChange={setLogin}
          autoComplete="nickname"
          placeholder="Как вас показывать в CRM"
          required
        />
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
        <TurnstileWidget
          resetKey={turnstileResetKey}
          onToken={setTurnstileToken}
          onError={() => setTurnstileToken(null)}
        />
        <AuthButton loading={loading}>Создать аккаунт</AuthButton>
      </form>

      <p className="text-sm text-slate-500 text-center">
        Уже есть аккаунт? <AuthLink to="/login">Войти</AuthLink>
      </p>
      <p className="text-xs text-slate-400 text-center">
        Есть лицензионный ключ?{" "}
        <AuthLink to="/login">Войдите</AuthLink> и активируйте в настройках.
      </p>
    </AuthLayout>
  );
}
