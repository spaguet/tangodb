import { Link } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { useDemoLicenseUi } from "../../hooks/useDemoLicenseUi";

interface DemoPurchaseCtaProps {
  variant: "nav" | "banner";
  onNavigate?: () => void;
}

export default function DemoPurchaseCta({ variant, onNavigate }: DemoPurchaseCtaProps) {
  const { showPurchaseCta, purchasePath } = useDemoLicenseUi();

  if (!showPurchaseCta) return null;

  const className =
    variant === "nav"
      ? "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-xs font-semibold tracking-wide bg-indigo-600 text-white hover:bg-indigo-700 transition-colors cursor-pointer"
      : "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shrink-0";

  return (
    <Link to={purchasePath} onClick={onNavigate} className={className}>
      <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
      Купить полную версию
    </Link>
  );
}
