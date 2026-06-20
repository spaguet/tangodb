import { Navigate, Route, Routes } from "react-router-dom";
import FinancePaymentsPage from "./FinancePaymentsPage";

export default function FinancePage() {
  return (
    <Routes>
      <Route index element={<Navigate to="payments" replace />} />
      <Route path="payments" element={<FinancePaymentsPage />} />
      <Route path="*" element={<Navigate to="payments" replace />} />
    </Routes>
  );
}
