export type AuthPasswordIssue = "minLength" | "lettersDigits";

export function validateAuthPassword(password: string): AuthPasswordIssue | null {
  if (password.length < 8) return "minLength";
  if (!/\p{L}/u.test(password) || !/\d/u.test(password)) return "lettersDigits";
  return null;
}

export function authPasswordErrorKey(issue: AuthPasswordIssue): "auth.passwordMinLength" | "auth.passwordLettersDigits" {
  return issue === "minLength" ? "auth.passwordMinLength" : "auth.passwordLettersDigits";
}
