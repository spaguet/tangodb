import { useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import type { CrmPrice } from "../../lib/paymentConfig";
import type { OrgEditionSnapshot, ProductEdition } from "../../lib/orgEdition";
import { EDITION_RANK } from "../../lib/orgEdition";
import {
  canRestoreEditionViaMode,
  canSwitchModeDown,
  freezeCapabilityKeysForModeDown,
  hasLiveProLifetime,
  purchaseTargetForEdition,
} from "../../lib/licenseEditionUi";
import { useI18n } from "../../hooks/useI18n";
import type { I18nKey } from "../../lib/i18n/keys";
import ConfirmDialog from "../ui/ConfirmDialog";
import { btnAddCls, btnOpenCls } from "../ui/buttonStyles";

const EDITIONS: ProductEdition[] = ["lite", "studio", "pro"];

type EditionPrices = {
  studioMonthly?: CrmPrice | null;
  proMonthly?: CrmPrice | null;
  proLifetime?: CrmPrice | null;
};

interface EditionLicensePlanCardsProps {
  edition: OrgEditionSnapshot | null;
  prices: EditionPrices;
  canManage: boolean;
  onSwitchMode: (edition: ProductEdition) => void;
  modePending?: boolean;
}

function formatPrice(
  price: CrmPrice | null | undefined,
  t: (key: I18nKey, p?: Record<string, string | number>) => string
) {
  if (!price?.amount) return null;
  return t("license.plan.price", { amount: price.amount, currency: price.currency ?? "" });
}

export default function EditionLicensePlanCards({
  edition,
  prices,
  canManage,
  onSwitchMode,
  modePending = false,
}: EditionLicensePlanCardsProps) {
  const { t } = useI18n();
  const [pendingModeDown, setPendingModeDown] = useState<ProductEdition | null>(null);

  if (!edition) return null;

  const freezeKeys = pendingModeDown
    ? freezeCapabilityKeysForModeDown(edition.activeEdition, pendingModeDown)
    : [];

  const active = edition.activeEdition;
  const ceiling = edition.effectiveCeiling;
  const proLifetime = hasLiveProLifetime(edition);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {EDITIONS.map((code) => {
        const isCurrent = active === code;
        const rank = EDITION_RANK[code];
        const ceilingRank = EDITION_RANK[ceiling];
        const canBuy = rank > ceilingRank && canManage && !proLifetime;
        const canModeDown = canManage && canSwitchModeDown(edition, code);
        const canRestore = canManage && canRestoreEditionViaMode(edition, code);

        let priceLabel: string | null = null;
        if (code === "lite") priceLabel = t("license.edition.priceFree");
        if (code === "studio") priceLabel = formatPrice(prices.studioMonthly, t);
        if (code === "pro") {
          priceLabel =
            formatPrice(prices.proMonthly, t) ??
            formatPrice(prices.proLifetime, t) ??
            t("license.edition.priceProHint");
        }

        return (
          <article
            key={code}
            className={`relative flex flex-col rounded-xl border p-4 shadow-xs ${
              isCurrent
                ? "border-indigo-400 bg-indigo-50/40 ring-1 ring-indigo-200"
                : "border-slate-200/90 bg-white"
            }`}
          >
            {isCurrent && (
              <span className="absolute top-3 right-3 text-indigo-600" aria-hidden>
                <Check className="h-4 w-4" />
              </span>
            )}
            <h3 className="text-sm font-semibold text-slate-900">
              {t(`license.edition.name.${code}` as const)}
            </h3>
            <p className="mt-1 text-xs text-slate-500">{t(`license.edition.blurb.${code}` as const)}</p>
            {priceLabel && (
              <p className="mt-2 text-xs font-medium text-slate-700">{priceLabel}</p>
            )}
            <p className="mt-2 text-[10px] uppercase tracking-wide text-slate-400">
              {isCurrent
                ? t("license.edition.currentBadge")
                : rank <= ceilingRank
                  ? t("license.edition.includedInCeiling")
                  : t("license.edition.requiresPurchase")}
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {canRestore && (
                <button
                  type="button"
                  disabled={modePending}
                  onClick={() => onSwitchMode(code)}
                  className={btnAddCls}
                >
                  {t(`license.edition.restore.${code}` as const)}
                </button>
              )}
              {canModeDown && !canRestore && (
                <button
                  type="button"
                  disabled={modePending}
                  onClick={() => setPendingModeDown(code)}
                  className={btnOpenCls}
                >
                  {t(`license.edition.modeSwitch.${code}` as const)}
                </button>
              )}
              {canBuy && code !== "lite" && (
                <Link to={purchaseTargetForEdition(code)} className={`${btnAddCls} text-center`}>
                  {t(code === "studio" ? "license.edition.buy.studio" : "license.edition.buy.pro")}
                </Link>
              )}
              {isCurrent && code === "lite" && proLifetime && (
                <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1.5">
                  {t("license.edition.proLifetimeWhileLite")}
                </p>
              )}
            </div>
          </article>
        );
      })}

      <ConfirmDialog
        open={pendingModeDown !== null}
        title={t("license.edition.modeDownTitle")}
        description={
          <>
            <span>{t("license.edition.modeDownBody")}</span>
            <span className="block mt-2">{t("license.edition.modeDownDataKept")}</span>
            {freezeKeys.length > 0 && (
              <ul className="mt-2 list-disc pl-4 space-y-1">
                {freezeKeys.map((key) => (
                  <li key={key}>{t(key as I18nKey)}</li>
                ))}
              </ul>
            )}
          </>
        }
        confirmLabel={t("license.edition.modeDownConfirm")}
        cancelLabel={t("common.cancel")}
        onCancel={() => setPendingModeDown(null)}
        onConfirm={() => {
          if (pendingModeDown) onSwitchMode(pendingModeDown);
          setPendingModeDown(null);
        }}
      />
    </div>
  );
}
