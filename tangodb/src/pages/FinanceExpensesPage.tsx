import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Pencil, Plus, Receipt, Trash2, X } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import AppSelect from "../components/ui/AppSelect";
import { btnAddCls, btnCancelCls } from "../components/ui/buttonStyles";
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
import FinanceMonthExportButton from "../components/finance/FinanceMonthExportButton";
import { useFinancePeriodGate } from "../hooks/useFinancePeriodGate";
import { usePermissions } from "../hooks/usePermissions";
import { useI18n } from "../hooks/useI18n";
import { isFinancePeriodClosed } from "../lib/orgFinanceDate";
import { EXPENSE_CATEGORIES, expenseCategoryKey } from "../lib/expenseCategories";
import { canManageVenueCostRules } from "../lib/permissions";
import { resolveMutationError } from "../lib/resolveMutationError";
import { currentYearMonth, formatCurrency } from "../lib/utils";
import { monthDateRange } from "../lib/financeReports";
import { toISODateLocal } from "../lib/scheduleWeek";
import type { Expense, ExpenseCategory, ExpenseInput } from "../types/expense";
import type { FinanceCostEntry } from "../hooks/useVenueCosts";
import { formatFinanceCostEntryTitle } from "../lib/financeCostEntryLabel";

type CategoryFilter = "all" | ExpenseCategory;

function isExpenseCategory(value: string): value is ExpenseCategory {
  return value === "rent" || value === "utilities" || value === "marketing" || value === "salary" || value === "other";
}

