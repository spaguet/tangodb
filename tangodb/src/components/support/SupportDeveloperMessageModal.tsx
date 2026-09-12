import { useEffect, useState } from "react";
import { X } from "lucide-react";
import TurnstileWidget, { isTurnstileConfigured } from "../auth/TurnstileWidget";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";
import { useGuestI18n, useI18n } from "../../hooks/useI18n";
import {
  type SupportTicketKind,
  useSubmitSupportTicket,
} from "../../hooks/useSubmitSupportTicket";

interface SupportDeveloperMessageModalProps {
  open: boolean;
  onClose: () => void;
  ticketKind: SupportTicketKind;
  pagePath: string;
  organizationId?: string;
  defaultEmail?: string;
  guestMode?: boolean;
}

export default function SupportDeveloperMessageModal({
  open,
  onClose,
  ticketKind,
  pagePath,
  organizationId,
  defaultEmail,
  guestMode = false,
}: SupportDeveloperMessageModalProps) {
  const guestI18n = useGuestI18n();
  const appI18n = useI18n();
  const t = guestMode ? guestI18n.t : appI18n.t;
  const locale = guestMode ? guestI18n.locale : appI18n.locale;

  const submit = useSubmitSupportTicket();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [telegram, setTelegram] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    setEmail(defaultEmail ?? "");
    setTelegram("");
    setMessage("");
    setError(null);
    setSuccess(false);
    setTurnstileToken(null);
    setTurnstileResetKey((k) => k + 1);
  }, [open, defaultEmail]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (guestMode && isTurnstileConfigured() && !turnstileToken) {
      setError(t("support.ticket.captchaRequired"));
      return;
    }
    try {
      await submit.mutateAsync({
        clientRequestId: crypto.randomUUID(),
        ticketKind,
        message: message.trim(),
        pagePath,
        locale,
        email: guestMode ? email.trim() : email.trim() || undefined,
        contactTelegram: telegram.trim() || undefined,
        organizationId,
        turnstileToken: guestMode ? turnstileToken : undefined,
      });
      setSuccess(true);
    } catch (err) {
      setError(t("support.ticket.submitError"));
      setTurnstileResetKey((k) => k + 1);
      setTurnstileToken(null);
      if (import.meta.env.DEV) {
        console.warn("[TangoDB] support ticket submit failed", err);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-modal-title"
        className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-lg p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="support-modal-title" className="text-base font-semibold text-slate-800">
            {t("support.ticket.modalTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label={t("support.ticket.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {t("support.ticket.success")}
            </p>
            <p className="text-xs text-slate-500">{t("support.ticket.successHint")}</p>
            <button type="button" onClick={onClose} className={btnAddCls}>
              {t("support.ticket.close")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm text-slate-500">{t("support.ticket.modalHint")}</p>
            {guestMode && (
              <div>
                <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  {t("support.ticket.emailLabel")}
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  autoComplete="email"
                />
              </div>
            )}
            <div>
              <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                {t("support.ticket.telegramLabel")}
              </label>
              <input
                type="text"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder="@username"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                {t("support.ticket.messageLabel")}
              </label>
              <textarea
                required
                minLength={3}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y"
              />
            </div>
            {guestMode && (
              <TurnstileWidget
                resetKey={turnstileResetKey}
                onToken={setTurnstileToken}
                onError={() => setTurnstileToken(null)}
              />
            )}
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className={btnCancelCls}>
                {t("support.ticket.cancel")}
              </button>
              <button type="submit" disabled={submit.isPending} className={btnAddCls}>
                {submit.isPending ? t("support.ticket.sending") : t("support.ticket.send")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
