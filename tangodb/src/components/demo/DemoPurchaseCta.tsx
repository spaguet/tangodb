import { Link } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { useCrmLicensePurchaseUi } from "../../hooks/useCrmLicensePurchaseUi";
import { useI18n } from "../../hooks/useI18n";
import { btnAddCls } from "../ui/buttonStyles";

interface DemoPurchaseCtaProps {
  variant: "nav" | "banner";
  onNavigate?: () => void;
}

export default function DemoPurchaseCta({ variant, onNavigate }: DemoPurchaseCtaProps) {
  const { t } = useI18n();
  const { showPurchaseCta, purchasePath, ctaKind } = useCrmLicensePurchaseUi();

  if (!showPurchaseCta) return null;

  const className =
    variant === "nav" ? `w-full ${btnAddCls}` : `${btnAddCls} shrink-0`;
  const label = ctaKind === "renew" ? t("license.plan.renewCta") : t("demo.purchaseCta");

  return (
    <Link to={purchasePath} onClick={onNavigate} className={className}>
      <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
      {label}
    </Link>
  );
}
