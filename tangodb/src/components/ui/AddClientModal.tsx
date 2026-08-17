import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { UserPlus, X } from "lucide-react";
import { useAddClient } from "../../hooks/useClients";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import type { ToastType } from "../../App";
import type { Client } from "../../types";
import { fieldCls as inputCls } from "./AppSelect";
import { btnAddCls, btnCancelCls } from "./buttonStyles";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

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
  const [isMinor, setIsMinor] = useState(false);
  const [guardian1Name, setGuardian1Name] = useState("");
  const [guardian1Phone, setGuardian1Phone] = useState("");
  const [guardian1Telegram, setGuardian1Telegram] = useState("");
  const [guardian1Address, setGuardian1Address] = useState("");
  const [guardian2Name, setGuardian2Name] = useState("");
  const [guardian2Phone, setGuardian2Phone] = useState("");
  const [guardian2Telegram, setGuardian2Telegram] = useState("");
  const [guardian2Address, setGuardian2Address] = useState("");
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
      setIsMinor(false);
      setGuardian1Name("");
      setGuardian1Phone("");
      setGuardian1Telegram("");
      setGuardian1Address("");
      setGuardian2Name("");
      setGuardian2Phone("");
      setGuardian2Telegram("");
      setGuardian2Address("");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast(t("clients.error.nameRequired"), "error");
      return;
    }

    const res = await addClient.mutateAsync({
      firstName,
      lastName,
      telegram,
      phone,
      email,
      isMinor,
      guardian1Name,
      guardian1Phone,
      guardian1Telegram,
      guardian1Address,
      guardian2Name,
      guardian2Phone,
      guardian2Telegram,
      guardian2Address,
    });
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
      isMinor,
      guardian1Name: isMinor ? guardian1Name.trim() : "",
      guardian1Phone: isMinor ? guardian1Phone.trim() : "",
      guardian1Telegram: isMinor ? guardian1Telegram.trim() : "",
      guardian1Address: isMinor ? guardian1Address.trim() : "",
      guardian2Name: isMinor ? guardian2Name.trim() : "",
      guardian2Phone: isMinor ? guardian2Phone.trim() : "",
      guardian2Telegram: isMinor ? guardian2Telegram.trim() : "",
      guardian2Address: isMinor ? guardian2Address.trim() : "",
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
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-ink-200 shadow-xl overflow-y-auto max-h-[90vh] max-w-sm w-full p-4 panel-card-stack modal-wide-md-sm"
          >
            <div className="flex items-center justify-between border-b border-ink-100 pb-3">
              <div className="flex items-center gap-2 text-ink-800">
                <UserPlus className="w-4 h-4 text-gold-500" />
                <h3 className="text-base font-semibold tracking-tight text-ink-900">{t("clients.modal.addTitle")}</h3>
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
                  <span className="absolute left-3.5 top-3 text-xs text-ink-500 font-sans pointer-events-none">t.me/</span>
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
                <p className="text-[10px] text-ink-500 leading-normal">
                  {t("common.telegramOptionalHint")}
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isMinor}
                  onChange={(e) => setIsMinor(e.target.checked)}
                  className="rounded border-ink-300 text-gold-700 focus:ring-gold-500"
                />
                {t("clients.form.isMinor")}
              </label>

              {isMinor && (
                <div className="rounded-xl border border-ink-100 bg-ink-50/70 p-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardian1")} · {t("clients.form.guardianName")}</label>
                      <input
                        type="text"
                        value={guardian1Name}
                        onChange={(e) => setGuardian1Name(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardian1")} · {t("clients.form.phone")}</label>
                      <input
                        type="tel"
                        value={guardian1Phone}
                        onChange={(e) => setGuardian1Phone(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardian1")} · Telegram</label>
                      <input
                        type="text"
                        value={guardian1Telegram}
                        onChange={(e) => setGuardian1Telegram(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardian1")} · {t("clients.form.guardianAddress")}</label>
                      <input
                        type="text"
                        value={guardian1Address}
                        onChange={(e) => setGuardian1Address(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardian2")} · {t("clients.form.guardianName")}</label>
                      <input
                        type="text"
                        value={guardian2Name}
                        onChange={(e) => setGuardian2Name(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardian2")} · {t("clients.form.phone")}</label>
                      <input
                        type="tel"
                        value={guardian2Phone}
                        onChange={(e) => setGuardian2Phone(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardian2")} · Telegram</label>
                      <input
                        type="text"
                        value={guardian2Telegram}
                        onChange={(e) => setGuardian2Telegram(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardian2")} · {t("clients.form.guardianAddress")}</label>
                      <input
                        type="text"
                        value={guardian2Address}
                        onChange={(e) => setGuardian2Address(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={addClient.isPending}
                  className={`flex-1 ${btnAddCls}`}
                >
                  {addClient.isPending ? t("clients.form.addPending") : resolvedSubmitLabel}
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
    </AnimatePresence>
  );
}
