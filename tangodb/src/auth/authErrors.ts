export function parseAuthError(err: unknown): string {
  if (!(err instanceof Error)) return "Не удалось выполнить запрос";

  const message = err.message;
  if (message === "Invalid login credentials") {
    return "Неверный email или пароль";
  }
  if (message === "Email not confirmed") {
    return "Подтвердите email перед входом";
  }
  if (message === "User already registered") {
    return "Пользователь с таким email уже зарегистрирован";
  }
  return message;
}
