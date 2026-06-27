import { t, getGuestLocale } from "../lib/i18n";

export function parseAuthError(err: unknown, locale?: string): string {
  const loc = locale ?? getGuestLocale();
  if (!(err instanceof Error)) return t(loc, "auth.error.generic");

  const message = err.message;
  if (message === "Invalid login credentials") {
    return t(loc, "auth.error.invalidCredentials");
  }
  if (message === "Email not confirmed") {
    return t(loc, "auth.error.emailNotConfirmed");
  }
  if (message === "User already registered") {
    return t(loc, "auth.error.userAlreadyRegistered");
  }
  if (message === "Demo already used for this email") {
    return t(loc, "auth.error.demoUsedEmail");
  }
  if (message === "Captcha verification failed") {
    return t(loc, "auth.error.captchaFailed");
  }
  if (message === "Complete registration captcha on the sign-up page first") {
    return t(loc, "auth.error.completeRegistrationCaptcha");
  }
  if (message === "Demo already used for this telegram account") {
    return t(loc, "auth.error.demoUsedTelegram");
  }
  if (message === "Service unavailable") {
    return t(loc, "common.serverUnavailable");
  }
  if (message === "Could not create demo organization") {
    return t(loc, "auth.error.generic");
  }
  return message;
}
