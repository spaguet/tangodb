import type { I18nKey } from "./i18n/keys";
import type { ExpenseCategory } from "../types/expense";

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "rent",
  "utilities",
  "marketing",
  "other",
];

const CATEGORY_KEYS: Record<ExpenseCategory, I18nKey> = {
  rent: "finance.expenses.category.rent",
  utilities: "finance.expenses.category.utilities",
  marketing: "finance.expenses.category.marketing",
  salary: "finance.expenses.category.salary",
  other: "finance.expenses.category.other",
};

export function expenseCategoryKey(category: ExpenseCategory): I18nKey {
  return CATEGORY_KEYS[category];
}
