import { useEffect, useState } from "react";
import { invokeDevFunction, supabase } from "../lib/supabase";

type GateState =
  | { status: "loading" }
  | { status: "allowed" }
  | { status: "denied"; email: string; message: string };

export default function DeveloperAccessGate({
  children,
  onSignOut,
}: {
  children: React.ReactNode;
  onSignOut: () => void;
}) {
  const [gate, setGate] = useState<GateState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user.email ?? "unknown";

      try {
        await invokeDevFunction("dev-console-metrics");
        if (!cancelled) setGate({ status: "allowed" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "developer_access_required";
        if (!cancelled) setGate({ status: "denied", email, message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (gate.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (gate.status === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h1 className="text-xl font-bold text-white">Developer access required</h1>
          <p className="text-sm text-slate-400">
            Signed in as <span className="text-slate-200 font-medium">{gate.email}</span>
          </p>
          <p className="text-sm text-rose-400">{gate.message}</p>
          <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4">
            <li>Sign in with a platform developer account (for example albertkoall@gmail.com).</li>
            <li>
              Supabase Auth → Users → App Metadata:{" "}
              <code className="text-slate-300">{"{\"platform_role\":\"developer\"}"}</code>
            </li>
            <li>Or add the email to DEV_CONSOLE_ALLOWLIST in Supabase Edge secrets.</li>
          </ul>
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-semibold cursor-pointer"
          >
            Sign out and use another account
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
