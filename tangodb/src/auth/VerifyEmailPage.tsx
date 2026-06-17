import { AuthLayout, AuthLink } from "./AuthLayout";

export default function VerifyEmailPage() {
  return (
    <AuthLayout title="TangoDB" subtitle="Подтверждение email">
      <p className="text-sm text-slate-500">
        Email подтверждён. Теперь активируйте ключ доступа, чтобы создать организацию.
      </p>
      <p className="text-sm text-center">
        <AuthLink to="/activate-key">Перейти к активации ключа</AuthLink>
      </p>
    </AuthLayout>
  );
}
