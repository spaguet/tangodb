import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Coins, X } from "lucide-react";
import { useCreatePrice } from "../../hooks/usePrices";
import { useAccessibleLocations } from "../../hooks/useLocations";
import { useDisciplines } from "../../hooks/useDisciplines";
import { resolvePrivatePackagePriceType, type PrivatePackageFormat } from "../../lib/orgModules";
import { useSettings } from "../../settings/SettingsProvider";
import { DEFAULT_ORG_MODULES } from "../../lib/orgModules";
import AppSelect, { descriptionFieldCls, fieldCls as inputCls } from "./AppSelect";
import LocationTariffField from "./LocationTariffField";
import DisciplineTariffField from "./DisciplineTariffField";
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
  const { locations } = useAccessibleLocations();
  const { data: disciplines = [] } = useDisciplines();
  const { settings } = useSettings();
  const modules = settings?.modules ?? DEFAULT_ORG_MODULES;
  const pairSubscriptionsEnabled = modules.pair_subscriptions ?? true;
  const trioLessonsEnabled = modules.trio_lessons ?? true;

  const [form, setForm] = useState({
    label: "",
    description: "",
    lessons: "4",
    price: "",
    format: "solo" as PrivatePackageFormat,
  });
  const [bindToLocation, setBindToLocation] = useState(false);
  const [formLocationId, setFormLocationId] = useState("");
  const [bindToDiscipline, setBindToDiscipline] = useState(false);
  const [formDisciplineId, setFormDisciplineId] = useState("");
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
      setForm({ label: "", description: "", lessons: "4", price: "", format: "solo" });
      setBindToLocation(false);
      setBindToDiscipline(false);
      return;
    }
    setFormLocationId(locations[0]?.id ?? "");
    setFormDisciplineId(disciplines[0]?.id ?? "");
  }, [open, locations, disciplines]);

  const handleSubmit = async () => {
    if (!form.label.trim()) {
      toast("Укажите название тарифа.", "error");
      return;
    }

    const parsedPrice = parseFloat(form.price);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      toast("Введите корректную стоимость.", "error");
      return;
    }

    const lessons = parseInt(form.lessons, 10);
    if (Number.isNaN(lessons) || lessons < 1) {
      toast("Укажите количество уроков (не меньше 1).", "error");
      return;
    }

    if (bindToLocation && !formLocationId) {
      toast("Выберите локацию для локального тарифа.", "error");
      return;
    }
    if (bindToDiscipline && !formDisciplineId) {
      toast("Выберите дисциплину для тарифа.", "error");
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
      disciplineId: bindToDiscipline ? formDisciplineId : null,
      billingModel: "lesson_count",
    });
    setPending(false);

    if (!res.success) {
      toast(res.error || "Не удалось создать тариф", "error");
      return;
    }

    toast("Тариф добавлен в прайс-лист", "success");
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
                  Новый тариф · пакет персональных уроков
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="panel-form-stack font-sans">
              <div className="field-stack">
                <label className={labelCls}>Формат</label>
                <AppSelect
                  value={form.format}
                  onChange={(e) =>
                    setForm({ ...form, format: e.target.value as PrivatePackageFormat })
                  }
                >
                  <option value="solo">Соло</option>
                  {pairSubscriptionsEnabled && <option value="pair">Пара</option>}
                  {trioLessonsEnabled && <option value="trio">Трио</option>}
                </AppSelect>
              </div>
              <div className="field-stack">
                <label className={labelCls}>Название</label>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="field-stack">
                <label className={labelCls}>Описание</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className={descriptionFieldCls}
                />
              </div>
              <div className="field-stack">
                <label className={labelCls}>Количество уроков</label>
                <input
                  type="number"
                  min={2}
                  value={form.lessons}
                  onChange={(e) => setForm({ ...form, lessons: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="field-stack">
                <label className={labelCls}>Стоимость</label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className={`${inputCls} pr-8`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">₫</span>
                </div>
              </div>
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
                disciplineId={formDisciplineId}
                onDisciplineChange={setFormDisciplineId}
                disciplines={disciplines}
              />
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={pending}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                {pending ? "..." : "Добавить"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer text-xs"
              >
                Закрыть
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
