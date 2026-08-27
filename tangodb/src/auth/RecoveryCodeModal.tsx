import { useState } from "react";
import { useGuestI18n } from "../hooks/useI18n";
import { AuthButton, AuthLayout } from "../auth/AuthLayout";

interface RecoveryCodeModalProps {
  code: string;
  onContinue: () => void;
}

export default function RecoveryCodeModal({ code, onContinue }: RecoveryCodeModalProps) {
  const { t } = useGuestI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.recoveryCode.subtitle")}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t("auth.recoveryCode.instructions")}</p>
        <p className="text-sm text-slate-500">{t("auth.recoveryCode.emailHint")}</p>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center">
          <p className="text-xs uppercase tracking-widest text-amber-700 mb-1">Emergency Recovery Code</p>
          <p className="font-mono text-lg font-bold text-slate-900 tracking-wider">{code}</p>
        </div>

        <AuthButton type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? t("common.copied") : t("common.copy")}
        </AuthButton>

        <AuthButton onClick={onContinue}>{t("auth.recoveryCode.continue")}</AuthButton>
      </div>
    </AuthLayout>
  );
}
