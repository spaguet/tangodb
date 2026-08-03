import { useMemo, useState } from "react";
import { Coins, Inbox, Plus } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import AppSelect from "../components/ui/AppSelect";
import CreateRentalDialog from "../components/schedule/CreateRentalDialog";
import RentalInfoPopup from "../components/schedule/RentalInfoPopup";
import RecordRentalPaymentModal from "../components/schedule/RecordRentalPaymentModal";
import { useRentalPaymentInbox, type RentalInboxBucket } from "../hooks/useRentalPaymentInbox";
import { useLocations } from "../hooks/useLocations";
import { useRenters } from "../hooks/useRenters";
import { memberListLabel, useTeamMembers } from "../hooks/useTeamMembers";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { canWriteRentals } from "../lib/permissions";
import { useOrganization } from "../organization/OrganizationProvider";
import { useToast } from "../App";
import { inboxItemToRentalLesson } from "../lib/rentalInbox";
import { orgLocalDateString } from "../lib/orgFinanceDate";
import { formatCurrency } from "../lib/utils";
import type { RentalDisplayLesson, RentalPaymentStatus } from "../types";
import { btnAddCls } from "../components/ui/buttonStyles";

const PAGE_SIZE = 50;

type BucketTab = RentalInboxBucket;

function paymentStatusLabel(status: RentalPaymentStatus, t: ReturnType<typeof useI18n>["t"]): string {
  if (status === "paid") return t("schedule.rental.paymentPaid");
  if (status === "partial") return t("schedule.rental.paymentPartial");
  if (status === "overpaid") return t("schedule.rental.paymentOverpaid");
  return t("schedule.rental.paymentUnpaid");
}

