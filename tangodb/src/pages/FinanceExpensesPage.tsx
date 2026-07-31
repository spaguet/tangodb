import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Pencil, Plus, Receipt, Trash2, X } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import AppSelect from "../components/ui/AppSelect";
import DatePickerField from "../components/ui/DatePickerField";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { useToast } from "../App";
import {
  useCreateExpense,
  useDeleteExpense,
  useExpenses,
  useUpdateExpense,
} from "../hooks/useExpenses";
import { useFinanceCosts, useVenueCostRuleStatus } from "../hooks/useVenueCosts";
import VenueRuleExpiryNotice from "../components/venue-costs/VenueRuleExpiryNotice";
import { usePermissions } from "../hooks/usePermissions";
import { useI18n } from "../hooks/useI18n";
import { EXPENSE_CATEGORIES, expenseCategoryKey } from "../lib/expenseCategories";
import { resolveMutationError } from "../lib/resolveMutationError";
import { formatCurrency } from "../lib/utils";
import { toISODateLocal } from "../lib/scheduleWeek";
import type { Expense, ExpenseCategory, ExpenseInput } from "../types/expense";

type CategoryFilter = "all" | ExpenseCategory;

const inputCls =
  "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-sans";
const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function emptyForm(): ExpenseInput {
  return {
    amount: 0,
    category: "other",
    description: "",
    expenseDate: toISODateLocal(new Date()),
  };
}

