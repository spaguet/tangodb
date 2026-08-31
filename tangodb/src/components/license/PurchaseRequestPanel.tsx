import { useState } from "react";
import { FileText, Send } from "lucide-react";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import { useSubmitPurchaseRequest } from "../../hooks/useSubmitPurchaseRequest";
import { useOrganization } from "../../organization/OrganizationProvider";
import type { DeveloperContactsConfig } from "../../lib/paymentConfig";
import DeveloperContacts from "./DeveloperContacts";
import { btnAddCls } from "../ui/buttonStyles";
import { fieldCls } from "../ui/AppSelect";
import {
  isPurchaseCommentValid,
  PURCHASE_REQUEST_COMMENT_MIN_LENGTH,
} from "../../lib/purchaseRequest";

interface PurchaseRequestPanelProps {
  contacts: DeveloperContactsConfig | null | undefined;
}

export default function PurchaseRequestPanel({ contacts }: PurchaseRequestPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { organization } = useOrganization();
  const submitRequest = useSubmitPurchaseRequest();
  const [paymentComment, setPaymentComment] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactTelegram, setContactTelegram] = useState("");
  const [error, setError] = useState<string | null>(null);

  const commentLen = paymentComment.trim().length;
  const commentValid = isPurchaseCommentValid(paymentComment);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!organization) return;
    setError(null);

    try {
      await submitRequest.mutateAsync({
        organizationId: organization.id,
        paymentComment,
        contactEmail,
        contactTelegram,
      });
      setPaymentComment("");
      setContactEmail("");
      setContactTelegram("");
      toast(t("license.purchase.request.success"), "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "request_save_failed";
      setError(
        message === "payment_comment_too_short"
          ? t("license.purchase.request.commentTooShort")
          : t("license.purchase.request.error")
      );
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-3">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-indigo-600" />
          {t("license.purchase.request.title")}
        </p>
        <p className="text-xs text-slate-600 leading-relaxed">{t("license.purchase.request.description")}</p>
      </div>

      <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
        {t("license.purchase.request.receiptHint")}
      </p>
      <DeveloperContacts contacts={contacts} embedded />

      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block space-y-1">
          <span className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
            {t("license.purchase.request.commentLabel")}
          </span>
          <textarea
            value={paymentComment}
            onChange={(event) => setPaymentComment(event.target.value)}
            rows={5}
            placeholder={t("license.purchase.request.commentPlaceholder")}
            className="w-full min-h-[7rem] resize-none bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-xs transition-all"
          />
          {!commentValid ? (
            <p className="text-[10px] text-slate-400">
              {t("license.purchase.request.commentMinHint", {
                min: PURCHASE_REQUEST_COMMENT_MIN_LENGTH,
                current: commentLen,
              })}
            </p>
          ) : null}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
              {t("license.purchase.request.emailLabel")}
            </span>
            <input
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder="name@example.com"
              className={fieldCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
              {t("license.purchase.request.telegramLabel")}
            </span>
            <input
              value={contactTelegram}
              onChange={(event) => setContactTelegram(event.target.value)}
              placeholder="@username"
              className={fieldCls}
            />
          </label>
        </div>

        {error && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitRequest.isPending || !commentValid}
          className={`w-full ${btnAddCls}`}
        >
          <Send className="w-3.5 h-3.5" />
          {submitRequest.isPending ? t("license.purchase.request.submitting") : t("license.purchase.request.submit")}
        </button>
      </form>
    </div>
  );
}
