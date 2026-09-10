import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import { btnSecondaryCls } from "../../lib/crmUi";
import { rpcGetWallet } from "../../lib/rpc";
import type { PendingTopup } from "../../lib/types";
import { t, type Locale } from "../../i18n/strings";
import TopupForm from "./TopupForm";

type TopupSheetProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  supabase: SupabaseClient;
  initialAmount: number;
  closeLabel: string;
  onClose: () => void;
  onFinished: () => void;
};

export default function TopupSheet({
  locale,
  bootstrap,
  supabase,
  initialAmount,
  closeLabel,
  onClose,
  onFinished,
}: TopupSheetProps) {
  const [pendingTopup, setPendingTopup] = useState<PendingTopup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wallet = await rpcGetWallet(supabase, 1, 0);
        if (!cancelled) setPendingTopup(wallet.pending_topup);
      } catch {
        if (!cancelled) setPendingTopup(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="topup-sheet-title"
    >
      <div
        className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-xl border border-slate-200 bg-white p-4 pb-8 text-slate-800 shadow-xl [-webkit-overflow-scrolling:touch]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="topup-sheet-title" className="text-lg font-semibold text-slate-900">
            {t(locale, "topup")}
          </h2>
          <button type="button" className={`shrink-0 ${btnSecondaryCls}`} onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
          </div>
        ) : (
          <TopupForm
            locale={locale}
            bootstrap={bootstrap}
            supabase={supabase}
            pendingTopup={pendingTopup}
            initialAmount={initialAmount}
            showTitle={false}
            framed={false}
            onSubmitted={async () => {
              try {
                const wallet = await rpcGetWallet(supabase, 1, 0);
                setPendingTopup(wallet.pending_topup);
              } catch {
                /* keep previous pending state */
              }
            }}
            onFinished={onFinished}
          />
        )}
      </div>
    </div>
  );
}
