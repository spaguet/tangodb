import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../lib/auth";
import BotBanner from "../components/BotBanner";
import TabBar, { type CabinetTab } from "../components/TabBar";
import MineTab from "../components/mine/MineTab";
import ScheduleTab from "../components/schedule/ScheduleTab";
import { type Locale } from "../i18n/strings";

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
    <div className="flex h-[100dvh] flex-col bg-slate-50 text-slate-800">
      <TabBar locale={locale} active={tab} onChange={setTab} />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <BotBanner locale={locale} botStarted={bootstrap.botStarted} />

        {tab === "schedule" ? (
          <ScheduleTab
            locale={locale}
            bootstrap={bootstrap}
            organizationId={organizationId}
            supabase={supabase}
            onBooked={() => setMineRefresh((n) => n + 1)}
            onOpenMine={() => {
              setMineRefresh((n) => n + 1);
              setTab("mine");
            }}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MineTab
              locale={locale}
              bootstrap={bootstrap}
              supabase={supabase}
              refreshKey={mineRefresh}
            />
          </div>
        )}
      </main>
    </div>
  );
}
