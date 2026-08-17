import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

export default function RentalTariffLookupLink({ className = "" }: { className?: string }) {
  const { t } = useI18n();

  return (
    <Link
      to="/settings/hall-rent"
      className={`inline-flex items-center gap-1 text-xs font-semibold text-gold-700 hover:text-gold-800 ${className}`}
    >
      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
      {t("rentalTariffs.lookupLink")}
    </Link>
  );
}
