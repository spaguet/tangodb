import { useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import AppSelect from "../components/ui/AppSelect";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { fieldCls as inputCls } from "../components/ui/AppSelect";
import { btnAddCls, btnCancelCls, btnOpenCls } from "../components/ui/buttonStyles";
import {
  useRenterTopupInbox,
  useResolveRenterTopup,
  type RenterTopupInboxFilterStatus,
  type RenterTopupInboxItem,
} from "../hooks/useRenterTopupInbox";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "../App";
import { resolveMutationError } from "../lib/resolveMutationError";
import { formatCurrency } from "../lib/utils";

const PAGE_SIZE = 50;

export default function FinanceRenterTopupPage() {
  const { t, formatDateTime } = useI18n();
  const toast = useToast();
  const { can, isReadOnly } = usePermissions();
  const [status, setStatus] = useState<RenterTopupInboxFilterStatus>("pending");
  const [page, setPage] = useState(0);
  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({});
  const [editAmountId, setEditAmountId] = useState<string | null>(null);
  const [rejectItem, setRejectItem] = useState<RenterTopupInboxItem | null>(null);

  const filter = useMemo(
    () => ({
      status,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [status, page]
  );

  const inboxQuery = useRenterTopupInbox(filter);
  const resolveTopup = useResolveRenterTopup();
  const items = inboxQuery.data?.items ?? [];
  const total = inboxQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canResolve = !isReadOnly && can("rentals.payments.write");

  const methodLabel = (method: string) =>
    method === "qr" ? t("renterTopup.method.qr") : t("renterTopup.method.cash");

  const statusLabel = (value: string) => {
    if (value === "confirmed") return t("renterTopup.status.confirmed");
    if (value === "rejected") return t("renterTopup.status.rejected");
    return t("renterTopup.status.pending");
  };

  const factAmount = (item: RenterTopupInboxItem) => {
    const raw = amountDraft[item.id];
    if (raw == null || raw.trim() === "") return item.amount;
    return Number(raw.replace(",", "."));
  };

  const handleConfirm = async (item: RenterTopupInboxItem) => {
    const fact = factAmount(item);
    if (!Number.isFinite(fact) || fact <= 0) {
      toast(t("renter.topup.amountInvalid"), "error");
      return;
    }
    const res = await resolveTopup.mutateAsync({
      id: item.id,
      action: "confirm",
      amountFact: fact,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "renterTopup.error.resolveFailed", t), "error");
      return;
    }
    toast(
      res.alreadyApplied ? t("renterTopup.success.already") : t("renterTopup.success.confirmed"),
      "success"
    );
    setEditAmountId(null);
  };

  const handleReject = async () => {
    if (!rejectItem) return;
    const res = await resolveTopup.mutateAsync({
      id: rejectItem.id,
      action: "reject",
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "renterTopup.error.resolveFailed", t), "error");
      return;
    }
    toast(
      res.alreadyApplied ? t("renterTopup.success.already") : t("renterTopup.success.rejected"),
      "success"
    );
    setRejectItem(null);
  };

  if (inboxQuery.isLoading) return <LoadingState label={t("renterTopup.loading")} />;
  if (inboxQuery.isError) return <QueryErrorState error={inboxQuery.error} />;

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <Wallet className="w-4 h-4 text-indigo-600 shrink-0" />
            <h2 className="font-sans text-sm font-semibold text-slate-800 truncate">
              {t("renterTopup.title")}
            </h2>
            {status === "pending" && total > 0 ? (
              <span className="inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white">
                {total}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500 font-sans mt-1">{t("renterTopup.hint")}</p>
          <p className="text-xs text-slate-500 font-sans mt-1">{t("renterTopup.receiptHint")}</p>
        </div>

        <div className="px-3 py-3 border-b border-slate-100 max-w-xs">
          <AppSelect
            label={t("renterTopup.filter.status")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as RenterTopupInboxFilterStatus);
              setPage(0);
            }}
          >
            <option value="pending">{t("renterTopup.status.pending")}</option>
            <option value="confirmed">{t("renterTopup.status.confirmed")}</option>
            <option value="rejected">{t("renterTopup.status.rejected")}</option>
            <option value="all">{t("common.all")}</option>
          </AppSelect>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">{t("renterTopup.empty")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.id} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{item.renterName}</p>
                    <p className="text-xs text-slate-500">
                      {methodLabel(item.method)} · {statusLabel(item.status)} ·{" "}
                      {formatDateTime(item.createdAt)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-800">{formatCurrency(item.amount)}</p>
                </div>
                {item.qrSignedUrl ? (
                  <img
                    src={item.qrSignedUrl}
                    alt={t("renterTopup.qrPreview")}
                    className="w-28 h-28 object-contain rounded border border-slate-100"
                  />
                ) : null}
                {item.status === "pending" && canResolve ? (
                  <div className="flex flex-wrap items-end gap-2">
                    {editAmountId === item.id ? (
                      <div className="field-stack">
                        <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                          {t("renterTopup.amountFact")}
                        </label>
                        <input
                          className={inputCls}
                          inputMode="decimal"
                          value={amountDraft[item.id] ?? String(item.amount)}
                          onChange={(e) =>
                            setAmountDraft((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={btnOpenCls}
                        onClick={() => {
                          setEditAmountId(item.id);
                          setAmountDraft((prev) => ({
                            ...prev,
                            [item.id]: prev[item.id] ?? String(item.amount),
                          }));
                        }}
                      >
                        {t("renterTopup.editAmount")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={btnAddCls}
                      disabled={resolveTopup.isPending}
                      onClick={() => {
                        void handleConfirm(item);
                      }}
                    >
                      {t("renterTopup.creditNow", { amount: formatCurrency(factAmount(item)) })}
                    </button>
                    <button
                      type="button"
                      className={btnCancelCls}
                      disabled={resolveTopup.isPending}
                      onClick={() => setRejectItem(item)}
                    >
                      {t("renterTopup.reject")}
                    </button>
                  </div>
                ) : item.amountFact != null ? (
                  <p className="text-xs text-slate-500">
                    {t("renterTopup.amountFact")}: {formatCurrency(item.amountFact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 ? (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <button
              type="button"
              className="text-indigo-600 font-semibold cursor-pointer disabled:text-slate-300"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {t("rentalInbox.pagination.prev")}
            </button>
            <span className="text-slate-500">
              {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="text-indigo-600 font-semibold cursor-pointer disabled:text-slate-300"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("rentalInbox.pagination.next")}
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!rejectItem}
        title={t("renterTopup.reject")}
        description={t("renterTopup.rejectConfirm")}
        confirmLabel={t("renterTopup.reject")}
        pending={resolveTopup.isPending}
        onConfirm={() => {
          void handleReject();
        }}
        onCancel={() => setRejectItem(null)}
      />
    </div>
  );
}
