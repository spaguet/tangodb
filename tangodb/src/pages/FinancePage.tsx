import { Navigate, Route, Routes } from "react-router-dom";
import { usePermissions } from "../hooks/usePermissions";
import FinanceLayout from "./FinanceLayout";
import FinancePaymentsPage from "./FinancePaymentsPage";
import FinanceRevenuePage from "./FinanceRevenuePage";
import FinanceDebtorsPage from "./FinanceDebtorsPage";
import FinanceExpensesPage from "./FinanceExpensesPage";
import FinancePayrollPage from "./FinancePayrollPage";
import FinanceCorrectionsPage from "./FinanceCorrectionsPage";
import FinanceRentalAccrualsPage from "./FinanceRentalAccrualsPage";
import FinanceRentalInboxPage from "./FinanceRentalInboxPage";
import { isRentalInboxOnly } from "../lib/permissions";

function FinanceIndexRedirect() {
  const { can, role, options } = usePermissions();
  if (can("payroll.read.own") && !can("finance.read")) {
    return <Navigate to="payroll" replace />;
  }
  if (isRentalInboxOnly(role, options)) {
    return <Navigate to="rental-inbox" replace />;
  }
  return <Navigate to="payments" replace />;
}

export default function FinancePage() {
  return (
    <Routes>
      <Route element={<FinanceLayout />}>
        <Route index element={<FinanceIndexRedirect />} />
        <Route path="payments" element={<FinancePaymentsPage />} />
        <Route path="revenue" element={<FinanceRevenuePage />} />
        <Route path="debtors" element={<FinanceDebtorsPage />} />
        <Route path="expenses" element={<FinanceExpensesPage />} />
        <Route path="payroll" element={<FinancePayrollPage />} />
        <Route path="corrections" element={<FinanceCorrectionsPage />} />
        <Route path="rental-accruals" element={<FinanceRentalAccrualsPage />} />
        <Route path="rental-inbox" element={<FinanceRentalInboxPage />} />
      </Route>
      <Route path="*" element={<FinanceIndexRedirect />} />
    </Routes>
  );
}
