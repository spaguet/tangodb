import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../lib/auth";
import BotBanner from "../components/BotBanner";
import TabBar, { type CabinetTab } from "../components/TabBar";
import MineTab from "../components/mine/MineTab";
import ScheduleTab from "../components/schedule/ScheduleTab";
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

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--tg-theme-bg-color,#0f172a)] text-[var(--tg-theme-text-color,#f8fafc)]">
      <header className="px-4 pt-4 pb-2">
        <p className="text-xs uppercase tracking-wide opacity-60">{t(locale, "studioSubtitle")}</p>
        <h1 className="text-xl font-semibold leading-tight">{bootstrap.studioName}</h1>
      </header>

      <BotBanner locale={locale} botStarted={bootstrap.botStarted} />

      <TabBar locale={locale} active={tab} onChange={setTab} />

      <main className="flex-1 overflow-y-auto pt-3">
        {tab === "schedule" ? (
          <ScheduleTab
            locale={locale}
            bootstrap={bootstrap}
            organizationId={organizationId}
            supabase={supabase}
            onBooked={() => setMineRefresh((n) => n + 1)}
          />
        ) : (
          <MineTab
            locale={locale}
            bootstrap={bootstrap}
            supabase={supabase}
            refreshKey={mineRefresh}
          />
        )}
      </main>
    </div>
  );
}
