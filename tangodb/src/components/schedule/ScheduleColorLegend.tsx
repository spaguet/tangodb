import type { CSSProperties } from "react";
import type { OrgModules } from "../../types/organization";
import { useI18n } from "../../hooks/useI18n";
import type { I18nKey } from "../../lib/i18n/keys";
import { isModuleEnabled } from "../../lib/orgModules";
import {
  EVENT_LESSON_COLOR,
  GROUP_LESSON_COLOR,
  PERSONAL_LESSON_COLOR,
  RENTAL_LESSON_COLOR,
  SCHEDULE_DEBT_COLOR,
} from "../../lib/scheduleColors";

interface ScheduleColorLegendProps {
  modules: OrgModules;
}

type LegendEntryId =
  | "group"
  | "personal"
  | "event"
  | "unpaid"
  | "rental"
  | "rentalHold"
  | "restricted";

type LegendEntry = {
  id: LegendEntryId;
  labelKey: I18nKey;
  swatchClassName: string;
  swatchStyle?: CSSProperties;
};

const LEGEND_ROWS: LegendEntryId[][] = [
  ["group", "personal", "event", "unpaid"],
  ["rental", "rentalHold", "restricted"],
];

function swatchClass(colors: {
  bg: string;
  border: string;
  accent: string;
}): string {
  return `relative w-4 h-3 shrink-0 rounded border ${colors.bg} ${colors.border} ${colors.accent}`;
}

const RENTAL_HOLD_STRIPES: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(255,255,255,0.28) 3px, rgba(255,255,255,0.28) 5px)",
};

function buildLegendEntryMap(modules: OrgModules): Partial<Record<LegendEntryId, LegendEntry>> {
  const entries: Partial<Record<LegendEntryId, LegendEntry>> = {};

  if (isModuleEnabled(modules, "group_subscriptions")) {
    entries.group = {
      id: "group",
      labelKey: "schedule.legend.group",
      swatchClassName: swatchClass(GROUP_LESSON_COLOR),
    };
  }

  if (isModuleEnabled(modules, "personal_lessons")) {
    entries.personal = {
      id: "personal",
      labelKey: "schedule.legend.personal",
      swatchClassName: swatchClass(PERSONAL_LESSON_COLOR),
    };
  }

  entries.event = {
    id: "event",
    labelKey: "schedule.legend.event",
    swatchClassName: swatchClass(EVENT_LESSON_COLOR),
  };

  entries.unpaid = {
    id: "unpaid",
    labelKey: "schedule.legend.unpaid",
    swatchClassName: `${swatchClass(SCHEDULE_DEBT_COLOR)} ring-2 ring-lesson-conflict-accent ring-inset`,
  };

  entries.rental = {
    id: "rental",
    labelKey: "schedule.legend.rental",
    swatchClassName: swatchClass(RENTAL_LESSON_COLOR),
  };

  entries.rentalHold = {
    id: "rentalHold",
    labelKey: "schedule.legend.rentalHold",
    swatchClassName: swatchClass(RENTAL_LESSON_COLOR),
    swatchStyle: RENTAL_HOLD_STRIPES,
  };

  entries.restricted = {
    id: "restricted",
    labelKey: "schedule.legend.restricted",
    swatchClassName: "relative w-4 h-3 shrink-0 rounded border bg-slate-200 border-slate-300",
  };

  return entries;
}

function LegendItem({ entry, label }: { entry: LegendEntry; label: string }) {
  return (
    <li className="flex items-center gap-1.5 min-w-0">
      <span className={entry.swatchClassName} style={entry.swatchStyle} aria-hidden />
      <span className="text-[11px] text-slate-600 leading-tight">{label}</span>
    </li>
  );
}

export default function ScheduleColorLegend({ modules }: ScheduleColorLegendProps) {
  const { t } = useI18n();
  const entryMap = buildLegendEntryMap(modules);
  const rows = LEGEND_ROWS.map((ids) =>
    ids.map((id) => entryMap[id]).filter((entry): entry is LegendEntry => entry != null)
  ).filter((row) => row.length > 0);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div
      className="pt-3 mt-3 border-t border-slate-100"
      aria-label={t("schedule.legend.title")}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        {t("schedule.legend.title")}
      </p>
      <div className="flex flex-col gap-y-2">
        {rows.map((row, rowIndex) => (
          <ul key={rowIndex} className="flex flex-wrap gap-x-4 gap-y-2 list-none m-0 p-0">
            {row.map((entry) => (
              <LegendItem key={entry.id} entry={entry} label={t(entry.labelKey)} />
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
