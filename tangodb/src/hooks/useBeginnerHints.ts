import { useCallback, useEffect, useMemo, useState } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  BEGINNER_HINTS_CHANGED_EVENT,
  type BeginnerHintId,
  clearAllDismissedBeginnerHints,
  dismissBeginnerHint,
  hideFirstDayChecklistUntilSettings,
  isFirstDayChecklistHiddenUntilSettings,
  readDismissedHintIds,
  restoreBeginnerHint,
  showFirstDayChecklistAgain,
} from "../lib/beginnerHintsStorage";

export function useBeginnerHints() {
  const { organizationId, settings } = useOrganization();
  const showBeginnerHints = settings?.show_beginner_hints !== false;

  const [dismissed, setDismissed] = useState<Set<BeginnerHintId>>(() => new Set());
  const [checklistHidden, setChecklistHidden] = useState(false);

  const syncFromStorage = useCallback(() => {
    if (!organizationId) {
      setDismissed(new Set());
      setChecklistHidden(false);
      return;
    }
    setDismissed(readDismissedHintIds(organizationId));
    setChecklistHidden(isFirstDayChecklistHiddenUntilSettings(organizationId));
  }, [organizationId]);

  useEffect(() => {
    syncFromStorage();
  }, [syncFromStorage]);

  useEffect(() => {
    const onChange = () => syncFromStorage();
    window.addEventListener(BEGINNER_HINTS_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(BEGINNER_HINTS_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [syncFromStorage]);

  const isHintDismissed = useCallback(
    (hintId: BeginnerHintId) => dismissed.has(hintId),
    [dismissed]
  );

  const shouldShowHintCard = useCallback(
    (hintId: BeginnerHintId) => showBeginnerHints && !dismissed.has(hintId),
    [dismissed, showBeginnerHints]
  );

  const dismissHint = useCallback(
    (hintId: BeginnerHintId) => {
      if (!organizationId) return;
      dismissBeginnerHint(organizationId, hintId);
      syncFromStorage();
    },
    [organizationId, syncFromStorage]
  );

  const restoreHint = useCallback(
    (hintId: BeginnerHintId) => {
      if (!organizationId) return;
      restoreBeginnerHint(organizationId, hintId);
      syncFromStorage();
    },
    [organizationId, syncFromStorage]
  );

  const restoreAllHints = useCallback(() => {
    if (!organizationId) return;
    clearAllDismissedBeginnerHints(organizationId);
    showFirstDayChecklistAgain(organizationId);
    syncFromStorage();
  }, [organizationId, syncFromStorage]);

  const showFirstDayChecklist = useMemo(
    () => showBeginnerHints && !checklistHidden,
    [checklistHidden, showBeginnerHints]
  );

  return {
    showBeginnerHints,
    showFirstDayChecklist,
    isHintDismissed,
    shouldShowHintCard,
    dismissHint,
    restoreHint,
    restoreAllHints,
    hideFirstDayChecklistUntilSettings: useCallback(() => {
      if (!organizationId) return;
      hideFirstDayChecklistUntilSettings(organizationId);
      syncFromStorage();
    }, [organizationId, syncFromStorage]),
  };
}
