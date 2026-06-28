import { Mail, MessageCircle, Phone } from "lucide-react";
import {
  isSafeMailto,
  isSafeTelegramUrl,
  isSafeWhatsappUrl,
  type DeveloperContactsConfig,
} from "../../lib/paymentConfig";
import { useI18n } from "../../hooks/useI18n";

interface DeveloperContactsProps {
  contacts: DeveloperContactsConfig | null | undefined;
}

const DEFAULT_DEVELOPER_CONTACTS: DeveloperContactsConfig = {
  email: "omowdance@gmail.com",
  telegramUrl: "https://t.me/omow_second",
  whatsappUrl: "",
};

export default function DeveloperContacts({ contacts }: DeveloperContactsProps) {
  const { t } = useI18n();

  const resolvedContacts = {
    ...DEFAULT_DEVELOPER_CONTACTS,
    ...(contacts ?? {}),
  };

  const mailto = isSafeMailto(resolvedContacts.email);
  const telegram = isSafeTelegramUrl(resolvedContacts.telegramUrl);
  const whatsapp = isSafeWhatsappUrl(resolvedContacts.whatsappUrl);

  if (!mailto && !telegram && !whatsapp) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {t("license.contacts.title")}
      </p>
      <div className="flex flex-wrap gap-2">
        {mailto && (
          <a
            href={mailto}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-indigo-200 hover:text-indigo-700"
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-indigo-200 hover:text-indigo-700"
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-indigo-200 hover:text-indigo-700"
          >
            <Phone className="w-3.5 h-3.5" />
            WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
