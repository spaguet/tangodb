import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Coins, X } from "lucide-react";
import { useCreatePrice } from "../../hooks/usePrices";
import { useAccessibleLocations } from "../../hooks/useLocations";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useI18n } from "../../hooks/useI18n";
import { translateMutationBlockedMessage, useOnlineStatus } from "../../hooks/useOnlineStatus";
import { resolvePrivatePackagePriceType, type PrivatePackageFormat } from "../../lib/orgModules";
import { formatOptionsFromSettings, getCurrencyInputSuffix } from "../../lib/format";
import { useSettings } from "../../settings/SettingsProvider";
import { DEFAULT_ORG_MODULES } from "../../lib/orgModules";
import { resolveMutationError } from "../../lib/resolveMutationError";
import AppSelect, { descriptionFieldCls, fieldCls as inputCls } from "./AppSelect";
import { btnAddCls, btnCancelCls } from "./buttonStyles";
import LocationTariffField from "./LocationTariffField";
import DisciplineTariffField from "./DisciplineTariffField";
import PersonalTariffDurationField, {
  isValidPersonalTariffDuration,
  resolvePersonalTariffDurationMinutes,
  type PersonalTariffDurationSelect,
} from "./PersonalTariffDurationField";
import type { ToastType } from "../../App";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

interface CreatePrivatePackageTariffModalProps {
  open: boolean;
  onClose: () => void;
  toast: (msg: string, type?: ToastType) => void;
  /** Render above another modal (e.g. SellPackageModal). */
  stackLayer?: "default" | "above";
  onCreated?: () => void;
}

export default function CreatePrivatePackageTariffModal({
  open,
  onClose,
  toast,
  stackLayer = "above",
  onCreated,
}: CreatePrivatePackageTariffModalProps) {
  const createPrice = useCreatePrice();
  const { t } = useI18n();
  const { connectionState } = useOnlineStatus();
  const { locations } = useAccessibleLocations();
  const { data: disciplines = [] } = useDisciplines();
  const { settings } = useSettings();
  const currencySuffix = getCurrencyInputSuffix(formatOptionsFromSettings(settings));
  const modules = settings?.modules ?? DEFAULT_ORG_MODULES;
  const pairSubscriptionsEnabled = modules.pair_subscriptions ?? true;
  const trioLessonsEnabled = modules.trio_lessons ?? true;

  const [form, setForm] = useState({
    label: "",
    description: "",
    lessons: "4",
    price: "",
    format: "solo" as PrivatePackageFormat,
    durationSelect: "" as PersonalTariffDurationSelect,
    durationCustom: "",
  });
  const [bindToLocation, setBindToLocation] = useState(false);
  const [formLocationId, setFormLocationId] = useState("");
  const [bindToDiscipline, setBindToDiscipline] = useState(false);
  const [formDisciplineIds, setFormDisciplineIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

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
      setForm({
        label: "",
        description: "",
        lessons: "4",
        price: "",
        format: "solo",
        durationSelect: "",
        durationCustom: "",
      });
      setBindToLocation(false);
      setBindToDiscipline(false);
      return;
    }
    setFormLocationId(locations[0]?.id ?? "");
    setFormDisciplineIds(disciplines[0]?.id ? [disciplines[0].id] : []);
  }, [open, locations, disciplines]);

  const handleSubmit = async () => {
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!form.label.trim()) {
      toast(t("prices.error.nameRequired"), "error");
      return;
    }

    const parsedPrice = parseFloat(form.price);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      toast(t("prices.error.invalidCost"), "error");
      return;
    }

    const lessons = parseInt(form.lessons, 10);
    if (Number.isNaN(lessons) || lessons < 1) {
      toast(t("prices.error.lessonsRequired"), "error");
      return;
    }

    if (bindToLocation && !formLocationId) {
      toast(t("prices.error.locationRequired"), "error");
      return;
    }
    if (bindToDiscipline && formDisciplineIds.length === 0) {
      toast(t("prices.error.disciplineRequired"), "error");
      return;
    }

    const durationMinutes = resolvePersonalTariffDurationMinutes(
      form.durationSelect,
      form.durationCustom
    );
    if (!isValidPersonalTariffDuration(durationMinutes, true)) {
      toast(t("prices.error.tariffDurationRequired"), "error");
      return;
    }

    setPending(true);
    const res = await createPrice.mutateAsync({
      type: resolvePrivatePackagePriceType(form.format),
      lessons,
      price: parsedPrice,
      label: form.label,
      description: form.description,
      category: "private",
      locationId: bindToLocation ? formLocationId : null,
      disciplineIds: bindToDiscipline ? formDisciplineIds : [],
      billingModel: "lesson_count",
      durationMinutes,
    });
    setPending(false);

    if (!res.success) {
      toast(resolveMutationError(res.error, "prices.error.createFailed", t), "error");
      return;
    }

    toast(t("prices.success.created"), "success");
    onCreated?.();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className={`fixed inset-0 ${stackLayer === "above" ? "z-[80]" : "z-50"} flex items-center justify-center p-4`}
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
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full max-h-[90vh] overflow-y-auto p-4 panel-card-stack"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                  <Coins className="w-4 h-4 text-indigo-600" />
                </div>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">
                  {t("prices.form.privatePackageTitle")}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="panel-form-stack font-sans">
              <div className="field-stack">
                <label className={labelCls}>{t("prices.form.format")}</label>
                <AppSelect
                  value={form.format}
                  onChange={(e) =>
                    setForm({ ...form, format: e.target.value as PrivatePackageFormat })
                  }
                >
                  <option value="solo">{t("common.formatSolo")}</option>
                  {pairSubscriptionsEnabled && <option value="pair">{t("common.formatPair")}</option>}
                  {trioLessonsEnabled && <option value="trio">{t("common.formatTrio")}</option>}
                </AppSelect>
              </div>
              <div className="field-stack">
                <label className={labelCls}>{t("prices.form.name")}</label>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="field-stack">
                <label className={labelCls}>{t("prices.form.description")}</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className={descriptionFieldCls}
                />
              </div>
              <div className="field-stack">
                <label className={labelCls}>{t("prices.form.lessons")}</label>
                <input
                  type="number"
                  min={2}
                  value={form.lessons}
                  onChange={(e) => setForm({ ...form, lessons: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="field-stack">
                <label className={labelCls}>{t("prices.form.cost")}</label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className={`${inputCls} pr-8`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{currencySuffix}</span>
                </div>
              </div>
              <PersonalTariffDurationField
                select={form.durationSelect}
                onSelectChange={(durationSelect) => setForm({ ...form, durationSelect })}
                customValue={form.durationCustom}
                onCustomValueChange={(durationCustom) => setForm({ ...form, durationCustom })}
              />
              <LocationTariffField
                bindToLocation={bindToLocation}
                onBindChange={setBindToLocation}
                locationId={formLocationId}
                onLocationChange={setFormLocationId}
                locations={locations}
              />
              <DisciplineTariffField
                bindToDiscipline={bindToDiscipline}
                onBindChange={setBindToDiscipline}
                disciplineIds={formDisciplineIds}
                onDisciplineIdsChange={setFormDisciplineIds}
                disciplines={disciplines}
              />
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={connectionState !== "online" || pending}
                className={`w-full ${btnAddCls}`}
              >
                {pending ? t("common.saving") : t("prices.add")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className={`w-full ${btnCancelCls}`}
              >
                {t("common.close")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
