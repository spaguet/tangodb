import { registerPlugin } from "@capacitor/core";

export interface InAppCaptchaPlugin {
  requestToken(): Promise<{ token: string }>;
}

export const InAppCaptcha = registerPlugin<InAppCaptchaPlugin>("InAppCaptcha");
