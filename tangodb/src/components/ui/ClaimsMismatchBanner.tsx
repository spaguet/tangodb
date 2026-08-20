import { Info } from "lucide-react";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useI18n } from "../../hooks/useI18n";

export default function ClaimsMismatchBanner() {
  const { claimsMismatch } = useOrganization();
  const { t } = useI18n();

  if (!claimsMismatch) return null;

  return (
    <div className="bg-sky-50 border-b border-sky-100 px-4 sm:px-6 py-2.5">
      <div className="flex items-start gap-2 text-sm text-sky-900">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{t("common.claimsMismatch.banner")}</span>
      </div>
    </div>
  );
}
