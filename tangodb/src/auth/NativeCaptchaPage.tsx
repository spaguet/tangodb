import TurnstileWidget from "../components/auth/TurnstileWidget";

/**
 * Opened only inside the staff APK captcha dialog (a real https://tangodb.vercel.app WebView).
 * The shell origin cannot host the Cloudflare iframe.
 */
export default function NativeCaptchaPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <TurnstileWidget
        onToken={(token) => {
          if (!token || token === "dev-bypass") return;
          window.AndroidTurnstile?.onToken(token);
        }}
      />
    </div>
  );
}

declare global {
  interface Window {
    AndroidTurnstile?: { onToken: (token: string) => void };
  }
}
