import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgePlus, FolderClosed, Sparkles } from "lucide-react";
import {
  useDeletePersonalLesson,
  useDeletePersonalLessonSeriesFromDate,
  usePersonalLessons,
} from "../../hooks/usePersonalLessons";
import { useSchedule } from "../../hooks/useSchedule";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useAccessibleLocations } from "../../hooks/useLocations";
import { memberDisplayName, useTeamMembers } from "../../hooks/useTeamMembers";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useUIStore } from "../../store/ui";
import { addDays, isScheduleDateLockedForWrite } from "../../lib/scheduleWeek";
import { personalLessonsInSeriesFromDate } from "../../lib/personalLessonSeries";
import {
  translateConnectionBlockReason,
  translateMutationBlockedMessage,
  useOnlineStatus,
} from "../../hooks/useOnlineStatus";
import { useI18n } from "../../hooks/useI18n";
import type { PersonalDisplayLesson, PersonalLesson } from "../../types";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";
import PageTabs, { pageTabPanelCls } from "../ui/PageTabs";
import ConfirmDialog from "../ui/ConfirmDialog";
import EditLessonPopup from "../schedule/EditLessonPopup";
import PayPersonalLessonModal, {
  type PayPersonalLessonTarget,
} from "../schedule/PayPersonalLessonModal";
import PersonalLessonFilters from "./PersonalLessonFilters";
import PersonalLessonsList from "./PersonalLessonsList";
import PersonalLessonSalePanel from "./PersonalLessonSalePanel";
import {
  defaultPersonalLessonFilters,
  filtersToQueryOptions,
  type PersonalLessonFilterState,
} from "./personalLessonFilterUtils";

interface PersonalLessonsPageContainerProps {
  initialTab?: "view" | "sell";
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

function toDisplayLesson(lesson: PersonalLesson): PersonalDisplayLesson {
  return {
    kind: "personal",
    lessonId: lesson.id,
    date: lesson.date,
    timeStart: lesson.timeStart,
    timeEnd: lesson.timeEnd,
    paid: lesson.paid,
    disciplineId: lesson.disciplineId ?? null,
    locationId: lesson.locationId ?? null,
    teacherMemberId: lesson.teacherMemberId ?? null,
    clientId1: lesson.clientId1 || undefined,
    clientId2: lesson.clientId2 || undefined,
    clientId3: lesson.clientId3 || undefined,
    clientId4: lesson.clientId4 || undefined,
    clientDisplay: lesson.clientDisplay,
  };
}

export default function PersonalLessonsPageContainer({
  initialTab = "view",
  toast,
}: PersonalLessonsPageContainerProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { memberId, role } = useOrganization();
  const { can, canAccessPanel, isReadOnly, canEditPastSchedule } = usePermissions();
  const { connectionState } = useOnlineStatus();
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);

  const [activeTab, setActiveTab] = useState<"view" | "sell">(initialTab);
  const [filters, setFilters] = useState<PersonalLessonFilterState>(defaultPersonalLessonFilters);
  const [editLesson, setEditLesson] = useState<PersonalDisplayLesson | null>(null);
  const [editWeekRange, setEditWeekRange] = useState<{ start: string; end: string } | null>(null);
  const [payTarget, setPayTarget] = useState<PayPersonalLessonTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PersonalLesson | null>(null);

  const deletePersonalLesson = useDeletePersonalLesson();
  const deletePersonalLessonSeries = useDeletePersonalLessonSeriesFromDate();

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const switchTab = (tab: "view" | "sell") => {
    setActiveTab(tab);
    setPersonalTab(tab);
    if (tab === "sell") navigate("/personal/sell");
    else navigate("/personal");
  };

  const queryOptions = useMemo(() => filtersToQueryOptions(filters), [filters]);
  const lessonsQuery = usePersonalLessons(queryOptions);
  const disciplinesQuery = useDisciplines();
  const locationsQuery = useAccessibleLocations();
  const teamQuery = useTeamMembers();
  const scheduleQuery = useSchedule();

