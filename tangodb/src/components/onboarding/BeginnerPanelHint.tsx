import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useBeginnerHints } from "../../hooks/useBeginnerHints";
import type { BeginnerHintId } from "../../lib/beginnerHintsStorage";
import type { I18nKey } from "../../lib/i18n/keys";

interface BeginnerPanelHintProps {
  hintId: BeginnerHintId;
  titleKey: I18nKey;
  bodyKey: I18nKey;
  actionLabelKey: I18nKey;
  actionTo?: string;
  actionOnClick?: () => void;
  className?: string;
}

export default function BeginnerPanelHint({
  hintId,
  titleKey,
  bodyKey,
  actionLabelKey,
  actionTo,
  actionOnClick,
  className = "",
}: BeginnerPanelHintProps) {
  const { t } = useI18n();
  const { shouldShowHintCard, dismissHint } = useBeginnerHints();

  if (!shouldShowHintCard(hintId)) return null;

  return (
    <div
      className={`relative rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-4 py-3 text-left space-y-2 ${className}`}
    >
      <button
        type="button"
        onClick={() => dismissHint(hintId)}
        className="absolute top-2 right-2 p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-white/80 cursor-pointer"
        aria-label={t("beginnerHints.dismiss")}
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <p className="text-sm font-semibold text-slate-900 pr-8">{t(titleKey)}</p>
      <p className="text-xs text-slate-600 leading-relaxed">{t(bodyKey)}</p>
      {actionOnClick ? (
        <button
          type="button"
          onClick={actionOnClick}
          className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors cursor-pointer"
        >
          {t(actionLabelKey)}
        </button>
      ) : (
        <Link
          to={actionTo ?? "/"}
          className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          {t(actionLabelKey)}
        </Link>
      )}
    </div>
  );
}
