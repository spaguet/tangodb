import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Circle, CircleCheck, X } from "lucide-react";
import { useBeginnerHints } from "../../hooks/useBeginnerHints";
import { useI18n } from "../../hooks/useI18n";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useLocations } from "../../hooks/useLocations";
import { useDisciplines } from "../../hooks/useDisciplines";
import { usePrices } from "../../hooks/usePrices";
import { useClientDirectory } from "../../hooks/useClients";
import { useSchedule } from "../../hooks/useSchedule";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import { usePersonalLessons } from "../../hooks/usePersonalLessons";
import { useAttendanceRecords } from "../../hooks/useAttendance";
import { normalizeOrgModules } from "../../lib/orgModules";
import { PLACEHOLDER_ORG_NAMES } from "../../types/organization";
import type { I18nKey } from "../../lib/i18n/keys";

type ChecklistStepId =
  | "studio"
  | "location"
  | "discipline"
  | "prices"
  | "client"
  | "schedule"
  | "sale"
  | "attendance";

interface ChecklistStepDef {
  id: ChecklistStepId;
  titleKey: I18nKey;
  path: string;
}

function collapsedStorageKey(organizationId: string) {
  return `tangodb:first-day-checklist:collapsed:${organizationId}`;
}

export default function FirstDayChecklist() {
  const { t } = useI18n();
  const { organizationId, settings, organization } = useOrganization();
  const { showFirstDayChecklist, hideFirstDayChecklistUntilSettings } = useBeginnerHints();
  const modules = normalizeOrgModules(settings?.modules);

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    try {
      setCollapsed(localStorage.getItem(collapsedStorageKey(organizationId)) === "1");
    } catch {
      setCollapsed(false);
    }
  }, [organizationId]);

  const toggleCollapsed = useCallback(() => {
    if (!organizationId) return;
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(collapsedStorageKey(organizationId), next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [organizationId]);

  const locationsQuery = useLocations();
  const disciplinesQuery = useDisciplines();
  const pricesQuery = usePrices();
  const clientsQuery = useClientDirectory();
  const scheduleQuery = useSchedule();
  const subscriptionsQuery = useSubscriptions();
  const personalQuery = usePersonalLessons({ enabled: modules.personal_lessons });
  const attendanceQuery = useAttendanceRecords(undefined, { enabled: true });

  const steps = useMemo<ChecklistStepDef[]>(() => {
    const salePath =
      modules.group_subscriptions
        ? "/subscriptions/sell"
        : modules.personal_lessons
          ? "/personal/sell"
          : "/prices";
    return [
      { id: "studio", titleKey: "firstDayChecklist.step.studio", path: "/settings/general" },
      { id: "location", titleKey: "firstDayChecklist.step.location", path: "/settings/locations" },
      { id: "discipline", titleKey: "firstDayChecklist.step.discipline", path: "/settings/disciplines" },
      { id: "prices", titleKey: "firstDayChecklist.step.prices", path: "/prices" },
      { id: "client", titleKey: "firstDayChecklist.step.client", path: "/clients" },
      { id: "schedule", titleKey: "firstDayChecklist.step.schedule", path: "/schedule" },
      { id: "sale", titleKey: "firstDayChecklist.step.sale", path: salePath },
      { id: "attendance", titleKey: "firstDayChecklist.step.attendance", path: "/attendance" },
    ];
  }, [modules.group_subscriptions, modules.personal_lessons]);

  const done = useMemo(() => {
    const orgName = organization?.name ?? "";
    const studioReady =
      !!settings &&
      !PLACEHOLDER_ORG_NAMES.includes(orgName as (typeof PLACEHOLDER_ORG_NAMES)[number]) &&
      !!settings.currency_code &&
      !!settings.timezone;

    return {
      studio: studioReady,
      location: (locationsQuery.data?.length ?? 0) > 0,
      discipline: (disciplinesQuery.data?.length ?? 0) > 0,
      prices: (pricesQuery.data?.length ?? 0) > 0,
      client: (clientsQuery.data?.length ?? 0) > 0,
      schedule: (scheduleQuery.data?.length ?? 0) > 0,
      sale:
        (subscriptionsQuery.data?.length ?? 0) > 0 ||
        (personalQuery.data?.length ?? 0) > 0,
      attendance: (attendanceQuery.data?.length ?? 0) > 0,
    } satisfies Record<ChecklistStepId, boolean>;
  }, [
    organization?.name,
    settings,
    locationsQuery.data,
    disciplinesQuery.data,
    pricesQuery.data,
    clientsQuery.data,
    scheduleQuery.data,
    subscriptionsQuery.data,
    personalQuery.data,
    attendanceQuery.data,
  ]);

  const completedCount = steps.filter((s) => done[s.id]).length;
  const allDone = completedCount === steps.length;

  if (!organizationId || allDone || !showFirstDayChecklist) return null;

  const nextStep = steps.find((s) => !done[s.id]);

  return (
    <section
      className="rounded-xl border border-indigo-200/80 bg-indigo-50/60 shadow-xs font-sans"
      aria-label={t("firstDayChecklist.title")}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{t("firstDayChecklist.title")}</p>
          <p className="text-xs text-slate-600 mt-0.5">
            {t("firstDayChecklist.progress", { done: completedCount, total: steps.length })}
          </p>
          {collapsed && nextStep ? (
            <p className="text-xs text-indigo-800 mt-1 truncate">
              {t("firstDayChecklist.next")}: {t(nextStep.titleKey)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={hideFirstDayChecklistUntilSettings}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-white/80 cursor-pointer"
            aria-label={t("firstDayChecklist.hideUntilSettings")}
          >
            <X className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="p-1.5 rounded-md text-slate-500 hover:text-indigo-700 hover:bg-white/80 cursor-pointer"
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("firstDayChecklist.expand") : t("firstDayChecklist.collapse")}
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <ol className="px-4 pb-4 space-y-2 border-t border-indigo-100/80 pt-3">
          {steps.map((step) => {
            const isDone = done[step.id];
            const Icon = isDone ? CircleCheck : Circle;
            return (
              <li key={step.id} className="flex items-start gap-2 text-sm">
                <Icon
                  className={`w-4 h-4 mt-0.5 shrink-0 ${isDone ? "text-green-600" : "text-slate-400"}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <span className={isDone ? "text-slate-500 line-through" : "text-slate-800"}>
                    {t(step.titleKey)}
                  </span>
                  {!isDone && (
                    <Link
                      to={step.path}
                      className="ml-2 text-xs font-semibold text-indigo-700 hover:text-indigo-900 whitespace-nowrap"
                    >
                      {t("firstDayChecklist.action")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
