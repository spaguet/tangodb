import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useOrganization } from "../../organization/OrganizationProvider";
import type { SupportTicketKind } from "../../hooks/useSubmitSupportTicket";
import { btnHeaderContactCls } from "../ui/buttonStyles";
import SupportDeveloperMessageModal from "./SupportDeveloperMessageModal";

interface SupportDeveloperMessageButtonProps {
  ticketKind: SupportTicketKind;
  pagePath: string;
}

export default function SupportDeveloperMessageButton({
  ticketKind,
  pagePath,
}: SupportDeveloperMessageButtonProps) {
  const { t } = useI18n();
  const { organization } = useOrganization();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={btnHeaderContactCls}
        title={t("support.ticket.buttonTitle")}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        {t("support.ticket.buttonShort")}
      </button>
      <SupportDeveloperMessageModal
        open={open}
        onClose={() => setOpen(false)}
        ticketKind={ticketKind}
        pagePath={pagePath}
        organizationId={organization?.id}
      />
    </>
  );
}