  const editPersonalQuery = usePersonalLessons({
    dateRange: editWeekRange ?? undefined,
    enabled: Boolean(editWeekRange),
  });

  const deleteSeriesLookupQuery = usePersonalLessons({
    dateRange: deleteTarget
      ? { start: deleteTarget.date, end: addDays(deleteTarget.date, 730) }
      : undefined,
    enabled: Boolean(deleteTarget),
  });

  const personalSeriesFromDate = useMemo(() => {
    if (!deleteTarget || !deleteSeriesLookupQuery.data) return [];
    return personalLessonsInSeriesFromDate(deleteTarget, deleteSeriesLookupQuery.data);
  }, [deleteTarget, deleteSeriesLookupQuery.data]);

  const filteredLessons = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const lessons = lessonsQuery.data ?? [];
    if (!search) return lessons;
    return lessons.filter((lesson) =>
      lesson.clientDisplay.toLowerCase().includes(search)
    );
  }, [lessonsQuery.data, filters.search]);

  const locationMap = useMemo(
    () => new Map(locationsQuery.locations.map((loc) => [loc.id, loc.name])),
    [locationsQuery.locations]
  );
  const disciplineMap = useMemo(
    () => new Map((disciplinesQuery.data ?? []).map((d) => [d.id, d.name])),
    [disciplinesQuery.data]
  );
  const teacherMap = useMemo(
    () =>
      new Map(
        (teamQuery.data ?? []).map((m) => [m.id, memberDisplayName(m)])
      ),
    [teamQuery.data]
  );

  const teacherOptions = useMemo(
    () =>
      (teamQuery.data ?? []).filter(
        (member) =>
          member.is_active &&
          (member.role === "teacher" ||
            member.role === "owner" ||
            member.role === "director" ||
            member.role === "admin")
      ),
    [teamQuery.data]
  );

  const scheduleSlots = useMemo(
    () =>
      (scheduleQuery.data ?? []).map((slot) => ({
        id: slot.id,
        dayOfWeek: slot.dayOfWeek,
        time: slot.time,
        timeEnd: slot.timeEnd,
        disciplineId: slot.disciplineId,
        groupName: slot.groupName,
        locationId: slot.locationId,
        validFrom: slot.validFrom,
        validTo: slot.validTo,
      })),
    [scheduleQuery.data]
  );

  const editPersonalLessons = useMemo(
    () =>
      (editPersonalQuery.data ?? []).map((lesson) => ({
        id: lesson.id,
        date: lesson.date,
        timeStart: lesson.timeStart,
        timeEnd: lesson.timeEnd,
        locationId: lesson.locationId,
      })),
    [editPersonalQuery.data]
  );

  const showPrice = role !== "teacher";

  const handleEdit = (lesson: PersonalLesson) => {
    if (isScheduleDateLockedForWrite(lesson.date, canEditPastSchedule)) {
      toast(t("personal.error.pastEdit"), "error");
      return;
    }
    setEditWeekRange({ start: lesson.date, end: addDays(lesson.date, 6) });
    setEditLesson(toDisplayLesson(lesson));
  };

  const handlePay = (lesson: PersonalLesson) => {
    setPayTarget({
      lessonId: lesson.id,
      date: lesson.date,
      timeStart: lesson.timeStart,
      timeEnd: lesson.timeEnd,
      clientId1: lesson.clientId1,
      clientId2: lesson.clientId2,
      clientId3: lesson.clientId3,
      clientDisplay: lesson.clientDisplay,
      price: lesson.price,
      paidAmount: lesson.paidAmount,
      locationId: lesson.locationId,
      disciplineId: lesson.disciplineId,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const res = await deletePersonalLesson.mutateAsync({
      id: deleteTarget.id,
      lessonDate: deleteTarget.date,
    });
    if (!res.success) {
      toast(res.error ?? t("personal.error.deleteFailed"), "error");
    } else {
      toast(t("personal.success.deleted"), "success");
      setDeleteTarget(null);
    }
  };

  const handleConfirmDeleteSeries = async () => {
    if (!deleteTarget) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const res = await deletePersonalLessonSeries.mutateAsync({
      id: deleteTarget.id,
      lessonDate: deleteTarget.date,
    });
    if (!res.success) {
      toast(res.error ?? t("personal.error.deleteFailed"), "error");
    } else {
      toast(t("schedule.success.personalSeriesDeleted", { count: res.deletedCount }), "success");
      setDeleteTarget(null);
    }
  };

  const personalTabs = [
    { id: "view", label: t("personal.tab.view"), icon: FolderClosed },
    ...(canAccessPanel("personal_sell")
      ? [{ id: "sell" as const, label: t("personal.tab.sell"), icon: BadgePlus }]
      : []),
  ] as const;

  const isLoading =
    lessonsQuery.isLoading ||
    disciplinesQuery.isLoading ||
    locationsQuery.isLoading ||
    teamQuery.isLoading;
  const isError =
    lessonsQuery.isError ||
    disciplinesQuery.isError ||
    locationsQuery.isError ||
    teamQuery.isError;
  const error =
    lessonsQuery.error ??
    disciplinesQuery.error ??
    locationsQuery.error ??
    teamQuery.error;

  if (isLoading) return <LoadingState label={t("personal.loading")} />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <div className="panel-page-stack">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-indigo-500 shrink-0" />
        <h2 className="text-base font-semibold text-slate-800 tracking-tight">{t("personal.title")}</h2>
      </div>

      <div>
        <PageTabs tabs={[...personalTabs]} activeTab={activeTab} onChange={switchTab} />

        {activeTab === "view" ? (
          <div
            className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack ${pageTabPanelCls(activeTab, "view")}`}
          >
            <PersonalLessonFilters
              filters={filters}
              onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
              locations={locationsQuery.locations}
              disciplines={disciplinesQuery.data ?? []}
              teachers={teacherOptions}
            />
            <PersonalLessonsList
              lessons={filteredLessons}
              role={role}
              memberId={memberId}
              isReadOnly={isReadOnly}
              canEditPastSchedule={canEditPastSchedule}
              can={can}
              showPrice={showPrice}
              locationMap={locationMap}
              disciplineMap={disciplineMap}
              teacherMap={teacherMap}
              onEdit={handleEdit}
              onDelete={setDeleteTarget}
              onPay={handlePay}
              toast={toast}
            />
          </div>
        ) : (
          <PersonalLessonSalePanel toast={toast} />
        )}
      </div>

      <EditLessonPopup
        lesson={editLesson}
        locationName={
          editLesson?.locationId ? locationMap.get(editLesson.locationId) : undefined
        }
        locations={locationsQuery.locations}
        personalListEdit
        disciplines={disciplinesQuery.data ?? []}
        teacherOptions={teacherOptions}
        scheduleSlots={scheduleSlots}
        personalLessons={editPersonalLessons}
        toast={toast}
        onClose={() => {
          setEditLesson(null);
          setEditWeekRange(null);
        }}
        onSuccess={() => {
          setEditLesson(null);
          setEditWeekRange(null);
          toast(t("common.changesSaved"), "success");
        }}
      />

      <PayPersonalLessonModal
        lesson={payTarget}
        toast={toast}
        onClose={() => setPayTarget(null)}
        onSuccess={() => {
          setPayTarget(null);
          toast(t("common.paymentRecorded"), "success");
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("personal.confirm.deleteTitle")}
        description={
          deleteTarget ? (
            <span>
              {t("personal.confirm.deleteBody", {
                date: deleteTarget.date,
                time: deleteTarget.timeStart,
              })}
            </span>
          ) : null
        }
        confirmLabel={t("common.delete")}
        pending={deletePersonalLesson.isPending || deletePersonalLessonSeries.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        alternateConfirmLabel={
          personalSeriesFromDate.length >= 2
            ? t("schedule.lessonInfo.deletePersonalSeriesConfirm", {
                count: personalSeriesFromDate.length,
              })
            : undefined
        }
        alternatePending={deletePersonalLessonSeries.isPending}
        onAlternateConfirm={
          personalSeriesFromDate.length >= 2 ? handleConfirmDeleteSeries : undefined
        }
      />
    </div>
  );
}
