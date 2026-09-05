import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../lib/auth";
import BotBanner from "../components/BotBanner";
import TabBar, { type CabinetTab } from "../components/TabBar";
import MineTab from "../components/mine/MineTab";
import ScheduleTab from "../components/schedule/ScheduleTab";
import { useCabinetLiveRefresh } from "../hooks/useCabinetLiveRefresh";
import { needsCabinetPolling } from "../lib/cabinetRefresh";
import { rpcGetWallet } from "../lib/rpc";
import { t, type Locale } from "../i18n/strings";

type CabinetScreenProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  organizationId: string;
  supabase: SupabaseClient;
};

export default function CabinetScreen({
  locale,
  bootstrap,
  organizationId,
  supabase,
}: CabinetScreenProps) {
  const [tab, setTab] = useState<CabinetTab>("schedule");
  const [mineRefresh, setMineRefresh] = useState(0);
  const [scheduleRefresh, setScheduleRefresh] = useState(0);
  const [topupPrefillAmount, setTopupPrefillAmount] = useState<number | null>(null);
  const [focusRentalId, setFocusRentalId] = useState<string | null>(null);
  const [pollActive, setPollActive] = useState(false);
  const prevTabRef = useRef<CabinetTab>(tab);

  const refreshCabinet = useCallback(() => {
    setMineRefresh((n) => n + 1);
    setScheduleRefresh((n) => n + 1);
  }, []);

  useCabinetLiveRefresh(refreshCabinet, pollActive);

  useEffect(() => {
    if (tab === "schedule" && prevTabRef.current !== "schedule") {
      setScheduleRefresh((n) => n + 1);
    }
    prevTabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wallet = await rpcGetWallet(supabase, 1, 0);
        if (!cancelled) setPollActive(needsCabinetPolling(wallet));
      } catch {
        if (!cancelled) setPollActive(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, mineRefresh]);

  const openTopup = (amount: number) => {
    setTopupPrefillAmount(amount);
    setMineRefresh((n) => n + 1);
    setTab("mine");
  };

  const openMine = (rentalId?: string) => {
    refreshCabinet();
    if (rentalId) setFocusRentalId(rentalId);
    setTab("mine");
  };

  useEffect(() => {
    if (!focusRentalId) return;
    const id = window.setTimeout(() => setFocusRentalId(null), 2500);
    return () => window.clearTimeout(id);
  }, [focusRentalId]);

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-50 text-slate-800">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 shadow-xs">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {t(locale, "studioSubtitle")}
        </p>
        <h1 className="truncate text-base font-semibold text-slate-900">{bootstrap.studioName}</h1>
      </header>

      <TabBar locale={locale} active={tab} onChange={setTab} />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <BotBanner
          locale={locale}
          botStarted={bootstrap.botStarted}
          allowsWrite={bootstrap.allowsWrite}
          botUrl={bootstrap.botUrl}
        />

        {tab === "schedule" ? (
          <ScheduleTab
            locale={locale}
            bootstrap={bootstrap}
            organizationId={organizationId}
            supabase={supabase}
            refreshKey={scheduleRefresh}
            onBooked={refreshCabinet}
            onOpenMine={openMine}
            onTopup={openTopup}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MineTab
              locale={locale}
              bootstrap={bootstrap}
              supabase={supabase}
              refreshKey={mineRefresh}
              focusRentalId={focusRentalId}
              topupPrefillAmount={topupPrefillAmount}
              onTopupPrefillConsumed={() => setTopupPrefillAmount(null)}
              onRefreshAll={refreshCabinet}
            />
          </div>
        )}
      </main>
    </div>
  );
}