function FinanceCostEntryRow({
  entry,
  fallbackTitle,
  formatDate,
  categoryLabel,
  title,
}: {
  entry: FinanceCostEntry;
  fallbackTitle: string;
  formatDate: ReturnType<typeof useI18n>["formatDate"];
  categoryLabel: (category: ExpenseCategory) => string;
  title: string;
}) {
  const categorySuffix = isExpenseCategory(entry.category) ? ` · ${categoryLabel(entry.category)}` : null;

  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-3 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">
          {title || entry.description || fallbackTitle}
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">
          {formatDate(entry.entryDate, { day: "numeric", month: "short", year: "numeric" })}
          {categorySuffix}
          {entry.payee ? ` · ${entry.payee}` : null}
        </p>
      </div>
      <p className="text-sm font-semibold text-rose-700 whitespace-nowrap">
        {formatCurrency(entry.amount)}
      </p>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-sans";
const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function emptyForm(): ExpenseInput {
  return {
    amount: 0,
    category: "other",
    description: "",
    expenseDate: toISODateLocal(new Date()),
    payee: "",
    documentNumber: "",
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
    <div className="grid grid-cols-[1fr_auto] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-2 lg:gap-3 items-center px-3 py-3 border-b border-slate-100 last:border-b-0 group">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">
          {expense.description || categoryLabel(expense.category)}
        </p>
        <p className="text-[10px] text-slate-400 font-sans mt-0.5">
          {formatDate(expense.expenseDate, { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </div>
      <p className="text-xs text-slate-500 font-sans hidden lg:block truncate min-w-0">{categoryLabel(expense.category)}</p>
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
  const canManageVenueRules = canManageVenueCostRules(role);
  const { closedUntil, minOperationDate } = useFinancePeriodGate();

  const todayIso = toISODateLocal(new Date());
  const defaultMonthRange = useMemo(() => monthDateRange(currentYearMonth()), []);

  const [dateFrom, setDateFrom] = useState(defaultMonthRange.dateFrom);
  const [dateTo, setDateTo] = useState(defaultMonthRange.dateTo);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseInput>(emptyForm);
  const [venueExpanded, setVenueExpanded] = useState(false);
  const [teacherExpenseExpanded, setTeacherExpenseExpanded] = useState(false);
  const formPeriod = useFinancePeriodGate(form.expenseDate);

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
  const venueEntries = useMemo(() => {
    const all = (financeCostsQuery.data?.entries ?? []).filter(
      (entry) => entry.sourceType === "venue_cost"
    );
    if (categoryFilter === "all") return all;
    return all.filter((entry) => entry.category === categoryFilter);
  }, [financeCostsQuery.data, categoryFilter]);
  const teacherExpenseEntries = useMemo(() => {
    const all = (financeCostsQuery.data?.entries ?? []).filter(
      (entry) => entry.sourceType === "teacher_expense"
    );
    if (categoryFilter === "all") return all;
    return all.filter((entry) => entry.category === categoryFilter);
  }, [financeCostsQuery.data, categoryFilter]);
  const sortCostEntries = (entries: FinanceCostEntry[]) =>
    [...entries].sort(
      (a, b) =>
        b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt)
    );
  const sortedVenueEntries = useMemo(() => sortCostEntries(venueEntries), [venueEntries]);
  const sortedTeacherExpenseEntries = useMemo(
    () => sortCostEntries(teacherExpenseEntries),
    [teacherExpenseEntries]
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
      payee: expense.payee,
      documentNumber: expense.documentNumber,
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
    if (formPeriod.isClosed) {
      toast(t("finance.error.periodClosed"), "error");
      return;
    }
    if (editing && isFinancePeriodClosed(editing.expenseDate, closedUntil)) {
      toast(t("finance.error.periodClosed"), "error");
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
    if (isFinancePeriodClosed(deleteTarget.expenseDate, closedUntil)) {
      toast(t("finance.error.periodClosed"), "error");
      setDeleteTarget(null);
      return;
    }
    const res = await deleteExpense.mutateAsync({
      id: deleteTarget.id,
      expenseDate: deleteTarget.expenseDate,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "finance.expenses.error.delete", t), "error");
    } else {
      toast(t("finance.expenses.deleteSuccess"), "success");
    }
    setDeleteTarget(null);
  };

  if (expensesQuery.isLoading || (financeCostsQuery.isLoading && Boolean(dateFrom && dateTo)) || venueStatusQuery.isLoading) {
    return <LoadingState label={t("finance.expenses.loading")} />;
  }
  if (expensesQuery.isError || venueStatusQuery.isError) {
    return <QueryErrorState error={expensesQuery.error ?? venueStatusQuery.error} />;
  }

  const financeCostsUnavailable = financeCostsQuery.isError;

  const items = expensesQuery.data ?? [];
  const venueStatus = venueStatusQuery.data;
  const hasVenueRules = venueStatus?.status !== "not_configured";
  const venueRulesLink = hasVenueRules ? "/settings/hall-rent" : "/settings/hall-rent?new=1";
  const manualTotal = items.reduce((sum, e) => sum + e.amount, 0);
  const venueTotal = financeCostsUnavailable
    ? 0
    : (financeCostsQuery.data?.venueTotal ?? venueEntries.reduce((sum, e) => sum + e.amount, 0));
  const teacherExpenseTotal = financeCostsUnavailable
    ? 0
    : (financeCostsQuery.data?.teacherExpenseTotal ??
      teacherExpenseEntries.reduce((sum, e) => sum + e.amount, 0));
  const combinedTotal =
    categoryFilter === "all"
      ? financeCostsUnavailable
        ? manualTotal
        : (financeCostsQuery.data?.total ?? manualTotal + venueTotal + teacherExpenseTotal)
      : manualTotal + venueTotal + teacherExpenseTotal;
  const hasActiveFilters = Boolean(
    dateFrom !== defaultMonthRange.dateFrom ||
      dateTo !== defaultMonthRange.dateTo ||
      categoryFilter !== "all"
  );
  const pending = createExpense.isPending || updateExpense.isPending;

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Receipt className="w-4 h-4 text-indigo-500" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("finance.expenses.title")}</h2>
          </div>
          <div className="flex items-center gap-2">
            <FinanceMonthExportButton yearMonth={dateFrom.slice(0, 7)} />
          {canWrite && (
            <button
              type="button"
              onClick={openCreate}
              className={btnAddCls}
            >
              <Plus className="w-4 h-4" />
              {t("finance.expenses.add")}
            </button>
          )}
          </div>
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
          <div className="py-8 text-center">
            <Receipt className="w-6 h-6 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">
              {hasActiveFilters ? t("finance.expenses.emptyFiltered") : t("finance.expenses.empty")}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
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
                  canWrite={
                    canWrite && !isFinancePeriodClosed(expense.expenseDate, closedUntil)
                  }
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

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/40">
          <button
            type="button"
            onClick={() => setVenueExpanded((open) => !open)}
            aria-expanded={venueExpanded}
            className="flex items-start gap-2 min-w-0 text-left cursor-pointer hover:opacity-80 transition-opacity"
          >
            <ChevronDown
              className={`w-4 h-4 text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${
                venueExpanded ? "rotate-180" : ""
              }`}
            />
            <div className="min-w-0">
              <h2 className="font-sans text-sm font-semibold text-slate-800">
                {t("venueCosts.finance.venueTotal")}
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {t("venueCosts.finance.autoRow")}
                {sortedVenueEntries.length > 0 ? (
                  <>
                    {" · "}
                    {plural(sortedVenueEntries.length, [
                      t("common.records.one", { count: sortedVenueEntries.length }),
                      t("common.records.few", { count: sortedVenueEntries.length }),
                      t("common.records.many", { count: sortedVenueEntries.length }),
                    ])}
                  </>
                ) : null}
              </p>
            </div>
          </button>
          <div className="flex items-center gap-3 shrink-0 sm:pl-6">
            {canManageVenueRules && (
              <Link to={venueRulesLink} className={btnAddCls}>
                <Plus className="w-4 h-4" />
                {t(hasVenueRules ? "venueCosts.finance.manageRules" : "venueCosts.finance.createRules")}
              </Link>
            )}
            <p className="text-sm font-semibold text-slate-800 whitespace-nowrap">
              {financeCostsUnavailable ? "—" : formatCurrency(venueTotal)}
            </p>
          </div>
        </div>
        {venueExpanded ? (
          sortedVenueEntries.length === 0 ? (
            <div className="px-4 py-6 text-center border-t border-slate-100">
              <p className="text-sm text-slate-500">{t("venueCosts.empty")}</p>
            </div>
          ) : (
            <div className="border-t border-slate-100">
              {sortedVenueEntries.map((entry) => (
                <FinanceCostEntryRow
                  key={entry.id}
                  entry={entry}
                  fallbackTitle={t("venueCosts.finance.autoRow")}
                  title={formatFinanceCostEntryTitle(entry, t)}
                  formatDate={formatDate}
                  categoryLabel={categoryLabel}
                />
              ))}
            </div>
          )
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/40">
          <button
            type="button"
            onClick={() => setTeacherExpenseExpanded((open) => !open)}
            aria-expanded={teacherExpenseExpanded}
            className="flex items-start gap-2 min-w-0 text-left cursor-pointer hover:opacity-80 transition-opacity"
          >
            <ChevronDown
              className={`w-4 h-4 text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${
                teacherExpenseExpanded ? "rotate-180" : ""
              }`}
            />
            <div className="min-w-0">
              <h2 className="font-sans text-sm font-semibold text-slate-800">
                {t("venueCosts.finance.teacherExpenseTotal")}
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {t("teacherPayRules.externalRentHint")}
                {!financeCostsUnavailable && sortedTeacherExpenseEntries.length > 0 ? (
                  <>
                    {" · "}
                    {plural(sortedTeacherExpenseEntries.length, [
                      t("common.records.one", { count: sortedTeacherExpenseEntries.length }),
                      t("common.records.few", { count: sortedTeacherExpenseEntries.length }),
                      t("common.records.many", { count: sortedTeacherExpenseEntries.length }),
                    ])}
                  </>
                ) : null}
              </p>
            </div>
          </button>
          <p className="text-sm font-semibold text-slate-800 whitespace-nowrap sm:pl-6">
            {financeCostsUnavailable ? "—" : formatCurrency(teacherExpenseTotal)}
          </p>
        </div>
        {teacherExpenseExpanded ? (
          financeCostsUnavailable ? (
            <div className="px-4 py-6 text-center border-t border-slate-100">
              <p className="text-sm text-slate-500">{t("venueCosts.finance.teacherExpenseEmpty")}</p>
            </div>
          ) : sortedTeacherExpenseEntries.length === 0 ? (
            <div className="px-4 py-6 text-center border-t border-slate-100">
              <p className="text-sm text-slate-500">{t("venueCosts.finance.teacherExpenseEmpty")}</p>
            </div>
          ) : (
            <div className="border-t border-slate-100">
              {sortedTeacherExpenseEntries.map((entry) => (
                <FinanceCostEntryRow
                  key={entry.id}
                  entry={entry}
                  fallbackTitle={t("venueCosts.finance.teacherExpenseRow")}
                  title={formatFinanceCostEntryTitle(entry, t)}
                  formatDate={formatDate}
                  categoryLabel={categoryLabel}
                />
              ))}
            </div>
          )
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs px-4 py-3 space-y-0.5">
        <p className="text-xs text-slate-500 font-sans font-semibold">{t("finance.expenses.title")}</p>
        <p className="text-[10px] text-slate-500 font-sans">
          {t("venueCosts.finance.manualTotal")}: {formatCurrency(manualTotal)}
        </p>
        <p className="text-[10px] text-slate-500 font-sans">
          {t("venueCosts.finance.venueTotal")}:{" "}
          {financeCostsUnavailable ? "—" : formatCurrency(venueTotal)}
        </p>
        <p className="text-sm font-sans font-semibold text-slate-800 pt-0.5">
          {t("finance.expenses.total", { amount: formatCurrency(combinedTotal) })}
        </p>
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
                <div className="field-stack">
                  <label className={labelCls}>{t("finance.expenses.payeeLabel")}</label>
                  <input
                    type="text"
                    value={form.payee ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
                    className={inputCls}
                    placeholder={t("finance.expenses.payeePlaceholder")}
                  />
                </div>
                <div className="field-stack">
                  <label className={labelCls}>{t("finance.expenses.documentNumberLabel")}</label>
                  <input
                    type="text"
                    value={form.documentNumber ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, documentNumber: e.target.value }))}
                    className={inputCls}
                    placeholder={t("finance.expenses.documentNumberPlaceholder")}
                  />
                </div>
                <DatePickerField
                  label={t("finance.expenses.dateLabel")}
                  value={form.expenseDate}
                  onChange={(iso) => setForm((f) => ({ ...f, expenseDate: iso }))}
                  min={minOperationDate}
                  max={todayIso}
                  required
                />
                {formPeriod.isClosed ? (
                  <p className="text-xs text-rose-600">{t("finance.error.periodClosed")}</p>
                ) : null}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={pending || formPeriod.isClosed}
                  className={`flex-1 ${btnAddCls}`}
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className={`flex-1 ${btnCancelCls}`}
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
