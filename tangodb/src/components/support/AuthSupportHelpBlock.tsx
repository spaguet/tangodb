import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SupportTicketKind } from "../../hooks/useSubmitSupportTicket";
import { useGuestI18n } from "../../hooks/useI18n";
import SupportDeveloperMessageModal from "./SupportDeveloperMessageModal";

interface AuthSupportHelpBlockProps {
  ticketKind: Extract<SupportTicketKind, "login_help" | "forgot_password">;
  pagePath: string;
}

export default function AuthSupportHelpBlock({ ticketKind, pagePath }: AuthSupportHelpBlockProps) {
  const { t } = useGuestI18n();
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const title =
    ticketKind === "login_help"
      ? t("support.ticket.loginHelpTitle")
      : t("support.ticket.forgotHelpTitle");

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100/80 cursor-pointer"
      >
        <span>{title}</span>
        {expanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-200/80">
          <p className="text-xs text-slate-500 pt-2">{t("support.ticket.authHelpHint")}</p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
          >
            {t("support.ticket.openForm")}
          </button>
        </div>
      )}
      <SupportDeveloperMessageModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        ticketKind={ticketKind}
        pagePath={pagePath}
        guestMode
      />
    </div>
  );
}