function ExpenseRow({
  expense,
  canWrite,
  onEdit,
  onDelete,
  formatDate,
  categoryLabel,
}: {
  expense: Expense;
  canWrite: boolean;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
  formatDate: ReturnType<typeof useI18n>["formatDate"];
  categoryLabel: (category: ExpenseCategory) => string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-2 sm:gap-3 items-center px-3 py-3 border-b border-slate-100 last:border-b-0 group">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">
          {expense.description || categoryLabel(expense.category)}
        </p>
        <p className="text-[10px] text-slate-400 font-sans mt-0.5">
          {formatDate(expense.expenseDate, { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </div>
      <p className="text-xs text-slate-500 font-sans hidden sm:block truncate">{categoryLabel(expense.category)}</p>
      <p className="text-sm font-sans font-semibold text-rose-700 text-right whitespace-nowrap">
        {formatCurrency(expense.amount)}
      </p>
      {canWrite && (
        <div className="flex items-center justify-end gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onEdit(expense)}
            aria-label="Edit"
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(expense)}
            aria-label="Delete"
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function FinanceExpensesPage() {
  const { t, formatDate, plural } = useI18n();
  const toast = useToast();
  const { can, role } = usePermissions();
  const canWrite = can("expenses.write");
  const canManageVenueRules = role === "owner" || role === "director";

  const todayIso = toISODateLocal(new Date());

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseInput>(emptyForm);

  const expensesFilter = useMemo(
    () => ({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      category: categoryFilter !== "all" ? categoryFilter : undefined,
    }),
    [dateFrom, dateTo, categoryFilter]
  );

  const expensesQuery = useExpenses(expensesFilter);
  const financeCostsQuery = useFinanceCosts(dateFrom, dateTo, Boolean(dateFrom && dateTo));
  const venueStatusQuery = useVenueCostRuleStatus();
  const venueEntries = useMemo(
    () => (financeCostsQuery.data?.entries ?? []).filter((entry) => entry.sourceType === "venue_cost"),
    [financeCostsQuery.data]
  );
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();

  const categoryLabel = (category: ExpenseCategory) => t(expenseCategoryKey(category));

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setForm({
      amount: expense.amount,
      category: expense.category,
      description: expense.description,
      expenseDate: expense.expenseDate,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const handleSubmit = async () => {
    if (form.amount <= 0) {
      toast(t("finance.expenses.error.amount"), "error");
      return;
    }
    if (form.expenseDate > todayIso) {
      toast(t("finance.expenses.error.futureDate"), "error");
      return;
    }

    const res = editing
      ? await updateExpense.mutateAsync({ ...form, id: editing.id })
      : await createExpense.mutateAsync(form);

    if (!res.success) {
      toast(resolveMutationError(res.error, "finance.expenses.error.save", t), "error");
      return;
    }

    toast(t(editing ? "finance.expenses.updateSuccess" : "finance.expenses.createSuccess"), "success");
    closeModal();
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await deleteExpense.mutateAsync(deleteTarget.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "finance.expenses.error.delete", t), "error");
    } else {
      toast(t("finance.expenses.deleteSuccess"), "success");
    }
    setDeleteTarget(null);
  };

  if (expensesQuery.isLoading || financeCostsQuery.isLoading || venueStatusQuery.isLoading) {
    return <LoadingState label={t("finance.expenses.loading")} />;
  }
  if (expensesQuery.isError || financeCostsQuery.isError || venueStatusQuery.isError) {
    return <QueryErrorState error={expensesQuery.error ?? financeCostsQuery.error ?? venueStatusQuery.error} />;
  }

  const items = expensesQuery.data ?? [];
  const venueStatus = venueStatusQuery.data;
  const hasVenueRules = venueStatus?.status !== "not_configured";
  const venueRulesLink = hasVenueRules ? "/settings/venue-costs" : "/settings/venue-costs?new=1";
  const manualTotal = items.reduce((sum, e) => sum + e.amount, 0);
  const venueTotal = financeCostsQuery.data?.venueTotal ?? 0;
  const combinedTotal = financeCostsQuery.data?.total ?? manualTotal + venueTotal;
  const hasActiveFilters = Boolean(dateFrom || dateTo || categoryFilter !== "all");
  const pending = createExpense.isPending || updateExpense.isPending;

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-indigo-500" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("finance.expenses.title")}</h2>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("finance.expenses.add")}
            </button>
          )}
        </div>

        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/40">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <DatePickerField
              label={t("common.dateFrom")}
              value={dateFrom}
              onChange={setDateFrom}
              max={dateTo || todayIso}
              className="min-w-0"
            />
            <DatePickerField
              label={t("common.dateTo")}
              value={dateTo}
              onChange={setDateTo}
              min={dateFrom || undefined}
              max={todayIso}
              className="min-w-0"
            />
            <AppSelect
              label={t("finance.expenses.categoryLabel")}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
            >
              <option value="all">{t("common.all")}</option>
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {categoryLabel(cat)}
                </option>
              ))}
            </AppSelect>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="py-20 text-center">
            <Receipt className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">
              {hasActiveFilters ? t("finance.expenses.emptyFiltered") : t("finance.expenses.empty")}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
              <span>{t("finance.expenses.colDescription")}</span>
              <span>{t("finance.expenses.categoryLabel")}</span>
              <span className="text-right">{t("common.amount")}</span>
              <span />
            </div>
            <div>
              {items.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  canWrite={canWrite}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                  formatDate={formatDate}
                  categoryLabel={categoryLabel}
                />
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-between items-center bg-slate-50/60">
              <span className="text-xs text-slate-500 font-sans">
                {plural(items.length, [
                  t("common.records.one", { count: items.length }),
                  t("common.records.few", { count: items.length }),
                  t("common.records.many", { count: items.length }),
                ])}
              </span>
              <span className="text-sm font-sans font-semibold text-slate-800">
                {t("venueCosts.finance.manualTotal")}: {formatCurrency(manualTotal)}
              </span>
            </div>
          </>
        )}
      </div>

      {venueStatus?.acknowledgementRequired && (
        <VenueRuleExpiryNotice status={venueStatus} compact />
      )}

      <div className="bg-white rounded-xl border border-amber-200/80 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-amber-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-amber-50/40">
          <div>
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("venueCosts.finance.venueTotal")}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("venueCosts.finance.autoRow")}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {canManageVenueRules && (
              <Link
                to={venueRulesLink}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t(hasVenueRules ? "venueCosts.finance.manageRules" : "venueCosts.finance.createRules")}
              </Link>
            )}
            <p className="text-sm font-semibold text-amber-800 whitespace-nowrap">
              {formatCurrency(venueTotal)}
            </p>
          </div>
        </div>
        {venueEntries.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-500">{t("venueCosts.empty")}</p>
            {canManageVenueRules && (
              <Link
                to={venueRulesLink}
                className="inline-flex items-center gap-1.5 mt-4 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t(hasVenueRules ? "venueCosts.finance.manageRules" : "venueCosts.finance.createRules")}
              </Link>
            )}
          </div>
        ) : (
          <div>
            {venueEntries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-3 border-b border-slate-100 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {entry.description || t("venueCosts.finance.autoRow")}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {formatDate(entry.entryDate, { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <p className="text-sm font-semibold text-rose-700 whitespace-nowrap">
                  {formatCurrency(entry.amount)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs px-4 py-3 flex justify-between items-center">
        <span className="text-xs text-slate-500 font-sans">{t("finance.expenses.title")}</span>
        <div className="text-right">
          <p className="text-sm font-sans font-semibold text-slate-800">
            {t("finance.expenses.total", { amount: formatCurrency(combinedTotal) })}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {t("venueCosts.finance.manualTotal")}: {formatCurrency(manualTotal)} ·{" "}
            {t("venueCosts.finance.venueTotal")}: {formatCurrency(venueTotal)}
          </p>
        </div>
      </div>

      <AnimatePresence>
        {modalOpen && canWrite && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full max-h-[90vh] overflow-y-auto p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">
                  {editing ? t("finance.expenses.editTitle") : t("finance.expenses.addTitle")}
                </h3>
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="field-stack font-sans">
                <div className="field-stack">
                  <label className={labelCls}>{t("common.amount")} *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.amount || ""}
                    onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))}
                    className={inputCls}
                  />
                </div>
                <AppSelect
                  label={t("finance.expenses.categoryLabel")}
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ExpenseCategory }))}
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {categoryLabel(cat)}
                    </option>
                  ))}
                </AppSelect>
                <div className="field-stack">
                  <label className={labelCls}>{t("finance.expenses.descriptionLabel")}</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className={inputCls}
                    placeholder={t("finance.expenses.descriptionPlaceholder")}
                  />
                </div>
                <DatePickerField
                  label={t("finance.expenses.dateLabel")}
                  value={form.expenseDate}
                  onChange={(iso) => setForm((f) => ({ ...f, expenseDate: iso }))}
                  max={todayIso}
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={pending}
                  className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-semibold uppercase rounded-lg cursor-pointer disabled:opacity-60"
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-xs font-semibold uppercase rounded-lg cursor-pointer"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteTarget != null}
        title={t("finance.expenses.deleteTitle")}
        description={
          deleteTarget
            ? t("finance.expenses.deleteBody", {
                amount: formatCurrency(deleteTarget.amount),
                date: formatDate(deleteTarget.expenseDate, { day: "numeric", month: "short", year: "numeric" }),
              })
            : ""
        }
        confirmLabel={t("common.delete")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
