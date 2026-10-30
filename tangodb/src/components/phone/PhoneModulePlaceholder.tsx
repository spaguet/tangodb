import { useI18n } from "../../hooks/useI18n";
import { getPanelTitle } from "../../lib/i18n";
import { useUIStore } from "../../store/ui";

type Props = {
  pathname: string;
};

export default function PhoneModulePlaceholder({ pathname }: Props) {
  const { t } = useI18n();
  const subscriptionsTab = useUIStore((s) => s.subscriptionsTab);
  const title = getPanelTitle(pathname, subscriptionsTab, t);

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-xs">
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{t("phone.placeholder.body")}</p>
    </div>
  );
}
