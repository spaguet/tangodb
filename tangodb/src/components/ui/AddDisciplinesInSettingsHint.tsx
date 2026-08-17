import { Link } from "react-router-dom";
import { useI18n } from "../../hooks/useI18n";

interface AddDisciplinesInSettingsHintProps {
  className?: string;
}

export default function AddDisciplinesInSettingsHint({
  className = "text-xs font-sans",
}: AddDisciplinesInSettingsHintProps) {
  const { t } = useI18n();

  return (
    <p className={className}>
      {t("subscriptions.sell.noDisciplinesHint")}{" "}
      <Link
        to="/settings/disciplines"
        className="text-indigo-600 hover:text-indigo-800 font-semibold underline-offset-2 hover:underline"
      >
        {t("nav.panel.settingsDisciplines")}
      </Link>
      .
    </p>
  );
}
