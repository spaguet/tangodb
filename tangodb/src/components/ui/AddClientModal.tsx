import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { UserPlus, X } from "lucide-react";
import { useAddClient } from "../../hooks/useClients";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import type { ToastType } from "../../App";
import type { Client } from "../../types";
import { fieldCls as inputCls } from "./AppSelect";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

interface AddClientModalProps {
  open: boolean;
  onClose: () => void;
  toast: (msg: string, type?: ToastType) => void;
  submitLabel?: string;
  onSuccess?: (client: Client) => void;
}

export default function AddClientModal({ open, onClose, toast, submitLabel, onSuccess }: AddClientModalProps) {
  const addClient = useAddClient();
  const { t } = useI18n();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const resolvedSubmitLabel = submitLabel || t("clients.form.addSubmit");

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
      setFirstName("");
      setLastName("");
      setTelegram("");
      setPhone("");
      setEmail("");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast(t("clients.error.nameRequired"), "error");
      return;
    }

    const res = await addClient.mutateAsync({ firstName, lastName, telegram, phone, email });
    if (!res.success) {
      toast(resolveMutationError(res.error, "clients.error.addFailed", t), "error");
      return;
    }

    toast(t("clients.success.added"), "success");
    onSuccess?.({
      id: res.id,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      telegram: telegram.trim(),
      phone: phone.trim(),
      email: email.trim(),
      isMinor: false,
      guardian1Name: "",
      guardian1Phone: "",
      guardian1Telegram: "",
      guardian1Address: "",
      guardian2Name: "",
      guardian2Phone: "",
      guardian2Telegram: "",
      guardian2Address: "",
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
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
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack modal-wide-md-sm"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-slate-800">
                <UserPlus className="w-4 h-4 text-indigo-500" />
                <h3 className="text-base font-semibold tracking-tight text-slate-900">{t("clients.modal.addTitle")}</h3>
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

            <form onSubmit={handleSubmit} noValidate className="panel-form-stack font-sans">
              <div className="field-stack">
                <label className={labelCls}>{t("clients.form.firstName")}</label>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder={t("clients.placeholder.firstName")}
                  className={inputCls}
                  autoFocus
                />
              </div>

              <div className="field-stack">
                <label className={labelCls}>{t("clients.form.lastName")}</label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder={t("clients.placeholder.lastName")}
                  className={inputCls}
                />
              </div>

              <div className="field-stack">
                <label className={labelCls}>{t("clients.form.phone")}</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("clients.placeholder.phone")}
                  className={inputCls}
                />
              </div>

              <div className="field-stack">
                <label className={labelCls}>{t("clients.form.email")}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("clients.placeholder.email")}
                  className={inputCls}
                />
              </div>

              <div className="field-stack">
                <label className={labelCls}>Telegram</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-3 text-xs text-slate-400 font-sans pointer-events-none">t.me/</span>
                  <input
                    type="text"
                    value={telegram.replace(/https?:\/\/t\.me\//, "")}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      if (val === "") {
                        setTelegram("");
                      } else {
                        setTelegram(`https://t.me/${val.replace(/@/, "")}`);
                      }
                    }}
                    placeholder="username"
                    className={`${inputCls} pl-12 font-sans`}
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-normal">
                  {t("common.telegramOptionalHint")}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={addClient.isPending}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {addClient.isPending ? t("clients.form.addPending") : resolvedSubmitLabel}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans text-xs rounded-lg transition-colors cursor-pointer"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
