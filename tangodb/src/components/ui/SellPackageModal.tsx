import { useEffect, useMemo, useState } from "react";
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
import { formatLessonDuration } from "../../lib/personalTariffPricing";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { useSaveOfflinePaymentDraft } from "../../hooks/useOfflineShift";
import {
  DEFAULT_ORG_MODULES,
  filterPrivatePackageTariffsByModules,
} from "../../lib/orgModules";
import { useSettings } from "../../settings/SettingsProvider";
import type { ToastType } from "../../App";
import type { Client, Discipline, Price } from "../../types";
import AppSelect from "./AppSelect";
import { btnAddCls } from "./buttonStyles";
import ClientAutocomplete from "./ClientAutocomplete";
import DatePickerField from "./DatePickerField";
import DisciplineSelect from "./DisciplineSelect";
import CreatePrivatePackageTariffModal from "./CreatePrivatePackageTariffModal";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

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
  const addSubscription = useAddSubscription();
  const { t } = useI18n();
  const { connectionState } = useOnlineStatus();
  const saveOfflinePaymentDraft = useSaveOfflinePaymentDraft();
  const { settings } = useSettings();

  const [createTariffOpen, setCreateTariffOpen] = useState(false);

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
      toast(t("subscriptions.error.selectTariff"), "error");
      return;
    }
    if (!subClient1Query || !subClient1Id) {
      toast(t("subscriptions.error.selectClient"), "error");
      return;
    }
    if (packageNeedsSecond && (!subClient2Query || !subClient2Id)) {
      toast(t("subscriptions.error.selectSecondClient"), "error");
      return;
    }
    if (packageNeedsThird && (!subClient3Query || !subClient3Id)) {
      toast(t("subscriptions.error.selectThirdClient"), "error");
      return;
    }
    if (!subDisciplineId) {
      toast(t("subscriptions.error.selectDiscipline"), "error");
      return;
    }
    if (!subActivationDate) {
      toast(t("subscriptions.error.activationDate"), "error");
      return;
    }

    if (connectionState !== "online") {
      const saved = await saveOfflinePaymentDraft({
        kind: "subscription",
        reminderLabel: t("offline.draft.subscriptionReminder", {
          client: subClient1Query,
          tariff: getPriceLabel(selectedPackageTariff, t),
        }),
        targetRef: selectedPackageTariff.id,
        dateStr: subActivationDate,
      });
      toast(saved ? t("offline.draft.paymentSaved") : t("common.saveFailed"), saved ? "info" : "error");
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
      toast(resolveMutationError(res.error, "subscriptions.package.error.sellFailed", t), "error");
    } else {
      toast(t("subscriptions.package.success.sold"), "success");
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
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-xl border border-ink-200 shadow-xl modal-wide-md"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 p-4 border-b border-ink-100 bg-white md:items-center">
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-gold-50 shrink-0">
                  <Ticket className="w-5 h-5 text-gold-700" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold tracking-tight text-ink-900">{t("subscriptions.package.title")}</h2>
                  <p className="text-ink-400 text-[11px] leading-snug mt-0.5">
                    {t("subscriptions.package.subtitle")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 panel-form-stack panel-form-stack-wide-md">
              <div className="field-stack">
                <label className={labelCls}>{t("subscriptions.sell.tariffLabel")}</label>
                {packageTariffs.length === 0 ? (
                  <p className="text-xs text-ink-500 font-sans leading-relaxed">
                    {t("subscriptions.package.noTariffs")}{" "}
                    <button
                      type="button"
                      onClick={() => setCreateTariffOpen(true)}
                      className="text-gold-700 hover:text-gold-800 font-semibold underline-offset-2 hover:underline cursor-pointer"
                    >
                      {t("subscriptions.package.createInPriceList")}
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
                        {t("subscriptions.package.tariffOption", {
                          label:
                            tariff.durationMinutes != null && tariff.durationMinutes > 0
                              ? `${getPriceLabel(tariff, t)} · ${formatLessonDuration(tariff.durationMinutes, t)}`
                              : getPriceLabel(tariff, t),
                          lessons: tariff.lessons,
                          price: formatCurrency(tariff.price),
                        })}
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
                label={packageNeedsSecond ? t("subscriptions.sell.firstClient") : t("subscriptions.sell.client")}
                clients={clients}
                query={subClient1Query}
                selectedId={subClient1Id}
                showAddClientButton
                addClientLinkLabel={t("subscriptions.sell.newClient")}
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
                  label={t("subscriptions.sell.secondClient")}
                  clients={clients}
                  query={subClient2Query}
                  selectedId={subClient2Id}
                  showAddClientButton
                  addClientLinkLabel={t("subscriptions.sell.newClient")}
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
                  label={t("subscriptions.package.thirdClient")}
                  clients={clients}
                  query={subClient3Query}
                  selectedId={subClient3Id}
                  showAddClientButton
                  addClientLinkLabel={t("subscriptions.sell.newClient")}
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
                label={t("subscriptions.sell.activationDate")}
                value={subActivationDate}
                onChange={setSubActivationDate}
                required
                className="panel-form-full-row-md"
              />

              <div className="flex items-center justify-between p-3 bg-gold-50/10 rounded-xl border border-gold-100 panel-form-full-row-md">
                <span className="text-ink-600 font-semibold text-sm">{t("common.totalDue")}</span>
                <span className="text-xl font-sans font-semibold text-gold-700">
                  {selectedPackageTariff ? formatCurrency(selectedPackageTariff.price) : "—"}
                </span>
              </div>

              <button
                type="button"
                onClick={handleSell}
                disabled={addSubscription.isPending || packageTariffs.length === 0}
                className={`w-full panel-form-full-row-md ${btnAddCls}`}
              >
                {addSubscription.isPending
                  ? t("subscriptions.package.submitPending")
                  : connectionState !== "online"
                    ? t("offline.draft.saveReminder")
                    : t("subscriptions.package.submit")}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <CreatePrivatePackageTariffModal
        open={createTariffOpen}
        onClose={() => setCreateTariffOpen(false)}
        toast={toast}
        stackLayer="above"
      />
    </AnimatePresence>
  );
}
