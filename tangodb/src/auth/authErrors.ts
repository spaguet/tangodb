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
  if (message === "Demo already used for this email") {
    return "Демо для этого email уже использовалось. Активируйте лицензионный ключ или обратитесь в поддержку.";
  }
  if (message === "Captcha verification failed") {
    return "Не удалось пройти проверку captcha. Попробуйте ещё раз.";
  }
  if (message === "Complete registration captcha on the sign-up page first") {
    return "Сначала завершите регистрацию на странице «Регистрация» (captcha действует 24 часа).";
  }
  if (message === "Demo already used for this telegram account") {
    return "Демо для этого Telegram уже использовалось. Активируйте лицензионный ключ или обратитесь в поддержку.";
  }
  return message;
}
