/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Archive, Coins, Edit, RotateCcw, Ticket, X } from "lucide-react";
import {
  useArchivePrice,
  useArchivedPrices,
  useCreatePrice,
  usePrices,
  useRestorePrice,
  useUnpaidPersonalLessonsCountByPrice,
  useUpdatePrice,
  useUpdatePriceMeta,
  useUpdatePriceTeachers,
} from "../hooks/usePrices";
import { useAccessibleLocations } from "../hooks/useLocations";
import { useDisciplines } from "../hooks/useDisciplines";
import { memberListLabel, useTeamMembers } from "../hooks/useTeamMembers";
import {
  filterGroupTariffsByModules,
  filterPrivatePackageTariffsByModules,
  isLegacyPairCycleTariff,
  isModuleEnabled,
  normalizeOrgModules,
  resolveGroupPriceType,
  resolvePrivatePackagePriceType,
  type GroupParticipantFormat,
  type PrivatePackageFormat,
} from "../lib/orgModules";
import { formatOptionsFromSettings, getCurrencyInputSuffix } from "../lib/format";
import {
  formatCurrency,
  generateTariffTypeKey,
  getPriceCategory,
  getPriceDescription,
  getPriceLabel,
  getPrivateLessonTariffs,
  getPrivatePackageTariffs,
  getSingleVisitTariffs,
  getPriceDisciplineIds,
  isGlobalTeacherTariff,
  isMonthlyUnlimitedTariff,
  isPrivateTariffWithDuration,
  sortPricesByLabel,
} from "../lib/utils";
import { formatLessonDuration } from "../lib/personalTariffPricing";
import { useSettings } from "../settings/SettingsProvider";
import AppSelect, { descriptionFieldCls, fieldCls as inputCls } from "./ui/AppSelect";
import { btnAddCls, btnCancelCls } from "./ui/buttonStyles";
import ConfirmDialog from "./ui/ConfirmDialog";
import LocationTariffField from "./ui/LocationTariffField";
import DisciplineTariffField from "./ui/DisciplineTariffField";
import TeacherTariffDropdown from "./ui/TeacherTariffDropdown";
import RequirePermission from "./RequirePermission";
import LoadingState from "./ui/LoadingState";
import AddLocationsInSettingsHint from "./ui/AddLocationsInSettingsHint";
import QueryErrorState from "./ui/QueryErrorState";
import PersonalTariffDurationField, {
  isValidPersonalTariffDuration,
  minutesToDurationSelect,
  resolvePersonalTariffDurationMinutes,
  type PersonalTariffDurationSelect,
} from "./ui/PersonalTariffDurationField";
import { usePermissions } from "../hooks/usePermissions";
import { useI18n } from "../hooks/useI18n";
import { translateMutationBlockedMessage, useOnlineStatus } from "../hooks/useOnlineStatus";
import { resolveMutationError } from "../lib/resolveMutationError";
import type { ToastType } from "../App";
import type { Price } from "../types";
import type { I18nKey } from "../lib/i18n/keys";

interface PricesPanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

type CreateTabId = "group" | "privateLesson" | "privatePackage" | "singleVisit";
type CreateModalStep = "picker" | "form";
type PriceListView = "active" | "archive";

function TariffCreateSection({
  title,
  children,
  onSubmit,
  pending,
  compact = false,
}: {
  title?: string;
  children: React.ReactNode;
  onSubmit: () => void;
  pending: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const body = (
    <>
      <div className="panel-form-stack">{children}</div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending}
        className={`w-full ${btnAddCls}`}
      >
        {pending ? t("common.saving") : t("prices.add")}
      </button>
    </>
  );

  if (compact) {
    return <div className="space-y-3">{body}</div>;
  }

  return (
    <section className="border border-slate-100 rounded-xl p-3 space-y-3 bg-slate-50/50">
      <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{title}</h4>
      {body}
    </section>
  );
}

const CREATE_TAB_IDS: CreateTabId[] = ["group", "privateLesson", "singleVisit", "privatePackage"];

