import { useState } from "react";
import { supabase } from "../lib/supabase";
import TurnstileWidget, {
  goTrueCaptchaToken,
  isTurnstileConfigured,
} from "../components/TurnstileWidget";

function parseSignInError(message: string): string {
  const lower = message.toLowerCase();
  if (message === "Invalid login credentials") return "Invalid email or password";
  if (lower.includes("captcha")) return "Captcha verification failed. Try again.";
  return "Sign in failed";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const captchaToken = goTrueCaptchaToken(turnstileToken);
    if (isTurnstileConfigured() && !captchaToken) {
      setError("Complete the captcha");
      return;
    }
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (signInError) {
      setError(parseSignInError(signInError.message));
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 bg-slate-900 border border-slate-800 rounded-xl p-6"
      >
        <h1 className="text-xl font-bold text-white">Dev Console</h1>
        <p className="text-sm text-slate-400">Developer access only</p>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
        />
        <TurnstileWidget resetKey={turnstileResetKey} onToken={setTurnstileToken} />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {loading ? "…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
