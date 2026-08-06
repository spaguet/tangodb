import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { monthDateRange } from "../lib/financeReports";
import { supabase } from "../lib/supabase";
import type { Expense, ExpenseCategory, ExpenseInput } from "../types/expense";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { financeCostsQueryKey } from "./useVenueCosts";

export const expensesQueryKey = ["expenses"] as const;

const EXPENSES_SELECT =
  "id, amount, category, description, expense_date, payee, document_number, created_by, created_at, updated_at";

const mapExpense = (row: Record<string, unknown>): Expense => ({
  id: row.id as string,
  amount: Number(row.amount) || 0,
  category: row.category as ExpenseCategory,
  description: (row.description as string) || "",
  expenseDate: String(row.expense_date ?? ""),
  payee: (row.payee as string) || "",
  documentNumber: (row.document_number as string) || "",
  createdBy: row.created_by != null ? (row.created_by as string) : null,
  createdAt: String(row.created_at ?? ""),
  updatedAt: String(row.updated_at ?? ""),
});

export interface ExpensesFilter {
  dateFrom?: string;
  dateTo?: string;
  category?: ExpenseCategory;
  enabled?: boolean;
}

function buildExpensesQuery(filter?: ExpensesFilter) {
  let query = supabase.from("expenses").select(EXPENSES_SELECT).order("expense_date", { ascending: false });

  if (filter?.dateFrom) query = query.gte("expense_date", filter.dateFrom);
  if (filter?.dateTo) query = query.lte("expense_date", filter.dateTo);
  if (filter?.category) query = query.eq("category", filter.category);

  return query;
}

export function useExpenses(filter?: ExpensesFilter) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (filter?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...expensesQueryKey, filter ?? {}]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await buildExpensesQuery(filter);
      if (error) throw error;
      return (data ?? []).map((row) => mapExpense(row as unknown as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

/** Expenses for a calendar month (YYYY-MM). */
export function useExpensesForMonth(yearMonth: string) {
  const range = monthDateRange(yearMonth);
  return useExpenses({ dateFrom: range.dateFrom, dateTo: range.dateTo });
}

export function sumExpenses(items: Expense[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();
  const { memberId } = useOrganization();

  return useMutation({
    mutationFn: async (input: ExpenseInput) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const { error } = await supabase.from("expenses").insert({
        organization_id: organizationId,
        amount: input.amount,
        category: input.category,
        description: input.description.trim() || null,
        expense_date: input.expenseDate,
        payee: input.payee?.trim() || null,
        document_number: input.documentNumber?.trim() || null,
        created_by: memberId ?? null,
      });

      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: expensesQueryKey });
        void queryClient.invalidateQueries({ queryKey: financeCostsQueryKey });
      }
    },
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ExpenseInput & { id: string }) => {
      const { error } = await supabase
        .from("expenses")
        .update({
          amount: input.amount,
          category: input.category,
          description: input.description.trim() || null,
          expense_date: input.expenseDate,
          payee: input.payee?.trim() || null,
          document_number: input.documentNumber?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.id);

      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: expensesQueryKey });
        void queryClient.invalidateQueries({ queryKey: financeCostsQueryKey });
      }
    },
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: expensesQueryKey });
        void queryClient.invalidateQueries({ queryKey: financeCostsQueryKey });
      }
    },
  });
}
