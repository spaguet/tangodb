import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { useClientDirectory } from "../hooks/useClients";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { buildDebtorsList, sumDebtorAmounts } from "../lib/financeReports";
import { formatCurrency } from "../lib/utils";
import { useOrganization } from "../organization/OrganizationProvider";

export default function FinanceDebtorsPage() {
  const { settings } = useOrganization();
  const lowBalanceThreshold = settings?.low_balance_threshold ?? 2;

  const clientsQuery = useClientDirectory();
  const subscriptionsQuery = useSubscriptions();
  const personalLessonsQuery = usePersonalLessons();

  const isLoading =
    clientsQuery.isLoading || subscriptionsQuery.isLoading || personalLessonsQuery.isLoading;
  const isError = clientsQuery.isError || subscriptionsQuery.isError || personalLessonsQuery.isError;
  const error = clientsQuery.error ?? subscriptionsQuery.error ?? personalLessonsQuery.error;

  const debtors = useMemo(
    () =>
      buildDebtorsList(
        subscriptionsQuery.data ?? [],
        personalLessonsQuery.data ?? [],
        clientsQuery.data ?? [],
        lowBalanceThreshold
      ),
    [subscriptionsQuery.data, personalLessonsQuery.data, clientsQuery.data, lowBalanceThreshold]
  );

  const totalDebt = useMemo(() => sumDebtorAmounts(debtors), [debtors]);

  if (isLoading) return <LoadingState label="Загрузка дебиторов..." />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">Дебиторская задолженность</h2>
          </div>
          <span className="text-sm font-sans font-semibold text-rose-700">
            К оплате: {formatCurrency(totalDebt)}
          </span>
        </div>

        {debtors.length === 0 ? (
          <div className="py-20 text-center">
            <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Должников нет</p>
          </div>
        ) : (
          <>
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
              <span>Клиент</span>
              <span>Telegram</span>
              <span>Детали</span>
              <span className="text-right">Сумма</span>
            </div>
            <div>
              {debtors.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:gap-3 items-center px-3 py-3 border-b border-slate-100 last:border-b-0"
                >
                  <p className="text-sm font-semibold text-slate-800 truncate">{entry.clientDisplay}</p>
                  <p className="text-xs text-slate-500 font-sans hidden sm:block">{entry.contact}</p>
                  <p className="text-xs text-slate-500 font-sans hidden sm:block">{entry.detail}</p>
                  <p className="text-sm font-sans font-semibold text-right whitespace-nowrap text-rose-700">
                    {entry.amount > 0 ? formatCurrency(entry.amount) : "—"}
                  </p>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-between items-center bg-slate-50/60">
              <span className="text-xs text-slate-500 font-sans">{debtors.length} записей</span>
              <span className="text-xs text-slate-500 font-sans">
                Абонементы с низким балансом (≤ {lowBalanceThreshold}) и неоплаченные персональные
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
