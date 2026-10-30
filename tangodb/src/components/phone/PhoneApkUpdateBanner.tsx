import { useEffect, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import {
  checkCrmApkUpdate,
  downloadAndInstallCrmApk,
  type CrmApkUpdateOffer,
} from "../../lib/crmApkUpdate";

export default function PhoneApkUpdateBanner() {
  const { t } = useI18n();
  const [offer, setOffer] = useState<CrmApkUpdateOffer>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkCrmApkUpdate().then((next) => {
      if (!cancelled) setOffer(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (offer.kind === "none") return null;

  const required = offer.kind === "required";

  return (
    <div
      className={`border-b px-4 py-3 text-sm ${
        required ? "border-amber-200 bg-amber-50 text-amber-900" : "border-indigo-100 bg-indigo-50 text-indigo-900"
      }`}
    >
      <p className="font-semibold">
        {required ? t("phone.update.requiredTitle") : t("phone.update.optionalTitle")}
      </p>
      {offer.manifest.releaseNotes ? (
        <p className="mt-1 text-xs opacity-90">{offer.manifest.releaseNotes}</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void downloadAndInstallCrmApk(offer.manifest)
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : t("phone.update.failed"));
            })
            .finally(() => setBusy(false));
        }}
        className="mt-3 inline-flex min-h-12 items-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-60 cursor-pointer"
      >
        {busy ? t("phone.update.installing") : t("phone.update.install")}
      </button>
    </div>
  );
}
