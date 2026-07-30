import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Coins,
  FileText,
  LayoutGrid,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import type { ToastType } from "../../App";
import type {
  RenterCommunicationType,
  RenterContact,
  RenterContract,
  RenterDetailCore,
  RenterDocument,
  RenterFinanceSummary,
  RenterRentalCounts,
  RenterRentalRow,
  RenterCommunication,
} from "../../types";
import { useI18n } from "../../hooks/useI18n";
import { useCan } from "../../hooks/usePermissions";
import { useLocations } from "../../hooks/useLocations";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import {
  useArchiveRenter,
  useCreateRenterCommunication,
  useDeleteRenterContact,
  useDeleteRenterDocument,
  useDownloadRenterDocument,
  useRenterDetail,
  useRenterRentals,
  useUploadRenterDocument,
  useUpsertRenterContact,
  useUpsertRenterContract,
} from "../../hooks/useRenterCrm";
import { useRenterRentalFinance, useRenterRentalInvoices } from "../../hooks/useRentalInvoices";
import { translateMutationBlockedMessage } from "../../hooks/useOnlineStatus";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import AppSelect, { descriptionFieldCls, fieldCls as inputCls } from "../ui/AppSelect";
import ConfirmDialog from "../ui/ConfirmDialog";
import LoadingState from "../ui/LoadingState";
import PageTabs, { pageTabPanelCls } from "../ui/PageTabs";
import QueryErrorState from "../ui/QueryErrorState";

interface RenterDetailPanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

