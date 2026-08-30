import { useEffect, useMemo, useState } from "react";
import {
  assertRenterSession,
  fetchBootstrap,
  mintRenterSession,
  prepareTelegramWebApp,
  type BootstrapData,
} from "./lib/auth";
import {
  getRawInitData,
  parseStartParamFromInitData,
} from "./lib/initData";
import { getRenterSupabase, supabaseEnvError } from "./lib/supabase";
import { resolveLocale, type MessageKey } from "./i18n/strings";
import CabinetScreen from "./pages/CabinetScreen";
import EntryScreen from "./pages/EntryScreen";

type Phase = "loading" | "signingIn" | "ready" | "error";

const MESSAGE_KEYS = new Set<string>([
  "authForbidden",
  "authOrgMismatch",
  "authNotRenter",
  "openInTelegram",
  "missingStartParam",
  "envMissing",
  "bootstrapFailed",
]);

function toMessageKey(value: string): MessageKey {
  return MESSAGE_KEYS.has(value) ? (value as MessageKey) : "authForbidden";
}

export default function App() {
  const initData = useMemo(() => getRawInitData(), []);
  const organizationId = useMemo(() => parseStartParamFromInitData(initData), [initData]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  const locale = useMemo(
    () => resolveLocale(bootstrap?.locale),
    [bootstrap?.locale]
  );

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (supabaseEnvError) {
        setErrorKey("envMissing");
        setPhase("error");
        return;
      }

      if (!initData) {
        setErrorKey("openInTelegram");
        setPhase("error");
        return;
      }

      if (!organizationId) {
        setErrorKey("missingStartParam");
        setPhase("error");
        return;
      }

      const supabase = getRenterSupabase(organizationId);

      try {
        const { data: existing } = await supabase.auth.getSession();
        if (existing.session) {
          try {
            assertRenterSession(existing.session, organizationId);
            const data = await fetchBootstrap(supabase);
            if (cancelled) return;
            setBootstrap(data);
            setPhase("ready");
            return;
          } catch {
            await supabase.auth.signOut();
          }
        }

        setPhase("signingIn");
        prepareTelegramWebApp();

        const minted = await mintRenterSession(initData);
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: minted.access_token,
          refresh_token: minted.refresh_token,
        });

        if (sessionError || !sessionData.session) {
          throw new Error("authForbidden");
        }

        assertRenterSession(sessionData.session, organizationId);

        const data = await fetchBootstrap(supabase);
        if (cancelled) return;
        setBootstrap(data);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        const key = err instanceof Error ? toMessageKey(err.message) : "authForbidden";
        setErrorKey(key);
        setPhase("error");
        await getRenterSupabase(organizationId).auth.signOut();
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [initData, organizationId]);

  if (phase === "ready" && bootstrap && organizationId) {
    return (
      <CabinetScreen
        locale={locale}
        bootstrap={bootstrap}
        organizationId={organizationId}
        supabase={getRenterSupabase(organizationId)}
      />
    );
  }

  return (
    <EntryScreen locale={locale} phase={phase} bootstrap={bootstrap} errorKey={errorKey} />
  );
}
