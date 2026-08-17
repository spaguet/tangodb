import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, X } from "lucide-react";
import { useAddDiscipline } from "../../hooks/useDisciplines";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import type { ToastType } from "../../App";
import type { Discipline } from "../../types";
import { descriptionFieldCls, fieldCls as inputCls } from "./AppSelect";
import { btnAddCls, btnCancelCls } from "./buttonStyles";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

interface AddDisciplineModalProps {
  open: boolean;
  onClose: () => void;
  toast: (msg: string, type?: ToastType) => void;
  onSuccess?: (discipline: Discipline) => void;
}

export default function AddDisciplineModal({ open, onClose, toast, onSuccess }: AddDisciplineModalProps) {
  const addDiscipline = useAddDiscipline();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

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
      setName("");
      setDescription("");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await addDiscipline.mutateAsync({ name, description });
    if (!res.success) {
      toast(resolveMutationError(res.error, "disciplines.error.addFailed", t), "error");
      return;
    }
    toast(t("disciplines.success.added"), "success");
    onSuccess?.(res.discipline);
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
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
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-ink-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack modal-wide-md-sm"
          >
            <div className="flex items-center justify-between border-b border-ink-100 pb-3">
              <div className="flex items-center gap-2 text-ink-800">
                <BookOpen className="w-4 h-4 text-gold-500" />
                <h3 className="text-base font-semibold tracking-tight text-ink-900">{t("disciplines.newTitle")}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="p-1 text-ink-400 hover:text-ink-700 rounded-full hover:bg-ink-100 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="panel-form-stack font-sans">
              <div className="field-stack">
                <label className={labelCls}>{t("common.name")}</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("disciplines.placeholder.name")}
                  className={inputCls}
                  autoFocus
                />
              </div>

              <div className="field-stack">
                <label className={labelCls}>{t("common.description")}</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("disciplines.placeholder.optional")}
                  rows={2}
                  className={descriptionFieldCls}
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={addDiscipline.isPending}
                  className={`flex-1 ${btnAddCls}`}
                >
                  {addDiscipline.isPending ? t("common.saving") : t("common.confirm")}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={`flex-1 ${btnCancelCls}`}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