type DetailTab = "overview" | "rentals" | "finance" | "contracts" | "communications";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function RenterDetailPanel({ toast }: RenterDetailPanelProps) {
  const { renterId = "" } = useParams();
  const navigate = useNavigate();
  const { t, formatDate, formatDateTime } = useI18n();
  const { connectionState } = useOnlineStatus();
  const canWrite = useCan("renters.write");
  const canSeeFinance = useCan("renters.finance.read");
  const canSeeDocuments = useCan("renters.documents.read");
  const canWriteDocuments = useCan("renters.documents.write");
  const canWriteContacts = useCan("renters.contacts.write");
  const canWriteContracts = useCan("renters.contracts.write");

  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveForce, setArchiveForce] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

  const detailQuery = useRenterDetail(renterId);
  const rentalsQuery = useRenterRentals(renterId, activeTab === "rentals" || activeTab === "finance");
  const locationsQuery = useLocations();

  const archiveRenter = useArchiveRenter();
  const upsertContact = useUpsertRenterContact();
  const deleteContact = useDeleteRenterContact();
  const upsertContract = useUpsertRenterContract();
  const uploadDocument = useUploadRenterDocument();
  const downloadDocument = useDownloadRenterDocument();
  const deleteDocument = useDeleteRenterDocument();
  const createCommunication = useCreateRenterCommunication();

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locationsQuery.data ?? []) {
      map.set(loc.id, loc.name);
    }
    return map;
  }, [locationsQuery.data]);

  const tabs: import("../ui/PageTabs").PageTabItem[] = useMemo(() => {
    const items: import("../ui/PageTabs").PageTabItem[] = [
      { id: "overview", label: t("renters.detail.overview"), icon: LayoutGrid },
      { id: "rentals", label: t("renters.detail.rentals"), icon: Building2 },
    ];
    if (canSeeFinance) {
      items.push({ id: "finance", label: t("renters.detail.finance"), icon: Coins });
    }
    if (canWriteContracts || canSeeDocuments) {
      items.push({ id: "contracts", label: t("renters.detail.contracts"), icon: FileText });
    }
    items.push({ id: "communications", label: t("renters.detail.communications"), icon: MessageSquare });
    return items;
  }, [t, canSeeFinance, canWriteContracts, canSeeDocuments]);

  if (detailQuery.isLoading) return <LoadingState label={t("renters.loading")} />;
  if (detailQuery.isError || !detailQuery.data) {
    return <QueryErrorState error={detailQuery.error} />;
  }

  const detail = detailQuery.data;
  const { renter, contacts, contracts, documents, communications, finance, rentalCounts } = detail;

  const handleArchive = async (force = false) => {
    if (connectionState !== "online") {
      const blocked = translateMutationBlockedMessage(connectionState, t);
      if (blocked) toast(blocked, "error");
      return;
    }
    const res = await archiveRenter.mutateAsync({
      renterId,
      force,
      reason: archiveReason.trim() || undefined,
    });
    if (!res.success) {
      if (res.error === "renters.error.activeRentalsExist") {
        setArchiveForce(true);
        return;
      }
      toast(resolveMutationError(res.error, "renters.error.archiveFailed", t), "error");
      return;
    }
    toast(t("renters.success.archived"), "success");
    setArchiveOpen(false);
    navigate("/renters");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => navigate("/renters")}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("renters.detail.back")}
        </button>
        {canWrite && renter.status !== "archived" ? (
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            className="text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
          >
            {t("renters.archive.title")}
          </button>
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
        <h1 className="text-lg font-semibold text-slate-900">{renter.displayName}</h1>
        <p className="text-xs text-slate-500 mt-1">
          {renter.status === "active"
            ? t("renters.status.active")
            : renter.status === "archived"
              ? t("renters.status.archived")
              : t("renters.status.blocked")}
          {renter.nextRentalDate ? ` · ${t("renters.detail.nextRental")}: ${formatDate(renter.nextRentalDate)}` : ""}
        </p>
      </div>

      <PageTabs tabs={tabs} activeTab={activeTab} onChange={(tab) => setActiveTab(tab as DetailTab)} />

      <div className={`bg-white border border-slate-200 shadow-xs p-4 ${pageTabPanelCls(activeTab, tabs[0]?.id ?? "overview")}`}>
        {activeTab === "overview" ? (
          <OverviewTab
            renter={renter}
            contacts={contacts}
            finance={finance}
            rentalCounts={rentalCounts}
            locationMap={locationMap}
            preferredIds={renter.preferredLocationIds ?? []}
            canWrite={canWrite}
            canWriteContacts={canWriteContacts}
            canSeeFinance={canSeeFinance}
            toast={toast}
            upsertContact={upsertContact}
            deleteContact={deleteContact}
            renterId={renterId}
          />
        ) : null}

        {activeTab === "rentals" ? (
          <RentalsTab
            rentals={rentalsQuery.data ?? []}
            locationMap={locationMap}
            canSeeFinance={canSeeFinance}
            renterId={renterId}
            navigate={navigate}
            formatDate={formatDate}
            t={t}
          />
        ) : null}

        {activeTab === "finance" && canSeeFinance ? (
          <FinanceTab renterId={renterId} finance={finance} rentals={rentalsQuery.data ?? []} locationMap={locationMap} t={t} formatDate={formatDate} />
        ) : null}

        {activeTab === "contracts" ? (
          <ContractsTab
            contracts={contracts}
            documents={documents}
            canWriteContracts={canWriteContracts}
            canSeeDocuments={canSeeDocuments}
            canWriteDocuments={canWriteDocuments}
            renterId={renterId}
            toast={toast}
            upsertContract={upsertContract}
            uploadDocument={uploadDocument}
            downloadDocument={downloadDocument}
            deleteDocument={deleteDocument}
            t={t}
            formatDate={formatDate}
          />
        ) : null}

        {activeTab === "communications" ? (
          <CommunicationsTab
            communications={communications}
            canWrite={canWrite}
            renterId={renterId}
            toast={toast}
            createCommunication={createCommunication}
            t={t}
            formatDateTime={formatDateTime}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={archiveOpen}
        title={archiveForce ? t("renters.archive.forceTitle") : t("renters.archive.title")}
        description={
          <>
            <p>{archiveForce ? t("renters.archive.forceMessage") : t("renters.archive.confirm")}</p>
            {!archiveForce ? (
              <input
                className={`${inputCls} mt-3`}
                placeholder={t("renters.archive.reason")}
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
              />
            ) : null}
          </>
        }
        onConfirm={() => void handleArchive(archiveForce)}
        onCancel={() => {
          setArchiveOpen(false);
          setArchiveForce(false);
          setArchiveReason("");
        }}
      />
    </div>
  );
}

function OverviewTab({
  renter,
  contacts,
  finance,
  rentalCounts,
  locationMap,
  preferredIds,
  canWrite,
  canWriteContacts,
  canSeeFinance,
  toast,
  upsertContact,
  deleteContact,
  renterId,
}: {
  renter: RenterDetailCore;
  contacts: RenterContact[];
  finance: RenterFinanceSummary | null;
  rentalCounts: RenterRentalCounts;
  locationMap: Map<string, string>;
  preferredIds: string[];
  canWrite: boolean;
  canWriteContacts: boolean;
  canSeeFinance: boolean;
  toast: RenterDetailPanelProps["toast"];
  upsertContact: ReturnType<typeof useUpsertRenterContact>;
  deleteContact: ReturnType<typeof useDeleteRenterContact>;
  renterId: string;
}) {
  const { t } = useI18n();
  const { connectionState } = useOnlineStatus();
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactPrimary, setContactPrimary] = useState(false);

  const warnings: string[] = [];
  if (renter.status === "blocked" && renter.blockedReason) {
    warnings.push(renter.blockedReason);
  }

  const handleAddContact = async () => {
    if (!contactName.trim()) return;
    const res = await upsertContact.mutateAsync({
      renterId,
      fullName: contactName.trim(),
      roleTitle: contactRole.trim() || undefined,
      phone: contactPhone.trim() || undefined,
      isPrimary: contactPrimary,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "renters.error.contactSaveFailed", t), "error");
      return;
    }
    toast(t("renters.success.contactSaved"), "success");
    setContactName("");
    setContactRole("");
    setContactPhone("");
    setContactPrimary(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 font-sans">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">{t("renters.detail.requisites")}</h3>
        <dl className="text-xs space-y-1.5 text-slate-600">
          {renter.legalName ? (
            <>
              <dt className={labelCls}>{t("renters.form.legalName")}</dt>
              <dd>{renter.legalName}</dd>
            </>
          ) : null}
          {renter.taxId ? (
            <>
              <dt className={labelCls}>{t("renters.form.taxId")}</dt>
              <dd>{renter.taxId}</dd>
            </>
          ) : null}
          {renter.contactPhone ? (
            <>
              <dt className={labelCls}>{t("renters.form.phone")}</dt>
              <dd>{renter.contactPhone}</dd>
            </>
          ) : null}
          {renter.contactEmail ? (
            <>
              <dt className={labelCls}>{t("renters.form.email")}</dt>
              <dd>{renter.contactEmail}</dd>
            </>
          ) : null}
          {renter.legalAddress ? (
            <>
              <dt className={labelCls}>{t("renters.form.legalAddress")}</dt>
              <dd>{renter.legalAddress}</dd>
            </>
          ) : null}
          {preferredIds.length > 0 ? (
            <>
              <dt className={labelCls}>{t("renters.form.preferredLocations")}</dt>
              <dd>{preferredIds.map((id) => locationMap.get(id) ?? id).join(", ")}</dd>
            </>
          ) : null}
          {renter.internalNotes ? (
            <>
              <dt className={labelCls}>{t("renters.form.internalNotes")}</dt>
              <dd className="whitespace-pre-wrap">{renter.internalNotes}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">{t("renters.detail.stats")}</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <StatBox label={t("renters.detail.completedRentals")} value={String(rentalCounts.completed)} />
          <StatBox label={t("renters.detail.upcomingRentals")} value={String(rentalCounts.upcoming)} />
          {canSeeFinance && finance ? (
            <>
              <StatBox label={t("renters.detail.turnover")} value={formatCurrency(finance.fixedTotal)} />
              <StatBox label={t("renters.detail.paid")} value={formatCurrency(finance.paidTotal)} />
              <StatBox label={t("renters.detail.debt")} value={formatCurrency(finance.debtTotal)} highlight={finance.debtTotal > 0} />
            </>
          ) : null}
        </div>
        {warnings.length > 0 ? (
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
            <p className={labelCls}>{t("renters.detail.warnings")}</p>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="lg:col-span-2 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">{t("renters.detail.contacts")}</h3>
        {contacts.length === 0 ? (
          <p className="text-xs text-slate-400">{t("renters.detail.noContacts")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 gap-2">
                <div>
                  <span className="font-semibold text-slate-800">{c.fullName}</span>
                  {c.isPrimary ? (
                    <span className="ml-2 text-[10px] uppercase font-semibold text-indigo-600">{t("renters.contact.primary")}</span>
                  ) : null}
                  <p className="text-xs text-slate-500">{[c.roleTitle, c.phone, c.email].filter(Boolean).join(" · ")}</p>
                </div>
                {canWriteContacts ? (
                  <button
                    type="button"
                    onClick={() =>
                      void deleteContact.mutateAsync({ contactId: c.id, renterId }).then((res) => {
                        if (!res.success) toast(resolveMutationError(res.error, "renters.error.contactSaveFailed", t), "error");
                      })
                    }
                    className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWriteContacts ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-100">
            <input className={inputCls} placeholder={t("renters.contact.fullName")} value={contactName} onChange={(e) => setContactName(e.target.value)} />
            <input className={inputCls} placeholder={t("renters.contact.role")} value={contactRole} onChange={(e) => setContactRole(e.target.value)} />
            <input className={inputCls} placeholder={t("renters.form.phone")} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            <label className="flex items-center gap-2 text-xs col-span-full">
              <input type="checkbox" checked={contactPrimary} onChange={(e) => setContactPrimary(e.target.checked)} />
              {t("renters.contact.primary")}
            </label>
            <button
              type="button"
              disabled={connectionState !== "online"}
              onClick={() => void handleAddContact()}
              className="col-span-full py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
            >
              {t("renters.contact.add")}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 ${highlight ? "border-rose-200 bg-rose-50" : "border-slate-100 bg-slate-50"}`}>
      <p className={labelCls}>{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${highlight ? "text-rose-700" : "text-slate-800"}`}>{value}</p>
    </div>
  );
}

function RentalsTab({
  rentals,
  locationMap,
  canSeeFinance,
  renterId,
  navigate,
  formatDate,
  t,
}: {
  rentals: RenterRentalRow[];
  locationMap: Map<string, string>;
  canSeeFinance: boolean;
  renterId: string;
  navigate: ReturnType<typeof useNavigate>;
  formatDate: (d: string) => string;
  t: (key: import("../../lib/i18n/keys").I18nKey) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link
          to={`/schedule?action=createRental&renterId=${renterId}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("renters.rentals.createNew")}
        </Link>
      </div>
      {rentals.length === 0 ? (
        <p className="text-sm text-slate-400">{t("renters.detail.noRentals")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 uppercase tracking-wider">
                <th className="pb-2 pr-3">{t("renters.rentals.colDate")}</th>
                <th className="pb-2 pr-3">{t("renters.rentals.colLocation")}</th>
                <th className="pb-2 pr-3">{t("renters.rentals.colStatus")}</th>
                {canSeeFinance ? (
                  <>
                    <th className="pb-2 pr-3">{t("renters.rentals.colAmount")}</th>
                    <th className="pb-2 pr-3">{t("renters.rentals.colPayment")}</th>
                  </>
                ) : null}
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {rentals.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatDate(r.rentalDate)} {r.timeStart}–{r.timeEnd}
                  </td>
                  <td className="py-2 pr-3">{locationMap.get(r.locationId) ?? "—"}</td>
                  <td className="py-2 pr-3">{r.bookingStatus}</td>
                  {canSeeFinance ? (
                    <>
                      <td className="py-2 pr-3">{r.fixedAmount != null ? formatCurrency(r.fixedAmount) : "—"}</td>
                      <td className="py-2 pr-3">{r.paymentStatus ?? "—"}</td>
                    </>
                  ) : null}
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/schedule?date=${r.rentalDate}`)}
                      className="text-indigo-600 font-semibold cursor-pointer"
                    >
                      {t("renters.rentals.openSchedule")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FinanceTab({
  renterId,
  finance,
  rentals,
  locationMap,
  t,
  formatDate,
}: {
  renterId: string;
  finance: RenterFinanceSummary | null;
  rentals: RenterRentalRow[];
  locationMap: Map<string, string>;
  t: (key: import("../../lib/i18n/keys").I18nKey) => string;
  formatDate: (d: string) => string;
}) {
  const rentalFinanceQuery = useRenterRentalFinance(renterId);
  const invoicesQuery = useRenterRentalInvoices(renterId);

  if (!finance) return null;
  const extended = rentalFinanceQuery.data;
  const withDebt = rentals.filter((r) => r.fixedAmount != null && r.paidAmount != null && r.fixedAmount > r.paidAmount);
  const invoices = invoicesQuery.data ?? [];

  const invoiceStatusLabel = (status: string) => {
    const key = `rentalInvoices.status.${status}` as import("../../lib/i18n/keys").I18nKey;
    return t(key);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatBox label={t("renters.detail.turnover")} value={formatCurrency(finance.fixedTotal)} />
        <StatBox label={t("renters.detail.paid")} value={formatCurrency(finance.paidTotal)} />
        <StatBox label={t("renters.detail.debt")} value={formatCurrency(finance.debtTotal)} highlight={finance.debtTotal > 0} />
        <StatBox label={t("renters.detail.overpaid")} value={formatCurrency(finance.overpaidTotal)} />
      </div>

      {extended ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatBox label={t("rentalInvoices.totalDebt")} value={formatCurrency(extended.totalDebt)} highlight={extended.totalDebt > 0} />
          <StatBox label={t("rentalInvoices.advanceBalance")} value={formatCurrency(extended.advanceBalance)} />
          <StatBox label={t("rentalInvoices.depositBalance")} value={formatCurrency(extended.depositBalance)} />
          <StatBox label={t("rentalInvoices.invoiceDebt")} value={formatCurrency(extended.invoiceDebt)} />
          <StatBox label={t("rentalInvoices.uninvoicedDebt")} value={formatCurrency(extended.uninvoicedRentalDebt)} />
          <StatBox label={t("rentalInvoices.overdueAmount")} value={formatCurrency(extended.overdueAmount)} highlight={extended.overdueAmount > 0} />
        </div>
      ) : rentalFinanceQuery.isLoading ? (
        <p className="text-xs text-slate-400">{t("common.loading.default")}</p>
      ) : null}

      {invoices.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">{t("rentalInvoices.title")}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 uppercase tracking-wider">
                  <th className="py-1 pr-2">{t("rentalInvoices.period")}</th>
                  <th className="py-1 pr-2">{t("rentalInvoices.dueDate")}</th>
                  <th className="py-1 pr-2">{t("rentalInvoices.statusLabel")}</th>
                  <th className="py-1 pr-2 text-right">{t("rentalInvoices.total")}</th>
                  <th className="py-1 text-right">{t("rentalInvoices.outstanding")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-50">
                    <td className="py-2 pr-2">{formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}</td>
                    <td className="py-2 pr-2">{formatDate(inv.dueDate)}</td>
                    <td className="py-2 pr-2">{invoiceStatusLabel(inv.status)}</td>
                    <td className="py-2 pr-2 text-right">{formatCurrency(inv.totalAmount)}</td>
                    <td className={`py-2 text-right font-semibold ${inv.outstanding > 0 ? "text-rose-600" : "text-slate-600"}`}>
                      {formatCurrency(inv.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {withDebt.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">{t("renters.detail.debt")}</h4>
          <ul className="text-xs space-y-1">
            {withDebt.map((r) => (
              <li key={r.id} className="flex justify-between border-b border-slate-50 py-1">
                <span>{formatDate(r.rentalDate)} · {locationMap.get(r.locationId)}</span>
                <span className="text-rose-600 font-semibold">
                  {formatCurrency((r.fixedAmount ?? 0) - (r.paidAmount ?? 0))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ContractsTab({
  contracts,
  documents,
  canWriteContracts,
  canSeeDocuments,
  canWriteDocuments,
  renterId,
  toast,
  upsertContract,
  uploadDocument,
  downloadDocument,
  deleteDocument,
  t,
  formatDate,
}: {
  contracts: RenterContract[];
  documents: RenterDocument[];
  canWriteContracts: boolean;
  canSeeDocuments: boolean;
  canWriteDocuments: boolean;
  renterId: string;
  toast: RenterDetailPanelProps["toast"];
  upsertContract: ReturnType<typeof useUpsertRenterContract>;
  uploadDocument: ReturnType<typeof useUploadRenterDocument>;
  downloadDocument: ReturnType<typeof useDownloadRenterDocument>;
  deleteDocument: ReturnType<typeof useDeleteRenterDocument>;
  t: (key: import("../../lib/i18n/keys").I18nKey) => string;
  formatDate: (d: string) => string;
}) {
  const [title, setTitle] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");

  const handleAddContract = async () => {
    if (!title.trim()) return;
    const res = await upsertContract.mutateAsync({ renterId, title: title.trim(), contractNumber: contractNumber.trim() || undefined });
    if (!res.success) {
      toast(resolveMutationError(res.error, "renters.error.contractSaveFailed", t), "error");
      return;
    }
    toast(t("renters.success.contractSaved"), "success");
    setTitle("");
    setContractNumber("");
  };

  const handleUpload = async () => {
    if (!docFile || !docName.trim()) return;
    const res = await uploadDocument.mutateAsync({
      renterId,
      file: docFile,
      displayName: docName.trim(),
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "renters.error.documentUploadFailed", t), "error");
      return;
    }
    toast(t("renters.success.documentUploaded"), "success");
    setDocFile(null);
    setDocName("");
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-slate-800 mb-2">{t("renters.contract.add")}</h3>
        {contracts.length === 0 ? (
          <p className="text-xs text-slate-400 mb-2">{t("renters.detail.noContracts")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm mb-4">
            {contracts.map((c) => (
              <li key={c.id} className="py-2">
                <p className="font-semibold text-slate-800">{c.title}</p>
                <p className="text-xs text-slate-500">
                  {[c.contractNumber, c.status, c.validFrom && c.validTo ? `${c.validFrom} – ${c.validTo}` : null].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canWriteContracts ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className={inputCls} placeholder={t("renters.contract.title")} value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className={inputCls} placeholder={t("renters.contract.number")} value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
            <button type="button" onClick={() => void handleAddContract()} className="sm:col-span-2 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg cursor-pointer">
              {t("renters.contract.add")}
            </button>
          </div>
        ) : null}
      </section>

      {canSeeDocuments ? (
        <section>
          <h3 className="text-sm font-semibold text-slate-800 mb-2">{t("renters.document.add")}</h3>
          {documents.length === 0 ? (
            <p className="text-xs text-slate-400 mb-2">{t("renters.detail.noDocuments")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm mb-4">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2 gap-2">
                  <div>
                    <p className="font-semibold text-slate-800">{d.displayName}</p>
                    <p className="text-xs text-slate-500">
                      {[d.category, d.validUntil ? formatDate(d.validUntil) : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void downloadDocument.mutateAsync(d.id).then((res) => {
                          if (res.success) window.open(res.url, "_blank");
                          else toast(resolveMutationError(res.error, "renters.error.documentUploadFailed", t), "error");
                        })
                      }
                      className="text-xs font-semibold text-indigo-600 cursor-pointer"
                    >
                      {t("renters.document.download")}
                    </button>
                    {canWriteDocuments ? (
                      <button
                        type="button"
                        onClick={() =>
                          void deleteDocument.mutateAsync({ documentId: d.id, renterId }).then((res) => {
                            if (!res.success) toast(resolveMutationError(res.error, "renters.error.documentUploadFailed", t), "error");
                          })
                        }
                        className="text-xs font-semibold text-rose-600 cursor-pointer"
                      >
                        {t("renters.document.delete")}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canWriteDocuments ? (
            <div className="space-y-2">
              <input className={inputCls} placeholder={t("renters.document.displayName")} value={docName} onChange={(e) => setDocName(e.target.value)} />
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} className="text-xs" />
              <button type="button" onClick={() => void handleUpload()} disabled={!docFile} className="py-2 px-4 bg-indigo-600 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50">
                {t("renters.document.add")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function CommunicationsTab({
  communications,
  canWrite,
  renterId,
  toast,
  createCommunication,
  t,
  formatDateTime,
}: {
  communications: RenterCommunication[];
  canWrite: boolean;
  renterId: string;
  toast: RenterDetailPanelProps["toast"];
  createCommunication: ReturnType<typeof useCreateRenterCommunication>;
  t: (key: import("../../lib/i18n/keys").I18nKey) => string;
  formatDateTime: (d: Date) => string;
}) {
  const [commType, setCommType] = useState<RenterCommunicationType>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [nextAction, setNextAction] = useState("");

  const commTypes: RenterCommunicationType[] = ["call", "email", "messenger", "meeting", "note"];
  const commTypeLabel: Record<RenterCommunicationType, import("../../lib/i18n/keys").I18nKey> = {
    call: "renters.communication.typeCall",
    email: "renters.communication.typeEmail",
    messenger: "renters.communication.typeMessenger",
    meeting: "renters.communication.typeMeeting",
    note: "renters.communication.typeNote",
  };

  const handleAdd = async () => {
    if (!subject.trim() && !body.trim()) return;
    const res = await createCommunication.mutateAsync({
      renterId,
      commType,
      subject: subject.trim() || undefined,
      body: body.trim() || undefined,
      nextActionAt: nextAction || undefined,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "renters.error.communicationSaveFailed", t), "error");
      return;
    }
    toast(t("renters.success.communicationSaved"), "success");
    setSubject("");
    setBody("");
    setNextAction("");
  };

  return (
    <div className="space-y-4">
      {communications.length === 0 ? (
        <p className="text-sm text-slate-400">{t("renters.detail.noCommunications")}</p>
      ) : (
        <ul className="space-y-3">
          {communications.map((cm) => (
            <li key={cm.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase text-indigo-600">{t(commTypeLabel[cm.commType])}</span>
                <span className="text-xs text-slate-400">{formatDateTime(new Date(cm.occurredAt))}</span>
              </div>
              {cm.subject ? <p className="font-semibold text-slate-800 mt-1">{cm.subject}</p> : null}
              {cm.body ? <p className="text-slate-600 text-xs mt-1 whitespace-pre-wrap">{cm.body}</p> : null}
              {cm.nextActionAt ? (
                <p className="text-xs text-amber-700 mt-1">{t("renters.communication.nextAction")}: {formatDateTime(new Date(cm.nextActionAt))}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <div className="border-t border-slate-100 pt-4 space-y-2">
          <AppSelect label={t("renters.communication.type")} value={commType} onChange={(e) => setCommType(e.target.value as RenterCommunicationType)}>
            {commTypes.map((ct) => (
              <option key={ct} value={ct}>{t(commTypeLabel[ct])}</option>
            ))}
          </AppSelect>
          <input className={inputCls} placeholder={t("renters.communication.subject")} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className={descriptionFieldCls} placeholder={t("renters.communication.body")} value={body} onChange={(e) => setBody(e.target.value)} />
          <input type="datetime-local" className={inputCls} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
          <button type="button" onClick={() => void handleAdd()} className="py-2 px-4 bg-indigo-600 text-white text-xs font-semibold rounded-lg cursor-pointer">
            {t("renters.communication.add")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
