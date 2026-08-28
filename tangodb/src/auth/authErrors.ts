import { t, getGuestLocale } from "../lib/i18n";
import { reportClientError } from "../lib/reportClientError";

export const REGISTRATION_CAPTCHA_REQUIRED =
  "Complete registration captcha on the sign-up page first";

export const DEMO_ALREADY_USED_EMAIL = "Demo already used for this email";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return "";
}

function errorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

export function isRegistrationCaptchaRequired(err: unknown): boolean {
  return errorMessage(err) === REGISTRATION_CAPTCHA_REQUIRED;
}

export function isDemoAlreadyUsedError(err: unknown): boolean {
  return errorMessage(err) === DEMO_ALREADY_USED_EMAIL;
}

export function isUserAlreadyRegistered(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  const code = errorCode(err).toLowerCase();
  return (
    message.includes("already registered") ||
    message.includes("already been registered") ||
    code === "user_already_exists"
  );
}

export function isCaptchaAuthError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  const code = errorCode(err).toLowerCase();
  return (
    message.includes("captcha") ||
    message === REGISTRATION_CAPTCHA_REQUIRED.toLowerCase() ||
    code.includes("captcha")
  );
}

export function parseAuthError(err: unknown, locale?: string): string {
  const loc = locale ?? getGuestLocale();
  const message = errorMessage(err);
  if (!message) return t(loc, "auth.error.generic");

  const lower = message.toLowerCase();
  const code = errorCode(err).toLowerCase();

  if (message === "Invalid login credentials" || code === "invalid_credentials") {
    return t(loc, "auth.error.invalidCredentials");
  }
  if (message === "Email not confirmed" || code === "email_not_confirmed") {
    return t(loc, "auth.error.emailNotConfirmed");
  }
  if (isUserAlreadyRegistered(err)) {
    return t(loc, "auth.register.checkEmailDemo");
  }
  if (message === DEMO_ALREADY_USED_EMAIL || lower.includes("demo already used for this email")) {
    return t(loc, "auth.error.generic");
  }
  if (message === REGISTRATION_CAPTCHA_REQUIRED) {
    return t(loc, "auth.error.completeRegistrationCaptcha");
  }
  if (isCaptchaAuthError(err)) {
    return t(loc, "auth.error.captchaFailed");
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

  reportClientError(err, {
    area: "auth",
    action: "parseAuthError",
    meta: { code: code || undefined },
  });
  return t(loc, "auth.error.generic");
}