export default function FinanceRentalInboxPage() {
  const { t, formatDate, locale, plural } = useI18n();
  const toast = useToast();
  const { can, role, options } = usePermissions();
  const { isReadOnly, settings } = useOrganization();
  const orgToday = orgLocalDateString(settings?.timezone ?? "UTC");

  const [bucket, setBucket] = useState<BucketTab>("queue");
  const [locationId, setLocationId] = useState("");
  const [renterId, setRenterId] = useState("");
  const [cashierId, setCashierId] = useState("");
  const [statusFilter, setStatusFilter] = useState<RentalPaymentStatus | "">("");
  const [page, setPage] = useState(0);
  const [payLesson, setPayLesson] = useState<RentalDisplayLesson | null>(null);
  const [detailLesson, setDetailLesson] = useState<RentalDisplayLesson | null>(null);
  const [createRentalOpen, setCreateRentalOpen] = useState(false);

  const locationsQuery = useLocations();
  const rentersQuery = useRenters({ activeOnly: true });
  const teamQuery = useTeamMembers();

  const filter = useMemo(
    () => ({
      bucket,
      asOfDate: orgToday,
      locationId: locationId || null,
      renterId: renterId || null,
      cashierId: cashierId || null,
      paymentStatus: statusFilter || null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [bucket, orgToday, locationId, renterId, cashierId, statusFilter, page]
  );

  const inboxQuery = useRentalPaymentInbox(filter);
  const items = inboxQuery.data?.items ?? [];
  const total = inboxQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const canRecordPayment = !isReadOnly && can("rentals.payments.write");
  const canCreateRental = !isReadOnly && canWriteRentals(role, options);

  const locationOptions = useMemo(
    () => (locationsQuery.data ?? []).map((loc) => ({ id: loc.id, name: loc.name })),
    [locationsQuery.data]
  );

  const memberNameById = useMemo(
    () => new Map((teamQuery.data ?? []).map((m) => [m.id, memberListLabel(m, locale)])),
    [teamQuery.data, locale]
  );

  const bucketTabs: { id: BucketTab; label: string }[] = [
    { id: "queue", label: t("rentalInbox.bucket.queue") },
    { id: "today", label: t("rentalInbox.bucket.today") },
    { id: "overdue", label: t("rentalInbox.bucket.overdue") },
    { id: "partial", label: t("rentalInbox.bucket.partial") },
    { id: "overpaid", label: t("rentalInbox.bucket.overpaid") },
  ];

  const queueDebtTotal = useMemo(
    () => items.reduce((sum, row) => sum + row.remainingAmount, 0),
    [items]
  );

  const resetPage = () => setPage(0);

  if (inboxQuery.isLoading) return <LoadingState label={t("rentalInbox.loading")} />;
  if (inboxQuery.isError) return <QueryErrorState error={inboxQuery.error} />;

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-indigo-600" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("rentalInbox.title")}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-sans">
              {t("rentalInbox.asOf", { date: formatDate(orgToday) })}
            </span>
            {canCreateRental ? (
              <button
                type="button"
                onClick={() => setCreateRentalOpen(true)}
                className={btnAddCls}
              >
                <Plus className="w-3.5 h-3.5" />
                {t("rentalInbox.createRental")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-2">
          {bucketTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setBucket(tab.id);
                resetPage();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                bucket === tab.id
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                  : "text-slate-600 hover:bg-slate-50 border border-transparent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="px-3 py-3 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <AppSelect
            label={t("schedule.form.location")}
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              resetPage();
            }}
          >
            <option value="">{t("common.all")}</option>
            {(locationsQuery.data ?? []).map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </AppSelect>

          <AppSelect
            label={t("rentalInbox.filter.renter")}
            value={renterId}
            onChange={(e) => {
              setRenterId(e.target.value);
              resetPage();
            }}
          >
            <option value="">{t("common.all")}</option>
            {(rentersQuery.data ?? []).map((renter) => (
              <option key={renter.id} value={renter.id}>
                {renter.displayName}
              </option>
            ))}
          </AppSelect>

          <AppSelect
            label={t("rentalInbox.filter.cashier")}
            value={cashierId}
            onChange={(e) => {
              setCashierId(e.target.value);
              resetPage();
            }}
          >
            <option value="">{t("common.all")}</option>
            {(teamQuery.data ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {memberListLabel(member, locale)}
              </option>
            ))}
          </AppSelect>

          <AppSelect
            label={t("rentalInbox.filter.status")}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as RentalPaymentStatus | "");
              resetPage();
            }}
          >
            <option value="">{t("common.all")}</option>
            <option value="unpaid">{t("schedule.rental.paymentUnpaid")}</option>
            <option value="partial">{t("schedule.rental.paymentPartial")}</option>
            <option value="overpaid">{t("schedule.rental.paymentOverpaid")}</option>
          </AppSelect>
        </div>

        <p className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
          {t("rentalInbox.hint")}
          {canCreateRental ? null : (
            <span className="block mt-1 text-slate-400">{t("rental.booking.escalateSchedule")}</span>
          )}
        </p>

        {items.length === 0 ? (
          <div className="py-20 text-center">
            <Inbox className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">{t("rentalInbox.empty")}</p>
          </div>
        ) : (
          <>
            <div className="hidden lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_auto_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
              <span>{t("rentalInbox.col.renter")}</span>
              <span>{t("rentalInbox.col.slot")}</span>
              <span>{t("rentalInbox.col.status")}</span>
              <span className="text-right">{t("rentalInbox.col.total")}</span>
              <span className="text-right">{t("rentalInbox.col.remaining")}</span>
              <span className="text-right">{t("clients.table.actions")}</span>
            </div>
            <div>
              {items.map((row) => {
                const statusCls =
                  row.paymentStatus === "overpaid"
                    ? "text-amber-700"
                    : row.isOverdue
                      ? "text-rose-700"
                      : row.paymentStatus === "partial"
                        ? "text-amber-700"
                        : "text-slate-600";

                return (
                  <div
                    key={row.rentalId}
                    className="grid grid-cols-[1fr_auto] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_auto_auto_auto] gap-2 lg:gap-3 items-center px-3 py-3 border-b border-slate-100 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{row.renterName}</p>
                      {row.locationName ? (
                        <p className="text-[10px] text-slate-500 mt-0.5">{row.locationName}</p>
                      ) : null}
                      {row.lastPaymentBy ? (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {t("rentalInbox.lastCashier", {
                            name: memberNameById.get(row.lastPaymentBy) ?? "—",
                          })}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-600 font-sans hidden lg:block">
                      {formatDate(row.rentalDate)} · {row.timeStart}–{row.timeEnd}
                    </p>
                    <p className={`text-xs font-semibold hidden lg:block ${statusCls}`}>
                      {paymentStatusLabel(row.paymentStatus, t)}
                      {row.isOverdue ? ` · ${t("rentalInbox.overdueBadge")}` : ""}
                    </p>
                    <p className="text-sm font-sans text-right whitespace-nowrap text-slate-700 hidden lg:block">
                      {formatCurrency(row.effectiveAmount)}
                    </p>
                    <p className="text-sm font-sans font-semibold text-right whitespace-nowrap text-rose-700">
                      {row.remainingAmount > 0 ? formatCurrency(row.remainingAmount) : "—"}
                    </p>
                    <div className="text-right col-span-2 lg:col-span-1 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailLesson(inboxItemToRentalLesson(row))}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50"
                      >
                        {t("common.details")}
                      </button>
                      {canRecordPayment && row.paymentStatus !== "paid" ? (
                        <button
                          type="button"
                          onClick={() => setPayLesson(inboxItemToRentalLesson(row))}
                          className={btnAddCls}
                        >
                          <Coins className="w-3.5 h-3.5" />
                          {t("common.pay")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/60">
              <span className="text-xs text-slate-500 font-sans">
                {plural(total, [
                  t("common.records.one", { count: total }),
                  t("common.records.few", { count: total }),
                  t("common.records.many", { count: total }),
                ])}
                {bucket === "queue" && queueDebtTotal > 0
                  ? ` · ${t("rentalInbox.pageDebt", { amount: formatCurrency(queueDebtTotal) })}`
                  : ""}
              </span>
              {totalPages > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"
                  >
                    {t("rentalInbox.pagination.prev")}
                  </button>
                  <span className="text-xs text-slate-600">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"
                  >
                    {t("rentalInbox.pagination.next")}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      <CreateRentalDialog
        open={createRentalOpen}
        locations={locationOptions}
        toast={toast}
        onClose={() => setCreateRentalOpen(false)}
        onSuccess={() => {
          setCreateRentalOpen(false);
          void inboxQuery.refetch();
        }}
      />

      <RentalInfoPopup
        lesson={detailLesson}
        locations={locationOptions}
        toast={toast}
        onClose={() => setDetailLesson(null)}
        onSuccess={() => void inboxQuery.refetch()}
      />

      <RecordRentalPaymentModal
        lesson={payLesson}
        open={!!payLesson}
        toast={toast}
        onClose={() => setPayLesson(null)}
        onSuccess={() => {
          setPayLesson(null);
          void inboxQuery.refetch();
        }}
      />
    </div>
  );
}
