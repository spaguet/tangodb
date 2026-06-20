import { Navigate, Route, Routes } from "react-router-dom";
import FinanceLayout from "./FinanceLayout";
import FinancePaymentsPage from "./FinancePaymentsPage";
import FinanceRevenuePage from "./FinanceRevenuePage";
import FinanceDebtorsPage from "./FinanceDebtorsPage";
import FinancePayrollPage from "./FinancePayrollPage";

export default function FinancePage() {
  return (
    <Routes>
      <Route element={<FinanceLayout />}>
        <Route index element={<Navigate to="payments" replace />} />
        <Route path="payments" element={<FinancePaymentsPage />} />
        <Route path="revenue" element={<FinanceRevenuePage />} />
        <Route path="debtors" element={<FinanceDebtorsPage />} />
        <Route path="payroll" element={<FinancePayrollPage />} />
      </Route>
      <Route path="*" element={<Navigate to="payments" replace />} />
    </Routes>
  );
}