export default function PricesPanel({ toast }: PricesPanelProps) {
  const { t, plural, formatDate } = useI18n();
  const { connectionState } = useOnlineStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  const [priceListView, setPriceListView] = useState<PriceListView>("active");
  const { data: prices = [], isLoading, isError, error } = usePrices();
  const archivedPricesQuery = useArchivedPrices(priceListView === "archive");
  const {
    locations,
    isLoading: locationsLoading,
    isError: locationsError,
    error: locationsErr,
  } = useAccessibleLocations();
  const { data: disciplines = [] } = useDisciplines();
  const { data: teamMembers = [] } = useTeamMembers();
  const { settings } = useSettings();
  const currencySuffix = getCurrencyInputSuffix(formatOptionsFromSettings(settings));
  const modules = normalizeOrgModules(settings?.modules);
  const personalLessonsEnabled = isModuleEnabled(modules, "personal_lessons");
  const pairSubscriptionsEnabled = modules.pair_subscriptions;
  const trioLessonsEnabled = modules.trio_lessons;
  const { can } = usePermissions();
  const canWritePrices = can("prices.write");
  const updatePrice = useUpdatePrice();
  const updatePriceMeta = useUpdatePriceMeta();
  const updatePriceTeachers = useUpdatePriceTeachers();
  const archivePrice = useArchivePrice();
  const restorePrice = useRestorePrice();
  const createPrice = useCreatePrice();

  const [editedPrices, setEditedPrices] = useState<Record<string, string>>({});
  const [syncingRows, setSyncingRows] = useState<Record<string, boolean>>({});
  const [editingPrice, setEditingPrice] = useState<Price | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<Price | null>(null);
  const [createModalStep, setCreateModalStep] = useState<CreateModalStep | null>(null);
  const [groupForm, setGroupForm] = useState({
    label: "",
    description: "",
    lessons: "8",
    price: "",
    format: "solo" as GroupParticipantFormat,
  });
  const [privateLessonForm, setPrivateLessonForm] = useState({
    label: "",
    description: "",
    price: "",
    durationSelect: "" as PersonalTariffDurationSelect,
    durationCustom: "",
  });
  const [singleVisitForm, setSingleVisitForm] = useState({ label: "", description: "", price: "" });
  const [privatePackageForm, setPrivatePackageForm] = useState({
    label: "",
    description: "",
    lessons: "4",
    price: "",
    format: "solo" as PrivatePackageFormat,
    durationSelect: "" as PersonalTariffDurationSelect,
    durationCustom: "",
  });
  const [bindToLocation, setBindToLocation] = useState(false);
  const [formLocationId, setFormLocationId] = useState("");
  const [bindToDiscipline, setBindToDiscipline] = useState(false);
  const [formDisciplineIds, setFormDisciplineIds] = useState<string[]>([]);
  const [editBindToLocation, setEditBindToLocation] = useState(false);
  const [editLocationId, setEditLocationId] = useState("");
  const [editBindToDiscipline, setEditBindToDiscipline] = useState(false);
  const [editDisciplineIds, setEditDisciplineIds] = useState<string[]>([]);
  const [formTeacherMemberIds, setFormTeacherMemberIds] = useState<string[]>([]);
  const [editTeacherMemberIds, setEditTeacherMemberIds] = useState<string[]>([]);
  const [editDurationSelect, setEditDurationSelect] = useState<PersonalTariffDurationSelect>("");
  const [editDurationCustom, setEditDurationCustom] = useState("");
  const [syncingTeacherRows, setSyncingTeacherRows] = useState<Record<string, boolean>>({});
  const [creatingSection, setCreatingSection] = useState<CreateTabId | null>(null);
  const [activeCreateTab, setActiveCreateTab] = useState<CreateTabId>("group");
  const unpaidByPriceQuery = useUnpaidPersonalLessonsCountByPrice(editingPrice?.id);

  const CREATE_TABS = [
    { id: "group" as const, label: t("prices.tab.group"), formTitle: t("prices.form.groupTitle") },
    ...(personalLessonsEnabled
      ? [
          { id: "privateLesson" as const, label: t("prices.tab.privateLesson"), formTitle: t("prices.form.privateLessonTitle") },
          {
            id: "privatePackage" as const,
            label: t("prices.tab.privatePackage"),
            formTitle: t("prices.form.privatePackageTitle"),
          },
        ]
      : []),
    { id: "singleVisit" as const, label: t("prices.tab.singleVisit"), formTitle: t("prices.form.singleVisitTitle") },
  ];

  const lessonCountKey = (count: number) =>
    plural(count, ["prices.lesson.one", "prices.lesson.few", "prices.lesson.many"]) as I18nKey;

  const locationMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  const disciplineMap = Object.fromEntries(disciplines.map((d) => [d.id, d.name]));
  const teacherOptions = useMemo(
    () =>
      teamMembers
        .filter(
          (member) =>
            member.is_active &&
            (member.role === "teacher" ||
              member.role === "owner" ||
              member.role === "director" ||
              member.role === "admin")
        )
        .map((member) => ({
          id: member.id,
          label: memberListLabel(member),
        })),
    [teamMembers]
  );
  const teacherMap = Object.fromEntries(teacherOptions.map((teacher) => [teacher.id, teacher.label]));

  const closeCreateModal = () => setCreateModalStep(null);

  const openCreatePicker = () => setCreateModalStep("picker");

  const openCreateForm = (tab: CreateTabId) => {
    setActiveCreateTab(tab);
    setCreateModalStep("form");
  };

  useEffect(() => {
    const create = searchParams.get("create");
    if (!create || !CREATE_TAB_IDS.includes(create as CreateTabId)) return;

    const tab = create as CreateTabId;
    if (!personalLessonsEnabled && (tab === "privateLesson" || tab === "privatePackage")) return;

    if (canWritePrices) {
      openCreateForm(tab);
    }

    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, canWritePrices, personalLessonsEnabled]);

  useEffect(() => {
    if (createModalStep === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCreateModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createModalStep]);

  useEffect(() => {
    if (createModalStep !== null) return;
    setGroupForm({ label: "", description: "", lessons: "8", price: "", format: "solo" });
    setPrivateLessonForm({
      label: "",
      description: "",
      price: "",
      durationSelect: "",
      durationCustom: "",
    });
    setSingleVisitForm({ label: "", description: "", price: "" });
    setPrivatePackageForm({
      label: "",
      description: "",
      lessons: "4",
      price: "",
      format: "solo",
      durationSelect: "",
      durationCustom: "",
    });
    setCreatingSection(null);
    setActiveCreateTab("group");
    setBindToLocation(false);
    setFormLocationId(locations[0]?.id ?? "");
    setBindToDiscipline(false);
    setFormDisciplineIds(disciplines[0]?.id ? [disciplines[0].id] : []);
    setFormTeacherMemberIds([]);
  }, [createModalStep, locations, disciplines]);

  useEffect(() => {
    if (!editingPrice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingPrice(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingPrice]);

  const handleInputChange = (id: string, val: string) => {
    setEditedPrices({ ...editedPrices, [id]: val });
  };

  const handleSavePrice = async (id: string, originalValue: number) => {
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const rawValue = editedPrices[id];
    if (rawValue === undefined) return;

    const parsed = parseFloat(rawValue);
    if (isNaN(parsed) || parsed < 0) {
      toast(t("prices.error.invalidAmount"), "error");
      return;
    }

    if (parsed === originalValue) {
      toast(t("prices.error.unchanged"), "info");
      return;
    }

    setSyncingRows((prev) => ({ ...prev, [id]: true }));
    const res = await updatePrice.mutateAsync({ id, newPrice: parsed });
    setSyncingRows((prev) => ({ ...prev, [id]: false }));

    if (!res.success) {
      toast(resolveMutationError(res.error, "prices.error.saveFailed", t), "error");
    } else {
      toast(t("prices.success.saved"), "success");
      setEditedPrices((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const startEditMeta = (p: Price) => {
    setEditingPrice(p);
    setEditLabel(getPriceLabel(p, t));
    setEditDescription(getPriceDescription(p, t));
    setEditBindToLocation(!!p.locationId);
    setEditLocationId(p.locationId ?? locations[0]?.id ?? "");
    setEditBindToDiscipline(getPriceDisciplineIds(p).length > 0);
    setEditDisciplineIds(getPriceDisciplineIds(p));
    setEditTeacherMemberIds(p.teacherMemberIds ?? []);
    setEditDurationSelect(minutesToDurationSelect(p.durationMinutes));
    setEditDurationCustom(
      p.durationMinutes != null && minutesToDurationSelect(p.durationMinutes) === "custom"
        ? String(p.durationMinutes)
        : ""
    );
  };

  const handleSaveMeta = async () => {
    if (!editingPrice?.id) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!editLabel.trim()) {
      toast(t("prices.error.nameRequired"), "error");
      return;
    }
    if (editBindToLocation && !editLocationId) {
      toast(t("prices.error.locationRequired"), "error");
      return;
    }
    if (editBindToDiscipline && editDisciplineIds.length === 0) {
      toast(t("prices.error.disciplineRequired"), "error");
      return;
    }

    const isPrivateTariff = isPrivateTariffWithDuration(editingPrice);
    const editDurationMinutes = isPrivateTariff
      ? resolvePersonalTariffDurationMinutes(editDurationSelect, editDurationCustom)
      : undefined;
    const isLegacyPrivate = isPrivateTariff && editingPrice.durationMinutes == null;

    if (
      isPrivateTariff &&
      !isLegacyPrivate &&
      !isValidPersonalTariffDuration(editDurationMinutes, true)
    ) {
      toast(t("prices.error.tariffDurationRequired"), "error");
      return;
    }

    const res = await updatePriceMeta.mutateAsync({
      id: editingPrice.id,
      label: editLabel,
      description: editDescription,
      locationId: editBindToLocation ? editLocationId : null,
      disciplineIds: editBindToDiscipline ? editDisciplineIds : [],
      teacherMemberIds: editTeacherMemberIds,
      durationMinutes: isPrivateTariff ? editDurationMinutes : undefined,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "prices.error.updateFailed", t), "error");
    } else {
      toast(t("prices.success.updated"), "success");
      setEditingPrice(null);
    }
  };

  const handleTeacherBindingChange = async (priceId: string, teacherMemberIds: string[]) => {
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }

    setSyncingTeacherRows((prev) => ({ ...prev, [priceId]: true }));
    const res = await updatePriceTeachers.mutateAsync({ priceId, teacherMemberIds });
    setSyncingTeacherRows((prev) => ({ ...prev, [priceId]: false }));

    if (res.success === false) {
      toast(resolveMutationError(res.error, "prices.error.updateFailed", t), "error");
    } else {
      toast(t("prices.success.teacherBindingUpdated"), "success");
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget?.id) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const res = await archivePrice.mutateAsync(archiveTarget.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "prices.error.archiveFailed", t), "error");
    } else {
      toast(t("prices.success.archived"), "success");
      setArchiveTarget(null);
    }
  };

  const handleRestore = async (price: Price) => {
    if (!price.id) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const res = await restorePrice.mutateAsync(price.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "prices.error.restoreFailed", t), "error");
    } else {
      toast(t("prices.success.restored"), "success");
    }
  };

  const handleCreateTariff = async (section: CreateTabId) => {
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const form =
      section === "group"
        ? groupForm
        : section === "privateLesson"
          ? privateLessonForm
          : section === "singleVisit"
            ? singleVisitForm
            : privatePackageForm;

    if (!form.label.trim()) {
      toast(t("prices.error.nameRequired"), "error");
      return;
    }

    const parsedPrice = parseFloat(form.price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      toast(t("prices.error.invalidCost"), "error");
      return;
    }

    let lessons = 1;
    let billingModel: Price["billingModel"] = "lesson_count";
    if (section === "group") {
      if (groupForm.format === "monthly_unlimited") {
        lessons = 1;
        billingModel = "monthly_unlimited";
      } else {
        lessons = parseInt(groupForm.lessons, 10);
      }
    } else if (section === "privatePackage") {
      lessons = parseInt(privatePackageForm.lessons, 10);
    }
    if (isNaN(lessons) || lessons < 1) {
      toast(t("prices.error.lessonsRequired"), "error");
      return;
    }

    if (bindToLocation && !formLocationId) {
      toast(t("prices.error.locationRequired"), "error");
      return;
    }
    if (bindToDiscipline && formDisciplineIds.length === 0) {
      toast(t("prices.error.disciplineRequired"), "error");
      return;
    }

    let durationMinutes: number | null | undefined;
    if (section === "privateLesson" || section === "privatePackage") {
      const durationSelect =
        section === "privateLesson"
          ? privateLessonForm.durationSelect
          : privatePackageForm.durationSelect;
      const durationCustom =
        section === "privateLesson"
          ? privateLessonForm.durationCustom
          : privatePackageForm.durationCustom;
      durationMinutes = resolvePersonalTariffDurationMinutes(durationSelect, durationCustom);
      if (!isValidPersonalTariffDuration(durationMinutes, true)) {
        toast(t("prices.error.tariffDurationRequired"), "error");
        return;
      }
    }

    setCreatingSection(section);
    let priceType: string;

    if (section === "group") {
      const resolved = resolveGroupPriceType(groupForm.format, lessons);
      if (resolved.ok === false) {
        toast(resolved.error, "error");
        setCreatingSection(null);
        return;
      }
      priceType = resolved.type;
      billingModel = resolved.billingModel;
    } else if (section === "privateLesson") {
      priceType = "personal_solo";
    } else if (section === "singleVisit") {
      priceType = generateTariffTypeKey();
    } else {
      priceType = resolvePrivatePackagePriceType(privatePackageForm.format);
    }

    const res = await createPrice.mutateAsync({
      type: priceType,
      lessons,
      price: parsedPrice,
      label: form.label,
      description: form.description,
      category: section === "group" ? "group" : section === "singleVisit" ? "single_visit" : "private",
      locationId: bindToLocation ? formLocationId : null,
      disciplineIds: bindToDiscipline ? formDisciplineIds : [],
      billingModel,
      teacherMemberIds: formTeacherMemberIds,
      durationMinutes,
    });
    setCreatingSection(null);

    if (!res.success) {
      toast(resolveMutationError(res.error, "prices.error.createFailed", t), "error");
    } else {
      toast(t("prices.success.created"), "success");
      closeCreateModal();
      if (section === "group") {
        setGroupForm({ label: "", description: "", lessons: "8", price: "", format: "solo" });
      } else if (section === "privateLesson") {
        setPrivateLessonForm({
          label: "",
          description: "",
          price: "",
          durationSelect: "",
          durationCustom: "",
        });
      } else if (section === "singleVisit") {
        setSingleVisitForm({ label: "", description: "", price: "" });
      } else {
        setPrivatePackageForm({
          label: "",
          description: "",
          lessons: "4",
          price: "",
          format: "solo",
          durationSelect: "",
          durationCustom: "",
        });
      }
    }
  };

  const groupItems = sortPricesByLabel(
    filterGroupTariffsByModules(
      prices.filter((p) => getPriceCategory(p) === "group" && !isLegacyPairCycleTariff(p.type)),
      modules
    ),
    t
  ).map((priceObj) => ({ priceObj }));
  const privateLessonItems = personalLessonsEnabled
    ? sortPricesByLabel(getPrivateLessonTariffs(prices), t).map((priceObj) => ({ priceObj }))
    : [];
  const singleVisitItems = sortPricesByLabel(getSingleVisitTariffs(prices), t).map((priceObj) => ({
    priceObj,
  }));
  const privatePackageItems = personalLessonsEnabled
    ? sortPricesByLabel(
        filterPrivatePackageTariffsByModules(getPrivatePackageTariffs(prices), modules),
        t
      ).map((priceObj) => ({ priceObj }))
    : [];
  const archivedPrices = sortPricesByLabel(archivedPricesQuery.data ?? [], t);

  const activeCreateTabMeta = CREATE_TABS.find((tab) => tab.id === activeCreateTab)!;

  const locationTariffField = (
    <LocationTariffField
      bindToLocation={bindToLocation}
      onBindChange={setBindToLocation}
      locationId={formLocationId}
      onLocationChange={setFormLocationId}
      locations={locations}
    />
  );

  const disciplineTariffField = (
    <DisciplineTariffField
      bindToDiscipline={bindToDiscipline}
      onBindChange={setBindToDiscipline}
      disciplineIds={formDisciplineIds}
      onDisciplineIdsChange={setFormDisciplineIds}
      disciplines={disciplines}
    />
  );

  const teacherTariffField = (
    <TeacherTariffDropdown
      label={t("ui.tariff.bindTeacher")}
      teachers={teacherOptions}
      selectedTeacherIds={formTeacherMemberIds}
      onChange={setFormTeacherMemberIds}
    />
  );

  if (isLoading || locationsLoading) return <LoadingState label={t("prices.loading")} />;
  if (isError || locationsError) return <QueryErrorState error={error ?? locationsErr} />;
  if (locations.length === 0) {
    return (
      <div id="panel-prices" className="panel-page-stack">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
          <div className="panel-form-header">
            <div className="panel-form-header-icon">
              <Coins className="w-5 h-5 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">{t("prices.pageTitle")}</h2>
            <p className="text-slate-400 text-[11px] leading-snug">
              {t("prices.pageSubtitle")}
            </p>
          </div>
          <div className="text-center py-20 text-slate-400 space-y-3">
            <Ticket className="w-8 h-8 mx-auto text-slate-300" />
            <AddLocationsInSettingsHint />
          </div>
        </div>
      </div>
    );
  }

  const renderPriceRow = (item: { priceObj: Price }) => {
    const p = item.priceObj;
    const priceId = p.id!;
    const currentInputVal = editedPrices[priceId] !== undefined ? editedPrices[priceId] : p.price.toString();
    const isSyncing = syncingRows[priceId] || false;
    const isTouched = editedPrices[priceId] !== undefined && editedPrices[priceId] !== p.price.toString();
    const title = getPriceLabel(p, t);
    const description = getPriceDescription(p, t);
    const isPrivateCategory = isPrivateTariffWithDuration(p);
    const durationSuffix =
      isPrivateCategory && p.durationMinutes != null
        ? ` · ${formatLessonDuration(p.durationMinutes, t)}`
        : isPrivateCategory && p.durationMinutes == null
          ? ` · ${t("prices.tariffDurationLegacy")}`
          : "";

    return (
      <div
        key={priceId}
        className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col justify-between gap-4 h-full"
      >
        <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-slate-800 text-sm leading-snug break-words min-w-0 flex-1">
              {title}
            </h4>
            {canWritePrices && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => startEditMeta(p)}
                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
                title={t("prices.action.edit")}
                aria-label={`${t("prices.action.edit")} ${title}`}
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setArchiveTarget(p)}
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                title={t("prices.action.archive")}
                aria-label={`${t("prices.action.archive")} ${title}`}
              >
                <Archive className="w-4 h-4" />
              </button>
            </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400 font-sans tracking-tight font-normal">
            {description}
            {isMonthlyUnlimitedTariff(p)
              ? t("prices.unlimitedSuffix")
              : getPriceCategory(p) === "group" || p.lessons > 1
                ? ` · ${t(lessonCountKey(p.lessons), { count: p.lessons })}`
                : ""}
            {durationSuffix}
            {" · "}
            {formatCurrency(p.price)}
          </p>
          <p className="text-[10px] font-sans mt-1 space-x-2">
            {!p.locationId && getPriceDisciplineIds(p).length === 0 ? (
              <span className="text-slate-400">{t("prices.globalTariff")}</span>
            ) : (
              <>
                {p.locationId ? (
                  <span className="text-indigo-600 font-semibold">
                    {t("prices.localTariff")} · {locationMap[p.locationId] ?? t("prices.fallbackLocation")}
                  </span>
                ) : null}
                {getPriceDisciplineIds(p).length > 0 ? (
                  <span className="text-indigo-500 font-semibold">
                    {t("prices.disciplineLabel")} ·{" "}
                    {getPriceDisciplineIds(p)
                      .map((id) => disciplineMap[id] ?? t("prices.fallbackDiscipline"))
                      .join(", ")}
                  </span>
                ) : null}
              </>
            )}
            {!isGlobalTeacherTariff(p) ? (
              <span className="text-indigo-700 font-semibold">
                {t("prices.teacherLabel")} ·{" "}
                {(p.teacherMemberIds ?? [])
                  .map((id) => teacherMap[id] ?? t("prices.fallbackTeacher"))
                  .join(", ")}
              </span>
            ) : null}
          </p>
          {canWritePrices && (
            <TeacherTariffDropdown
              label={t("ui.tariff.bindTeacher")}
              teachers={teacherOptions}
              selectedTeacherIds={p.teacherMemberIds ?? []}
              onChange={(teacherMemberIds) => handleTeacherBindingChange(priceId, teacherMemberIds)}
              disabled={syncingTeacherRows[priceId] || updatePriceTeachers.isPending}
              compact
            />
          )}
        </div>

        <div className="flex items-center gap-2 w-full justify-end shrink-0 mt-auto">
          {canWritePrices ? (
          <>
          <div className="relative font-sans w-36 text-right">
            <input
              type="number"
              value={currentInputVal}
              disabled={isSyncing}
              onChange={(e) => handleInputChange(priceId, e.target.value)}
              aria-label={t("prices.aria.price", { title })}
              className="w-full bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-2.5 py-1.5 text-xs text-right font-semibold pr-6 transition-all disabled:opacity-60"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-sans font-normal text-slate-400">
              {currencySuffix}
            </span>
          </div>

          <button
            onClick={() => handleSavePrice(priceId, p.price)}
            disabled={isSyncing || !isTouched}
            className={`px-3 py-1.5 rounded-lg text-xs font-sans font-semibold uppercase transition-colors flex items-center gap-1.5 border ${
              isTouched
                ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 cursor-pointer"
                : "bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed"
            }`}
          >
            {isSyncing ? t("common.saving") : t("common.save")}
          </button>
          </>
          ) : (
            <span className="text-sm font-semibold text-slate-700">{formatCurrency(p.price)}</span>
          )}
        </div>
      </div>
    );
  };

  const renderTariffSection = (title: string, items: { priceObj: Price }[]) => (
    <section className="panel-card-stack">
      <h3 className="font-semibold text-xs text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-2">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 font-sans py-2">{t("prices.noTariffs")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map(renderPriceRow)}
        </div>
      )}
    </section>
  );

  return (
    <div id="panel-prices" className="panel-page-stack">
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="panel-form-header">
          <div className="panel-form-header-icon">
            <Coins className="w-5 h-5 text-indigo-600" />
          </div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">{t("prices.pageTitle")}</h2>
          <p className="text-slate-400 text-[11px] leading-snug">
            {t("prices.pageSubtitle")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={priceListView === "active"}
            onClick={() => setPriceListView("active")}
            className={`h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              priceListView === "active"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t("prices.view.active")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={priceListView === "archive"}
            onClick={() => setPriceListView("archive")}
            className={`h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
              priceListView === "archive"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Archive className="w-4 h-4" />
            {t("prices.view.archive")}
          </button>
        </div>

        {priceListView === "active" && (
        <>
        <RequirePermission action="prices.write">
        <button
          type="button"
          onClick={openCreatePicker}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-sans font-semibold uppercase tracking-wider transition-colors cursor-pointer"
        >
          <Ticket className="w-3.5 h-3.5" />
          {t("prices.add")}
        </button>
        </RequirePermission>

        {prices.length === 0 ? (
          <div className="text-center py-20 text-slate-400 space-y-3">
            <Ticket className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-sm">{t("prices.empty")}</p>
            {canWritePrices && (
              <button
                type="button"
                onClick={openCreatePicker}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
              >
                {t("prices.addFirst")}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {renderTariffSection(t("prices.section.group"), groupItems)}
            {renderTariffSection(t("prices.section.singleVisit"), singleVisitItems)}
            {personalLessonsEnabled
              ? renderTariffSection(t("prices.section.privateLesson"), privateLessonItems)
              : null}
            {personalLessonsEnabled
              ? renderTariffSection(t("prices.section.privatePackage"), privatePackageItems)
              : null}
          </div>
        )}
        </>
        )}

        {priceListView === "archive" && (
          archivedPricesQuery.isLoading ? (
            <LoadingState label={t("prices.archive.loading")} />
          ) : archivedPricesQuery.isError ? (
            <QueryErrorState error={archivedPricesQuery.error} />
          ) : archivedPrices.length === 0 ? (
            <div className="text-center py-20 text-slate-400 space-y-3">
              <Archive className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-sm">{t("prices.archive.empty")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {archivedPrices.map((price) => {
                const title = getPriceLabel(price, t);
                const createdAt = price.createdAt ? formatDate(price.createdAt.slice(0, 10)) : "—";
                const archivedAt = price.archivedAt ? formatDate(price.archivedAt.slice(0, 10)) : "—";
                const salesCount = price.salesCount ?? 0;
                const salesKey = plural(
                  salesCount,
                  ["prices.sales.one", "prices.sales.few", "prices.sales.many"]
                ) as I18nKey;

                return (
                  <div
                    key={price.id}
                    className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col gap-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-semibold text-slate-800 text-sm leading-snug break-words">
                          {title}
                        </h4>
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-200 text-slate-600">
                          {t("prices.status.archived")}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{getPriceDescription(price, t)}</p>
                      {isPrivateTariffWithDuration(price) && (
                        <p className="text-[11px] text-slate-400">
                          {price.durationMinutes != null
                            ? formatLessonDuration(price.durationMinutes, t)
                            : t("prices.tariffDurationLegacy")}
                          {" · "}
                          {formatCurrency(price.price)}
                        </p>
                      )}
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <dt className="text-slate-400">{t("prices.archive.createdAt")}</dt>
                        <dd className="font-semibold text-slate-700">{createdAt}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">{t("prices.archive.archivedAt")}</dt>
                        <dd className="font-semibold text-slate-700">{archivedAt}</dd>
                      </div>
                      <div className="col-span-2 border-t border-slate-200 pt-2">
                        <dt className="text-slate-400">{t("prices.archive.sales")}</dt>
                        <dd className="font-semibold text-slate-700">
                          {t(salesKey, { count: salesCount })}
                        </dd>
                      </div>
                    </dl>
                    {canWritePrices && (
                      <button
                        type="button"
                        onClick={() => void handleRestore(price)}
                        disabled={restorePrice.isPending}
                        className="h-8 w-full flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <RotateCcw className="w-4 h-4" />
                        {t("prices.action.restore")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      <AnimatePresence>
        {editingPrice && canWritePrices && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingPrice(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full max-h-[90vh] overflow-y-auto p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 sticky top-0 bg-white z-10">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">{t("prices.editTitle")}</h3>
                <button
                  type="button"
                  onClick={() => setEditingPrice(null)}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="panel-form-stack font-sans">
                <div className="field-stack">
                  <label className={labelCls}>{t("prices.form.name")}</label>
                  <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className={inputCls} />
                </div>
                <div className="field-stack">
                  <label className={labelCls}>{t("prices.form.description")}</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    className={descriptionFieldCls}
                  />
                </div>
                {editingPrice && isPrivateTariffWithDuration(editingPrice) && (
                  <>
                    <PersonalTariffDurationField
                      select={editDurationSelect}
                      onSelectChange={setEditDurationSelect}
                      customValue={editDurationCustom}
                      onCustomValueChange={setEditDurationCustom}
                      legacyOptional={editingPrice.durationMinutes == null}
                    />
                    {(unpaidByPriceQuery.data ?? 0) > 0 && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
                        {t("prices.warn.unpaidLessonsByTariff", { count: unpaidByPriceQuery.data ?? 0 })}
                      </p>
                    )}
                  </>
                )}
                <LocationTariffField
                  bindToLocation={editBindToLocation}
                  onBindChange={setEditBindToLocation}
                  locationId={editLocationId}
                  onLocationChange={setEditLocationId}
                  locations={locations}
                />
                <DisciplineTariffField
                  bindToDiscipline={editBindToDiscipline}
                  onBindChange={setEditBindToDiscipline}
                  disciplineIds={editDisciplineIds}
                  onDisciplineIdsChange={setEditDisciplineIds}
                  disciplines={disciplines}
                />
                <TeacherTariffDropdown
                  label={t("ui.tariff.bindTeacher")}
                  teachers={teacherOptions}
                  selectedTeacherIds={editTeacherMemberIds}
                  onChange={setEditTeacherMemberIds}
                />
              </div>

              <div className="flex items-center gap-3 pt-1 text-xs">
                <button
                  type="button"
                  onClick={handleSaveMeta}
                  disabled={updatePriceMeta.isPending}
                  className={`flex-1 ${btnAddCls}`}
                >
                  {updatePriceMeta.isPending ? t("common.saving") : t("prices.modal.accept")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingPrice(null)}
                  className={`flex-1 ${btnCancelCls}`}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {createModalStep === "picker" && canWritePrices && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeCreateModal}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                    <Coins className="w-4 h-4 text-indigo-600" />
                  </div>
                  <h3 className="text-base font-semibold tracking-tight text-slate-900">
                    {t("prices.selectTypeTitle")}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 pt-1">
                {CREATE_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => openCreateForm(tab.id)}
                    className="w-full text-left px-4 py-3 border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 text-slate-700 text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={closeCreateModal}
                className={`w-full ${btnCancelCls}`}
              >
                {t("common.close")}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {createModalStep === "form" && canWritePrices && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeCreateModal}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full max-h-[90vh] overflow-y-auto p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 sticky top-0 bg-white z-10">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                    <Coins className="w-4 h-4 text-indigo-600" />
                  </div>
                  <h3 className="text-base font-semibold tracking-tight text-slate-900">
                    {activeCreateTabMeta.formTitle}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="font-sans">
                {activeCreateTab === "group" && (
                  <TariffCreateSection
                    compact
                    onSubmit={() => handleCreateTariff("group")}
                    pending={creatingSection === "group"}
                  >
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.format")}</label>
                      <AppSelect
                        value={groupForm.format}
                        onChange={(e) =>
                          setGroupForm({
                            ...groupForm,
                            format: e.target.value as GroupParticipantFormat,
                          })
                        }
                      >
                        <option value="solo">{t("common.formatSolo")}</option>
                        {pairSubscriptionsEnabled && <option value="pair">{t("common.formatPair")}</option>}
                        <option value="monthly_unlimited">{t("prices.form.monthlyUnlimited")}</option>
                      </AppSelect>
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.name")}</label>
                      <input
                        type="text"
                        value={groupForm.label}
                        onChange={(e) => setGroupForm({ ...groupForm, label: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.description")}</label>
                      <textarea
                        value={groupForm.description}
                        onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                        rows={2}
                        className={descriptionFieldCls}
                      />
                    </div>
                    {groupForm.format !== "monthly_unlimited" && (
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.lessons")}</label>
                      <input
                        type="number"
                        min={1}
                        value={groupForm.lessons}
                        onChange={(e) => setGroupForm({ ...groupForm, lessons: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    )}
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.cost")}</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          value={groupForm.price}
                          onChange={(e) => setGroupForm({ ...groupForm, price: e.target.value })}
                          className={`${inputCls} pr-8`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{currencySuffix}</span>
                      </div>
                    </div>
                    {locationTariffField}
                    {disciplineTariffField}
                    {teacherTariffField}
                  </TariffCreateSection>
                )}

                {activeCreateTab === "privateLesson" && (
                  <TariffCreateSection
                    compact
                    onSubmit={() => handleCreateTariff("privateLesson")}
                    pending={creatingSection === "privateLesson"}
                  >
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.name")}</label>
                      <input
                        type="text"
                        value={privateLessonForm.label}
                        onChange={(e) => setPrivateLessonForm({ ...privateLessonForm, label: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.description")}</label>
                      <textarea
                        value={privateLessonForm.description}
                        onChange={(e) =>
                          setPrivateLessonForm({ ...privateLessonForm, description: e.target.value })
                        }
                        rows={2}
                        className={descriptionFieldCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.cost")}</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          value={privateLessonForm.price}
                          onChange={(e) => setPrivateLessonForm({ ...privateLessonForm, price: e.target.value })}
                          className={`${inputCls} pr-8`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{currencySuffix}</span>
                      </div>
                    </div>
                    <PersonalTariffDurationField
                      select={privateLessonForm.durationSelect}
                      onSelectChange={(durationSelect) =>
                        setPrivateLessonForm({ ...privateLessonForm, durationSelect })
                      }
                      customValue={privateLessonForm.durationCustom}
                      onCustomValueChange={(durationCustom) =>
                        setPrivateLessonForm({ ...privateLessonForm, durationCustom })
                      }
                    />
                    {locationTariffField}
                    {disciplineTariffField}
                    {teacherTariffField}
                  </TariffCreateSection>
                )}

                {activeCreateTab === "singleVisit" && (
                  <TariffCreateSection
                    compact
                    onSubmit={() => handleCreateTariff("singleVisit")}
                    pending={creatingSection === "singleVisit"}
                  >
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.name")}</label>
                      <input
                        type="text"
                        value={singleVisitForm.label}
                        onChange={(e) => setSingleVisitForm({ ...singleVisitForm, label: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.description")}</label>
                      <textarea
                        value={singleVisitForm.description}
                        onChange={(e) => setSingleVisitForm({ ...singleVisitForm, description: e.target.value })}
                        rows={2}
                        className={descriptionFieldCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.cost")}</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          value={singleVisitForm.price}
                          onChange={(e) => setSingleVisitForm({ ...singleVisitForm, price: e.target.value })}
                          className={`${inputCls} pr-8`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{currencySuffix}</span>
                      </div>
                    </div>
                    {locationTariffField}
                    {disciplineTariffField}
                    {teacherTariffField}
                  </TariffCreateSection>
                )}

                {activeCreateTab === "privatePackage" && (
                  <TariffCreateSection
                    compact
                    onSubmit={() => handleCreateTariff("privatePackage")}
                    pending={creatingSection === "privatePackage"}
                  >
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.format")}</label>
                      <AppSelect
                        value={privatePackageForm.format}
                        onChange={(e) =>
                          setPrivatePackageForm({
                            ...privatePackageForm,
                            format: e.target.value as PrivatePackageFormat,
                          })
                        }
                      >
                        <option value="solo">{t("common.formatSolo")}</option>
                        {pairSubscriptionsEnabled && <option value="pair">{t("common.formatPair")}</option>}
                        {trioLessonsEnabled && <option value="trio">{t("common.formatTrio")}</option>}
                      </AppSelect>
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.name")}</label>
                      <input
                        type="text"
                        value={privatePackageForm.label}
                        onChange={(e) => setPrivatePackageForm({ ...privatePackageForm, label: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.description")}</label>
                      <textarea
                        value={privatePackageForm.description}
                        onChange={(e) =>
                          setPrivatePackageForm({ ...privatePackageForm, description: e.target.value })
                        }
                        rows={2}
                        className={descriptionFieldCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.lessons")}</label>
                      <input
                        type="number"
                        min={2}
                        value={privatePackageForm.lessons}
                        onChange={(e) => setPrivatePackageForm({ ...privatePackageForm, lessons: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("prices.form.cost")}</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          value={privatePackageForm.price}
                          onChange={(e) => setPrivatePackageForm({ ...privatePackageForm, price: e.target.value })}
                          className={`${inputCls} pr-8`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{currencySuffix}</span>
                      </div>
                    </div>
                    <PersonalTariffDurationField
                      select={privatePackageForm.durationSelect}
                      onSelectChange={(durationSelect) =>
                        setPrivatePackageForm({ ...privatePackageForm, durationSelect })
                      }
                      customValue={privatePackageForm.durationCustom}
                      onCustomValueChange={(durationCustom) =>
                        setPrivatePackageForm({ ...privatePackageForm, durationCustom })
                      }
                    />
                    {locationTariffField}
                    {disciplineTariffField}
                    {teacherTariffField}
                  </TariffCreateSection>
                )}
              </div>

              <button
                type="button"
                onClick={closeCreateModal}
                className={`w-full ${btnCancelCls}`}
              >
                {t("common.close")}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={archiveTarget !== null}
        title={t("prices.confirm.archiveTitle")}
        description={
          archiveTarget ? (
            <>
              {t("prices.confirm.archiveBody", { name: getPriceLabel(archiveTarget, t) })}
            </>
          ) : (
            ""
          )
        }
        confirmLabel={t("prices.confirm.archiveConfirm")}
        pending={archivePrice.isPending}
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
