import { Mail, MessageCircle, Phone } from "lucide-react";
import {
  isSafeMailto,
  isSafeTelegramUrl,
  isSafeWhatsappUrl,
  type DeveloperContactsConfig,
} from "../../lib/paymentConfig";
import { useI18n } from "../../hooks/useI18n";
import { btnHeaderContactCls } from "../ui/buttonStyles";

interface DeveloperContactsProps {
  contacts: DeveloperContactsConfig | null | undefined;
  showTitle?: boolean;
  embedded?: boolean;
}

const DEFAULT_DEVELOPER_CONTACTS: DeveloperContactsConfig = {
  email: "omowdance@gmail.com",
  telegramUrl: "https://t.me/omow_second",
  whatsappUrl: "",
};

export default function DeveloperContacts({
  contacts,
  showTitle = true,
  embedded = false,
}: DeveloperContactsProps) {
  const { t } = useI18n();

  const resolvedContacts = {
    ...DEFAULT_DEVELOPER_CONTACTS,
    ...(contacts ?? {}),
  };

  const mailto = isSafeMailto(resolvedContacts.email);
  const telegram = isSafeTelegramUrl(resolvedContacts.telegramUrl);
  const whatsapp = isSafeWhatsappUrl(resolvedContacts.whatsappUrl);

  if (!mailto && !telegram && !whatsapp) return null;

  const buttons = (
    <div className="flex flex-wrap gap-2">
        {mailto && (
          <a
            href={mailto}
            className={btnHeaderContactCls}
          >
            <Mail className="w-3.5 h-3.5" />
            Email
          </a>
        )}
        {telegram && (
          <a
            href={telegram}
            target="_blank"
            rel="noopener noreferrer"
            className={btnHeaderContactCls}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Telegram
          </a>
        )}
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={btnHeaderContactCls}
          >
            <Phone className="w-3.5 h-3.5" />
            WhatsApp
          </a>
        )}
    </div>
  );

  if (embedded) return buttons;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
      {showTitle && (
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {t("license.contacts.title")}
        </p>
      )}
      {buttons}
    </div>
  );
}
