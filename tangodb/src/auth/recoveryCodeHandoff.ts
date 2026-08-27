/** In-memory one-shot handoff. Never sessionStorage, localStorage, or history.state. */
let pendingRecoveryCode: string | null = null;

export function stashRecoveryCode(code: string): void {
  pendingRecoveryCode = code;
}

export function takeRecoveryCode(): string | null {
  const code = pendingRecoveryCode;
  pendingRecoveryCode = null;
  return code;
}
