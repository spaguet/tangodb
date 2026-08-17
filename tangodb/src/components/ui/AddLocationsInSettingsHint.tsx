import { Link } from "react-router-dom";
import { useI18n } from "../../hooks/useI18n";

interface AddLocationsInSettingsHintProps {
  className?: string;
}

export default function AddLocationsInSettingsHint({
  className = "text-xs font-sans",
}: AddLocationsInSettingsHintProps) {
  const { t } = useI18n();

  return (
    <p className={className}>
      {t("attendance.noLocationsHint")}{" "}
      <Link
        to="/settings/locations"
        className="text-gold-700 hover:text-gold-800 font-semibold underline-offset-2 hover:underline"
      >
        {t("attendance.settingsLocations")}
      </Link>
      .
    </p>
  );
}
