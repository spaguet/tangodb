import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import {
  checkCrmWebBundleUpdate,
  downloadAndApplyCrmWebBundle,
  reloadAfterWebBundleApply,
} from "../../lib/crmWebBundle/crmWebBundleUpdate";
import { isNativeCrmShell } from "../../lib/platform";

/** Checks signed web-bundle manifest on native shell and hot-swaps dist without a new APK. */
export default function PhoneWebBundleBridge() {
  const { t } = useI18n();
  const { connectionState } = useOnlineStatus();
  const [status, setStatus] = useState<"idle" | "checking" | "downloading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isNativeCrmShell()) return;
    if (connectionState !== "online") return;
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;

    void (async () => {
      setStatus("checking");
      const offer = await checkCrmWebBundleUpdate();
      if (cancelled || offer.kind === "none") {
        setStatus("idle");
        return;
      }

      setStatus("downloading");
      try {
        await downloadAndApplyCrmWebBundle(offer.manifest);
        if (!cancelled) {
          reloadAfterWebBundleApply();
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : t("phone.webBundle.failed"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionState, t]);

  if (status === "idle" || status === "checking") return null;

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
      {status === "downloading" ? t("phone.webBundle.downloading") : null}
      {status === "error" && error ? (
        <span className="text-rose-700">{error}</span>
      ) : null}
    </div>
  );
}
