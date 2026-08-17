import { useEffect, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import { useToast } from "../../App";
import { resolveMutationError } from "../../lib/resolveMutationError";
import {
  DEFAULT_RENTAL_BILLING_PROFILE,
  type RentalBillingProfile,
  type RentalDocumentsMode,
  type RentalVatMode,
} from "../../lib/rentalBillingProfile";
import { canManageVenueCostRules } from "../../lib/permissions";
import { usePermissions } from "../../hooks/usePermissions";
import {
  useRentalBillingProfile,
  useUpdateRentalBillingProfile,
} from "../../hooks/useRentalBillingProfile";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import LoadingState from "../ui/LoadingState";
import { btnAddCls } from "../ui/buttonStyles";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export default function RentalBillingProfileSection({ embedded }: { embedded?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const { role } = usePermissions();
  const canManage = canManageVenueCostRules(role);
  const profileQuery = useRentalBillingProfile();
  const updateProfile = useUpdateRentalBillingProfile();

  const [profile, setProfile] = useState<RentalBillingProfile>(DEFAULT_RENTAL_BILLING_PROFILE);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!profileQuery.data) return;
    setProfile(profileQuery.data);
    setDirty(false);
  }, [profileQuery.data]);

  if (profileQuery.isLoading) {
    return <LoadingState label={t("rentalBilling.loading")} />;
  }

  const setField = <K extends keyof RentalBillingProfile>(key: K, value: RentalBillingProfile[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    const res = await updateProfile.mutateAsync(profile);
    if (!res.success) {
      toast(resolveMutationError(res.error, "rentalBilling.error.saveFailed", t), "error");
      return;
    }
    toast(t("rentalBilling.saveSuccess"), "success");
    setDirty(false);
  };

  const content = (
    <div className="space-y-4">
      <p className="text-xs text-ink-500">{t("rentalBilling.disclaimer")}</p>

      <AppSelect
        label={t("rentalBilling.documentsMode")}
        value={profile.documents_mode}
        onChange={(e) => setField("documents_mode", e.target.value as RentalDocumentsMode)}
        disabled={!canManage}
      >
        <option value="off">{t("rentalBilling.documentsMode.off")}</option>
        <option value="crm">{t("rentalBilling.documentsMode.crm")}</option>
        <option value="export">{t("rentalBilling.documentsMode.export")}</option>
      </AppSelect>

      <div>
        <span className={labelCls}>{t("rentalBilling.countryCode")}</span>
        <input
          className={fieldCls}
          value={profile.country_code}
          onChange={(e) => setField("country_code", e.target.value)}
          disabled={!canManage}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className={labelCls}>{t("rentalBilling.legalName")}</span>
          <input
            className={fieldCls}
            value={profile.legal_name}
            onChange={(e) => setField("legal_name", e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div>
          <span className={labelCls}>{t("rentalBilling.inn")}</span>
          <input
            className={fieldCls}
            value={profile.inn}
            onChange={(e) => setField("inn", e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div>
          <span className={labelCls}>{t("rentalBilling.kpp")}</span>
          <input
            className={fieldCls}
            value={profile.kpp}
            onChange={(e) => setField("kpp", e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div>
          <span className={labelCls}>{t("rentalBilling.ogrn")}</span>
          <input
            className={fieldCls}
            value={profile.ogrn}
            onChange={(e) => setField("ogrn", e.target.value)}
            disabled={!canManage}
          />
        </div>
      </div>

      <div>
        <span className={labelCls}>{t("rentalBilling.legalAddress")}</span>
        <input
          className={fieldCls}
          value={profile.legal_address}
          onChange={(e) => setField("legal_address", e.target.value)}
          disabled={!canManage}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <span className={labelCls}>{t("rentalBilling.bankName")}</span>
          <input
            className={fieldCls}
            value={profile.bank_name}
            onChange={(e) => setField("bank_name", e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div>
          <span className={labelCls}>{t("rentalBilling.bankBik")}</span>
          <input
            className={fieldCls}
            value={profile.bank_bik}
            onChange={(e) => setField("bank_bik", e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div>
          <span className={labelCls}>{t("rentalBilling.bankAccount")}</span>
          <input
            className={fieldCls}
            value={profile.bank_account}
            onChange={(e) => setField("bank_account", e.target.value)}
            disabled={!canManage}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <AppSelect
          label={t("rentalBilling.vatMode")}
          value={profile.vat_mode}
          onChange={(e) => setField("vat_mode", e.target.value as RentalVatMode)}
          disabled={!canManage}
        >
          <option value="none">{t("rentalBilling.vatMode.none")}</option>
          <option value="included">{t("rentalBilling.vatMode.included")}</option>
          <option value="on_top">{t("rentalBilling.vatMode.onTop")}</option>
        </AppSelect>
        <div>
          <span className={labelCls}>{t("rentalBilling.vatRate")}</span>
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            className={fieldCls}
            value={profile.vat_rate}
            onChange={(e) => setField("vat_rate", Number(e.target.value))}
            disabled={!canManage}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className={labelCls}>{t("rentalBilling.invoicePrefix")}</span>
          <input
            className={fieldCls}
            value={profile.invoice_number_prefix}
            onChange={(e) => setField("invoice_number_prefix", e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div>
          <span className={labelCls}>{t("rentalBilling.nextInvoiceNumber")}</span>
          <input
            type="number"
            min={1}
            className={fieldCls}
            value={profile.next_invoice_number}
            onChange={(e) => setField("next_invoice_number", Number(e.target.value))}
            disabled={!canManage}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
        <input
          type="checkbox"
          checked={profile.fiscal_tracking_enabled}
          onChange={(e) => setField("fiscal_tracking_enabled", e.target.checked)}
          disabled={!canManage}
          className="rounded border-ink-300 text-gold-700 focus:ring-gold-500"
        />
        {t("rentalBilling.fiscalTrackingEnabled")}
      </label>

      {canManage ? (
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || updateProfile.isPending}
          className={btnAddCls}
        >
          {updateProfile.isPending ? t("common.saving") : t("common.save")}
        </button>
      ) : (
        <p className="text-xs text-ink-500">{t("rentalBilling.readOnlyHint")}</p>
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <div className="panel-card-stack max-w-4xl">
      <div>
        <h2 className="text-base font-semibold text-ink-900">{t("rentalBilling.pageTitle")}</h2>
        <p className="text-xs text-ink-500 mt-1">{t("rentalBilling.pageSubtitle")}</p>
      </div>
      <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-4">{content}</div>
    </div>
  );
}
