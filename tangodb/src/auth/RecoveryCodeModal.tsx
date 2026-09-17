import { useState } from "react";
import { useGuestI18n } from "../hooks/useI18n";
import { AuthButton, AuthLayout } from "./AuthLayout";

interface RecoveryCodeModalProps {
  code: string;
  onContinue: () => void;
}

export default function RecoveryCodeModal({ code, onContinue }: RecoveryCodeModalProps) {
  const { t } = useGuestI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [savedAck, setSavedAck] = useState(false);

  const copy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.recoveryCode.subtitle")}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t("auth.recoveryCode.instructions")}</p>
        <p className="text-sm text-slate-500">{t("auth.recoveryCode.emailHint")}</p>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center">
          <p className="text-xs uppercase tracking-widest text-amber-700 mb-1">
            {t("auth.recoveryCode.codeLabel")}
          </p>
          <p className="font-mono text-lg font-bold text-slate-900 tracking-wider">{code}</p>
        </div>

        <AuthButton type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? t("common.copied") : t("common.copy")}
        </AuthButton>
        {copyFailed ? (
          <p className="text-xs text-rose-600" role="status">{t("auth.recoveryCode.copyFailed")}</p>
        ) : null}

        <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={savedAck}
            onChange={(e) => setSavedAck(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-indigo-600"
          />
          <span>{t("auth.recoveryCode.savedAck")}</span>
        </label>

        <AuthButton onClick={onContinue}>{t("auth.recoveryCode.continue")}</AuthButton>
        {!savedAck ? (
          <p className="text-xs text-slate-500">{t("auth.recoveryCode.continueHint")}</p>
        ) : null}
      </div>
    </AuthLayout>
  );
}
