import { useEffect, useState } from "react";
import type { RentalFiscalStatus } from "../../lib/rentalBillingProfile";
import { defaultFiscalStatusForMethod } from "../../lib/rentalBillingProfile";
import { useI18n } from "../../hooks/useI18n";
import type { PaymentMethod } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export interface RentalFiscalFieldValues {
  fiscalStatus: RentalFiscalStatus;
  fiscalReceiptNumber: string;
  fiscalCashRegisterId: string;
  fiscalTerminalId: string;
  fiscalAcquiringId: string;
}

export const EMPTY_FISCAL_VALUES: RentalFiscalFieldValues = {
  fiscalStatus: "not_required",
  fiscalReceiptNumber: "",
  fiscalCashRegisterId: "",
  fiscalTerminalId: "",
  fiscalAcquiringId: "",
};

export function RentalFiscalPaymentFields({
  enabled,
  method,
  values,
  onChange,
}: {
  enabled: boolean;
  method: PaymentMethod;
  values: RentalFiscalFieldValues;
  onChange: (next: RentalFiscalFieldValues) => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!enabled) return;
    onChange({
      ...values,
      fiscalStatus: defaultFiscalStatusForMethod(method, true),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset status when method changes
  }, [enabled, method]);

  if (!enabled) return null;

  const statuses: RentalFiscalStatus[] = [
    "not_required",
    "pending",
    "issued",
    "failed",
    "refunded",
  ];

  return (
    <div className="space-y-3 border-t border-ink-100 pt-3">
      <p className="text-xs font-semibold text-ink-700">{t("rentalBilling.fiscalSection")}</p>
      <AppSelect
        label={t("rentalBilling.fiscalStatus")}
        value={values.fiscalStatus}
        onChange={(e) => onChange({ ...values, fiscalStatus: e.target.value as RentalFiscalStatus })}
      >
        {statuses.map((status) => (
          <option key={status} value={status}>
            {t(`rentalBilling.fiscalStatus.${status}`)}
          </option>
        ))}
      </AppSelect>
      <div>
        <span className={labelCls}>{t("rentalBilling.fiscalReceiptNumber")}</span>
        <input
          className={fieldCls}
          value={values.fiscalReceiptNumber}
          onChange={(e) => onChange({ ...values, fiscalReceiptNumber: e.target.value })}
        />
      </div>
      <div>
        <span className={labelCls}>{t("rentalBilling.fiscalCashRegisterId")}</span>
        <input
          className={fieldCls}
          value={values.fiscalCashRegisterId}
          onChange={(e) => onChange({ ...values, fiscalCashRegisterId: e.target.value })}
        />
      </div>
      <div>
        <span className={labelCls}>{t("rentalBilling.fiscalTerminalId")}</span>
        <input
          className={fieldCls}
          value={values.fiscalTerminalId}
          onChange={(e) => onChange({ ...values, fiscalTerminalId: e.target.value })}
        />
      </div>
      <div>
        <span className={labelCls}>{t("rentalBilling.fiscalAcquiringId")}</span>
        <input
          className={fieldCls}
          value={values.fiscalAcquiringId}
          onChange={(e) => onChange({ ...values, fiscalAcquiringId: e.target.value })}
        />
      </div>
    </div>
  );
}

export function fiscalValuesToInput(values: RentalFiscalFieldValues) {
  return {
    fiscalStatus: values.fiscalStatus,
    fiscalReceiptNumber: values.fiscalReceiptNumber.trim() || undefined,
    fiscalCashRegisterId: values.fiscalCashRegisterId.trim() || undefined,
    fiscalTerminalId: values.fiscalTerminalId.trim() || undefined,
    fiscalAcquiringId: values.fiscalAcquiringId.trim() || undefined,
  };
}
