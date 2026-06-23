import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Ticket, X } from "lucide-react";
import { useAddSubscription } from "../../hooks/useSubscriptions";
import {
  deriveSubscriptionTypeFromTariff,
  formatClientName,
  formatCurrency,
  getPriceLabel,
  getPrivatePackageTariffs,
  filterPrivatePackageTariffsForSale,
  tariffNeedsSecondClient,
  tariffNeedsThirdClient,
} from "../../lib/utils";
import {
  DEFAULT_ORG_MODULES,
  filterPrivatePackageTariffsByModules,
} from "../../lib/orgModules";
import { useSettings } from "../../settings/SettingsProvider";
import type { ToastType } from "../../App";
import type { Client, Discipline, Price } from "../../types";
import AppSelect from "./AppSelect";
import ClientAutocomplete from "./ClientAutocomplete";
import DatePickerField from "./DatePickerField";
import DisciplineSelect from "./DisciplineSelect";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

interface SellPackageModalProps {
  open: boolean;
  onClose: () => void;
  toast: (msg: string, type?: ToastType) => void;
  clients: Client[];
  disciplines: Discipline[];
  prices: Price[];
  /** When opened from another modal (e.g. payment), render above z-[60] overlays. */
  stackLayer?: "default" | "above";
}

export default function SellPackageModal({
  open,
  onClose,
  toast,
  clients,
  disciplines,
  prices,
  stackLayer = "default",
}: SellPackageModalProps) {
  const navigate = useNavigate();
  const addSubscription = useAddSubscription();
  const { settings } = useSettings();

  const [selectedPackageTariffId, setSelectedPackageTariffId] = useState<string | "">("");
  const [subClient1Query, setSubClient1Query] = useState("");
  const [subClient1Id, setSubClient1Id] = useState("");
  const [subClient2Query, setSubClient2Query] = useState("");
  const [subClient2Id, setSubClient2Id] = useState("");
  const [subClient3Query, setSubClient3Query] = useState("");
  const [subClient3Id, setSubClient3Id] = useState("");
  const [subDisciplineId, setSubDisciplineId] = useState<string | "">("");
  const [subActivationDate, setSubActivationDate] = useState("");

  const allPackageTariffs = filterPrivatePackageTariffsByModules(
    getPrivatePackageTariffs(prices),
    settings?.modules ?? DEFAULT_ORG_MODULES
  );
  const packageTariffs = useMemo(
    () =>
      filterPrivatePackageTariffsForSale(allPackageTariffs, {
        disciplineId: subDisciplineId || null,
      }),
    [allPackageTariffs, subDisciplineId]
  );

  const selectedPackageTariff = packageTariffs.find((p) => p.id === selectedPackageTariffId);
  const packageNeedsSecond = selectedPackageTariff ? tariffNeedsSecondClient(selectedPackageTariff) : false;
  const packageNeedsThird = selectedPackageTariff ? tariffNeedsThirdClient(selectedPackageTariff) : false;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setSubClient1Query("");
      setSubClient1Id("");
      setSubClient2Query("");
      setSubClient2Id("");
      setSubClient3Query("");
      setSubClient3Id("");
      return;
    }

    if (packageTariffs.length > 0 && selectedPackageTariffId === "") {
      setSelectedPackageTariffId(packageTariffs[0].id!);
    }
    if (disciplines.length > 0 && subDisciplineId === "") {
      setSubDisciplineId(disciplines[0].id);
    }
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setSubActivationDate(`${today.getFullYear()}-${mm}-${dd}`);
  }, [open, packageTariffs, disciplines, selectedPackageTariffId, subDisciplineId]);

  useEffect(() => {
    if (selectedPackageTariffId && !packageTariffs.some((p) => p.id === selectedPackageTariffId)) {
      setSelectedPackageTariffId("");
    }
  }, [packageTariffs, selectedPackageTariffId]);

  const handleSell = async () => {
    if (!selectedPackageTariff?.id) {
      toast("Выберите тариф абонемента.", "error");
      return;
    }
    if (!subClient1Query || !subClient1Id) {
      toast("Выберите клиента из списка.", "error");
      return;
    }
    if (packageNeedsSecond && (!subClient2Query || !subClient2Id)) {
      toast("Выберите второго клиента.", "error");
      return;
    }
    if (packageNeedsThird && (!subClient3Query || !subClient3Id)) {
      toast("Выберите третьего клиента.", "error");
      return;
    }
    if (!subDisciplineId) {
      toast("Выберите дисциплину.", "error");
      return;
    }
    if (!subActivationDate) {
      toast("Укажите дату активации.", "error");
      return;
    }

    const { type, pairMonth } = deriveSubscriptionTypeFromTariff(selectedPackageTariff);
    const res = await addSubscription.mutateAsync({
      type,
      clientId1: subClient1Id,
      clientId2: packageNeedsSecond ? subClient2Id : "",
      clientId3: packageNeedsThird ? subClient3Id : "",
      lessonsTotal: selectedPackageTariff.lessons,
      activationDate: subActivationDate,
      pairMonth,
      disciplineId: subDisciplineId,
      priceId: selectedPackageTariff.id,
      category: "private",
    });

    if (!res.success) {
      toast(res.error || "Не удалось оформить абонемент", "error");
    } else {
      toast("Персональный абонемент продан", "success");
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className={`fixed inset-0 ${stackLayer === "above" ? "z-[70]" : "z-50"} flex items-center justify-center p-4`}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-xl modal-wide-md"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 p-4 border-b border-slate-100 bg-white md:items-center">
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-indigo-50 shrink-0">
                  <Ticket className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold tracking-tight text-slate-900">Продажа пакета</h2>
                  <p className="text-slate-400 text-[11px] leading-snug mt-0.5">
                    Посещения отмечаются в журнале при бронировании уроков с пакета.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 panel-form-stack panel-form-stack-wide-md">
              <div className="field-stack">
                <label className={labelCls}>Тариф абонемента</label>
                {packageTariffs.length === 0 ? (
                  <p className="text-xs text-slate-400 font-sans leading-relaxed">
                    Нет пакетных тарифов.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate("/prices?create=privatePackage");
                      }}
                      className="text-indigo-600 hover:text-indigo-700 font-semibold underline-offset-2 hover:underline cursor-pointer"
                    >
                      Создать в прайс-листе
                    </button>
                  </p>
                ) : (
                  <AppSelect
                    value={selectedPackageTariffId}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) setSelectedPackageTariffId(id);
                    }}
                  >
                    {packageTariffs.map((tariff) => (
                      <option key={tariff.id} value={tariff.id!}>
                        {getPriceLabel(tariff)} — {tariff.lessons} занятий · {formatCurrency(tariff.price)}
                      </option>
                    ))}
                  </AppSelect>
                )}
              </div>

              <DisciplineSelect
                disciplines={disciplines}
                value={subDisciplineId}
                onChange={setSubDisciplineId}
                toast={toast}
              />

              <div className="panel-form-full-row-md">
              <ClientAutocomplete
                label={packageNeedsSecond ? "Первый клиент" : "Клиент"}
                clients={clients}
                query={subClient1Query}
                selectedId={subClient1Id}
                showAddClientButton
                addClientLinkLabel="Новый клиент"
                toast={toast}
                onQueryChange={(q) => {
                  setSubClient1Query(q);
                  setSubClient1Id("");
                }}
                onSelect={(c) => {
                  setSubClient1Id(c.id);
                  setSubClient1Query(formatClientName(c.lastName, c.firstName));
                }}
              />
              </div>

              {packageNeedsSecond && (
                <div className="panel-form-full-row-md">
                <ClientAutocomplete
                  label="Второй клиент"
                  clients={clients}
                  query={subClient2Query}
                  selectedId={subClient2Id}
                  showAddClientButton
                  addClientLinkLabel="Новый клиент"
                  toast={toast}
                  onQueryChange={(q) => {
                    setSubClient2Query(q);
                    setSubClient2Id("");
                  }}
                  onSelect={(c) => {
                    setSubClient2Id(c.id);
                    setSubClient2Query(formatClientName(c.lastName, c.firstName));
                  }}
                />
                </div>
              )}

              {packageNeedsThird && (
                <div className="panel-form-full-row-md">
                <ClientAutocomplete
                  label="Третий клиент"
                  clients={clients}
                  query={subClient3Query}
                  selectedId={subClient3Id}
                  showAddClientButton
                  addClientLinkLabel="Новый клиент"
                  toast={toast}
                  onQueryChange={(q) => {
                    setSubClient3Query(q);
                    setSubClient3Id("");
                  }}
                  onSelect={(c) => {
                    setSubClient3Id(c.id);
                    setSubClient3Query(formatClientName(c.lastName, c.firstName));
                  }}
                />
                </div>
              )}

              <DatePickerField
                label="Дата активации"
                value={subActivationDate}
                onChange={setSubActivationDate}
                required
                className="panel-form-full-row-md"
              />

              <div className="flex items-center justify-between p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 panel-form-full-row-md">
                <span className="text-slate-600 font-semibold text-sm">Итого к оплате</span>
                <span className="text-xl font-sans font-semibold text-indigo-700">
                  {selectedPackageTariff ? formatCurrency(selectedPackageTariff.price) : "—"}
                </span>
              </div>

              <button
                type="button"
                onClick={handleSell}
                disabled={addSubscription.isPending || packageTariffs.length === 0}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold tracking-widest uppercase rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60 panel-form-full-row-md"
              >
                {addSubscription.isPending ? "Оформление..." : "ПРОДАТЬ ПАКЕТ"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
