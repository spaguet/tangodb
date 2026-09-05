import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  Building2,
  Calendar,
  ChevronRight,
  FileWarning,
  Search,
  UserPlus,
} from "lucide-react";
import type { ToastType } from "../../App";
import type { RenterCounterpartyType, RenterDebtFilter, RenterDuplicateMatch, RenterStatus } from "../../types";
import { parseTelegramIdInput } from "../../lib/renterNormalize";
import { useI18n } from "../../hooks/useI18n";
import { useCan } from "../../hooks/usePermissions";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import {
  useCheckRenterDuplicates,
  useRentersList,
  useUpsertRenter,
} from "../../hooks/useRenterCrm";
import { translateConnectionBlockReason, translateMutationBlockedMessage } from "../../hooks/useOnlineStatus";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import AppSelect, { fieldCls as inputCls, searchFieldCls } from "../ui/AppSelect";
import { btnAddCls } from "../ui/buttonStyles";
import LoadingState from "../ui/LoadingState";
import SectionPillNav from "../ui/SectionPillNav";
import QueryErrorState from "../ui/QueryErrorState";
import RequirePermission from "../RequirePermission";
import RenterDuplicateDialog from "./RenterDuplicateDialog";

interface RentersPanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

type ListTab = "active" | "archived" | "blocked";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function RentersPanel({ toast }: RentersPanelProps) {
  const { t, formatDate } = useI18n();
  const navigate = useNavigate();
  const { connectionState } = useOnlineStatus();
  const canOpenContacts = useCan("renters.contacts.read");
  const canSeeFinance = useCan("renters.finance.read");
  const canNavigateToDetail = canOpenContacts || canSeeFinance;
  const financeOnlyList = canSeeFinance && !canOpenContacts;

  const renterTypeLabel = (type: RenterCounterpartyType) => {
    if (type === "sole_proprietor") return t("renters.type.soleProprietor");
    if (type === "company") return t("renters.type.company");
    return t("renters.type.individual");
  };

  const [activeTab, setActiveTab] = useState<ListTab>("active");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RenterCounterpartyType | "">("");
  const [debtFilter, setDebtFilter] = useState<"" | RenterDebtFilter>("");
  const [upcomingFilter, setUpcomingFilter] = useState<"" | "yes" | "no">("");

  const [displayName, setDisplayName] = useState("");
  const [counterpartyType, setCounterpartyType] = useState<RenterCounterpartyType>("individual");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [telegramId, setTelegramId] = useState("");

  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<RenterDuplicateMatch[]>([]);
  const [pendingPayload, setPendingPayload] = useState<Record<string, string> | null>(null);

  const statusFilter: RenterStatus | null =
    activeTab === "active" ? "active" : activeTab === "archived" ? "archived" : "blocked";

  const listQuery = useRentersList({
    search: search.trim() || undefined,
    type: typeFilter || null,
    status: statusFilter,
    debtFilter: debtFilter || null,
    upcoming: upcomingFilter === "" ? null : upcomingFilter === "yes",
  });

  const checkDuplicates = useCheckRenterDuplicates();
  const upsertRenter = useUpsertRenter();

  const tabs = [
    { id: "active" as const, label: t("renters.tab.active"), icon: Building2 },
    { id: "archived" as const, label: t("renters.tab.archived"), icon: Archive },
    { id: "blocked" as const, label: t("renters.tab.blocked"), icon: AlertCircle },
  ];

  const filteredRows = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const submitRenter = async (duplicateReason?: string) => {
    const payload = pendingPayload ?? {
      displayName,
      contactPhone,
      contactEmail,
      taxId,
      counterpartyType,
      telegramId,
    };

    const parsedTg = parseTelegramIdInput(payload.telegramId ?? telegramId);
    if (!parsedTg.ok) {
      toast(t("renters.error.telegramIdInvalid"), "error");
      return false;
    }

    const res = await upsertRenter.mutateAsync({
      displayName: payload.displayName ?? displayName,
      counterpartyType: (payload.counterpartyType as RenterCounterpartyType) ?? counterpartyType,
      contactPhone: payload.contactPhone ?? contactPhone,
      contactEmail: payload.contactEmail ?? contactEmail,
      taxId: payload.taxId ?? taxId,
      telegramId: parsedTg.value,
      duplicateCreateReason: duplicateReason,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "renters.error.saveFailed", t), "error");
      return false;
    }

    toast(t("renters.success.added"), "success");
    setDisplayName("");
    setContactPhone("");
    setContactEmail("");
    setTaxId("");
    setTelegramId("");
    setPendingPayload(null);
    setDuplicateOpen(false);
    return true;
  };

  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (connectionState !== "online") {
      const blocked = translateMutationBlockedMessage(connectionState, t);
      if (blocked) toast(blocked, "error");
      return;
    }
    if (!displayName.trim()) {
      toast(t("renters.error.displayNameRequired"), "error");
      return;
    }

    const dupRes = await checkDuplicates.mutateAsync({
      contactPhone,
      contactEmail,
      taxId,
    });

    if (dupRes.success && dupRes.duplicates.length > 0) {
      setDuplicates(dupRes.duplicates);
      setPendingPayload({
        displayName: displayName.trim(),
        contactPhone,
        contactEmail,
        taxId,
        counterpartyType,
        telegramId,
      });
      setDuplicateOpen(true);
      return;
    }

    await submitRenter();
  };

  if (listQuery.isLoading) return <LoadingState label={t("renters.loading")} />;
  if (listQuery.isError) return <QueryErrorState error={listQuery.error} />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <RequirePermission
        action="renters.write"
        fallback={
          <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-xs text-xs text-slate-500">
            {t("renters.readOnlyHint")}
          </div>
        }
      >
        <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
          <div className="flex items-center gap-2.5 text-slate-800 border-b border-slate-100 pb-3">
            <UserPlus className="w-4.5 h-4.5 text-indigo-500" />
            <h2 className="text-base font-semibold tracking-tight">{t("renters.form.addTitle")}</h2>
          </div>

          <form onSubmit={(e) => void handleSubmitAdd(e)} noValidate className="panel-form-stack font-sans">
            <div className="field-stack">
              <label className={labelCls}>{t("renters.form.displayName")}</label>
              <input required className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <AppSelect
              label={t("renters.form.counterpartyType")}
              value={counterpartyType}
              onChange={(e) => setCounterpartyType(e.target.value as RenterCounterpartyType)}
            >
              <option value="individual">{t("renters.type.individual")}</option>
              <option value="sole_proprietor">{t("renters.type.soleProprietor")}</option>
              <option value="company">{t("renters.type.company")}</option>
            </AppSelect>
            <div className="field-stack">
              <label className={labelCls}>{t("renters.form.phone")}</label>
              <input type="tel" className={inputCls} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div className="field-stack">
              <label className={labelCls}>{t("renters.form.email")}</label>
              <input type="email" className={inputCls} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
            <div className="field-stack">
              <label className={labelCls}>{t("renters.form.telegramId")}</label>
              <input
                className={inputCls}
                inputMode="numeric"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
                placeholder={t("renters.form.telegramIdPlaceholder")}
              />
            </div>
            {(counterpartyType === "sole_proprietor" || counterpartyType === "company") && (
              <div className="field-stack">
                <label className={labelCls}>{t("renters.form.taxId")}</label>
                <input className={inputCls} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
              </div>
            )}
            <button
              type="submit"
              disabled={connectionState !== "online" || upsertRenter.isPending}
              title={translateConnectionBlockReason(connectionState, t)}
              className={`w-full ${btnAddCls}`}
            >
              {upsertRenter.isPending ? t("common.saving") : t("common.save")}
            </button>
          </form>
        </div>
      </RequirePermission>

      <div className="lg:col-span-8 flex flex-col gap-3">
        <SectionPillNav items={tabs} activeId={activeTab} onChange={(tab) => setActiveTab(tab)} />

        <div className="bg-white p-4 border border-slate-200 shadow-xs panel-card-stack space-y-3 rounded-xl">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className={searchFieldCls}
                placeholder={t("renters.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <AppSelect label={t("renters.filter.type")} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as RenterCounterpartyType | "")}>
              <option value="">{t("renters.filter.all")}</option>
              <option value="individual">{t("renters.type.individual")}</option>
              <option value="sole_proprietor">{t("renters.type.soleProprietor")}</option>
              <option value="company">{t("renters.type.company")}</option>
            </AppSelect>
            {canSeeFinance ? (
              <AppSelect
                label={t("renters.filter.debt")}
                value={debtFilter}
                onChange={(e) => setDebtFilter(e.target.value as "" | RenterDebtFilter)}
              >
                <option value="">{t("renters.filter.all")}</option>
                <option value="cashier">{t("renters.filter.debtCashier")}</option>
                <option value="miniapp">{t("renters.filter.debtMiniapp")}</option>
                <option value="any">{t("renters.filter.debtAny")}</option>
              </AppSelect>
            ) : null}
            <AppSelect label={t("renters.filter.upcoming")} value={upcomingFilter} onChange={(e) => setUpcomingFilter(e.target.value as "" | "yes" | "no")}>
              <option value="">{t("renters.filter.all")}</option>
              <option value="yes">{t("renters.filter.yes")}</option>
              <option value="no">{t("renters.filter.no")}</option>
            </AppSelect>
          </div>

          {filteredRows.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">{t("renters.detail.noRentals")}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!canNavigateToDetail) return;
                      navigate(`/renters/${row.id}`, {
                        state: financeOnlyList ? { initialTab: "finance" as const } : undefined,
                      });
                    }}
                    disabled={!canNavigateToDetail}
                    className="w-full flex items-center gap-3 py-3 px-1 text-left hover:bg-slate-50 rounded-lg cursor-pointer disabled:cursor-default"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">{row.displayName}</p>
                      <p className="text-[9px] uppercase font-semibold text-slate-400 mt-0.5">
                        {renterTypeLabel(row.counterpartyType)}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        {row.hasExpiringDocument ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                            <FileWarning className="w-3 h-3" />
                            {t("renters.reminder.expiringDoc")}
                          </span>
                        ) : null}
                        {row.hasOverdueDebt ? (
                          <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">
                            {t("renters.reminder.overdueDebt")}
                          </span>
                        ) : null}
                        {canSeeFinance && (row.miniappDebt ?? 0) > 0 ? (
                          <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">
                            {t("renters.reminder.miniappDebt")}
                          </span>
                        ) : null}
                        {row.hasNextActionDue ? (
                          <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                            {t("renters.reminder.nextAction")}
                          </span>
                        ) : null}
                      </div>
                      {!financeOnlyList ? (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {[row.primaryContactName, row.contactPhone, row.contactEmail]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                        {row.nextRentalDate ? (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(row.nextRentalDate)}
                          </span>
                        ) : null}
                        {canSeeFinance && (row.cashierDebt ?? 0) > 0 ? (
                          <span className="text-rose-600 font-semibold">
                            {t("renters.list.cashierDebt")}: {formatCurrency(row.cashierDebt ?? 0)}
                          </span>
                        ) : null}
                        {canSeeFinance && (row.miniappDebt ?? 0) > 0 ? (
                          <span className="text-violet-700 font-semibold">
                            {t("renters.list.miniappDebt")}: {formatCurrency(row.miniappDebt ?? 0)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {canNavigateToDetail ? (
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <RenterDuplicateDialog
        open={duplicateOpen}
        duplicates={duplicates}
        onClose={() => {
          setDuplicateOpen(false);
          setPendingPayload(null);
        }}
        onOpenExisting={(id) => {
          setDuplicateOpen(false);
          navigate(`/renters/${id}`);
        }}
        onCreateAnyway={(reason) => void submitRenter(reason)}
      />
    </div>
  );
}
