import { CircleHelp } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useI18n } from "../../hooks/useI18n";
import { useBeginnerHints } from "../../hooks/useBeginnerHints";
import { panelPathToBeginnerHintId } from "../../lib/beginnerHintsStorage";

export default function PanelBeginnerHelpButton() {
  const { t } = useI18n();
  const location = useLocation();
  const { showBeginnerHints, isHintDismissed, restoreHint } = useBeginnerHints();

  const hintId = panelPathToBeginnerHintId(location.pathname);
  if (!showBeginnerHints || !hintId || !isHintDismissed(hintId)) return null;

  return (
    <button
      type="button"
      onClick={() => restoreHint(hintId)}
      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer transition-colors"
      aria-label={t("beginnerHints.showSectionHelp")}
      title={t("beginnerHints.showSectionHelp")}
    >
      <CircleHelp className="w-4 h-4" />
    </button>
  );
}
