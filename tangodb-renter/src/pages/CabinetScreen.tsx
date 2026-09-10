import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../lib/auth";
import BotBanner from "../components/BotBanner";
import RentalRulesSheet from "../components/RentalRulesSheet";
import TabBar, { type CabinetTab } from "../components/TabBar";
import MineTab from "../components/mine/MineTab";
import TopupSheet from "../components/mine/TopupSheet";
import BookingSheet from "../components/schedule/BookingSheet";
import ScheduleTab, { type PendingBooking } from "../components/schedule/ScheduleTab";
import { useCabinetLiveRefresh } from "../hooks/useCabinetLiveRefresh";
import { needsCabinetPolling } from "../lib/cabinetRefresh";
import { APP_VERSION } from "../lib/appVersion";
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
  const [walletRefresh, setWalletRefresh] = useState(0);
  const [topupSheetAmount, setTopupSheetAmount] = useState<number | null>(null);
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(null);
  const [focusRentalId, setFocusRentalId] = useState<string | null>(null);
  const [pollActive, setPollActive] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
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
    setTopupSheetAmount(amount);
  };

  const closeTopupSheet = () => {
    setTopupSheetAmount(null);
  };

  const finishTopupSheet = () => {
    setTopupSheetAmount(null);
    setWalletRefresh((n) => n + 1);
    refreshCabinet();
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
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 shadow-xs">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {t(locale, "studioSubtitle")}
          </p>
          <h1 className="truncate text-base font-semibold text-slate-900">{bootstrap.studioName}</h1>
        </div>
        <button
          type="button"
          className="mt-1 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          onClick={() => setRulesOpen(true)}
        >
          {t(locale, "rules")}
        </button>
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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ScheduleTab
              locale={locale}
              bootstrap={bootstrap}
              supabase={supabase}
              refreshKey={scheduleRefresh}
              onOpenMine={openMine}
              onTopup={openTopup}
              onOpenBooking={setPendingBooking}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MineTab
              locale={locale}
              bootstrap={bootstrap}
              supabase={supabase}
              refreshKey={mineRefresh}
              focusRentalId={focusRentalId}
              onRefreshAll={refreshCabinet}
            />
          </div>
        )}
      </main>

      <footer className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-center">
        <p className="text-[10px] tabular-nums text-slate-400">{APP_VERSION}</p>
      </footer>

      {rulesOpen ? <RentalRulesSheet locale={locale} onClose={() => setRulesOpen(false)} /> : null}

      {pendingBooking ? (
        <BookingSheet
          locale={locale}
          bootstrap={bootstrap}
          serverNow={bootstrap.serverNow}
          organizationId={organizationId}
          supabase={supabase}
          locationId={pendingBooking.locationId}
          date={pendingBooking.date}
          defaultStart={pendingBooking.start}
          packDays={pendingBooking.packDays}
          walletRefreshKey={walletRefresh}
          onClose={() => setPendingBooking(null)}
          onDone={() => {
            setPendingBooking(null);
            refreshCabinet();
          }}
          onTopup={openTopup}
        />
      ) : null}

      {topupSheetAmount != null && topupSheetAmount > 0 ? (
        <TopupSheet
          locale={locale}
          bootstrap={bootstrap}
          supabase={supabase}
          initialAmount={topupSheetAmount}
          closeLabel={
            pendingBooking ? t(locale, "topupBackToBooking") : t(locale, "topupSheetClose")
          }
          onClose={closeTopupSheet}
          onFinished={finishTopupSheet}
        />
      ) : null}
    </div>
  );
}
