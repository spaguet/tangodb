export type ExpenseCategory = "rent" | "utilities" | "marketing" | "salary" | "other";

export interface Expense {
  id: string;
  amount: number;
  category: ExpenseCategory;
  description: string;
  expenseDate: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseInput {
  amount: number;
  category: ExpenseCategory;
  description: string;
  expenseDate: string;
}
