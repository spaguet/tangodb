import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useOfflineStore } from "../../store/offline";
import { countQueueOps } from "../../lib/offline/storage";
import { isNativeCrmShell } from "../../lib/platform";
import type { I18nKey } from "../../lib/i18n/keys";

export type PhoneOfflineExitKind = "logout" | "orgSwitch";

type ConfirmFn = (kind: PhoneOfflineExitKind) => Promise<boolean>;

const PhoneOfflineExitGuardContext = createContext<ConfirmFn | null>(null);

export function usePhoneOfflineExitConfirm(): ConfirmFn {
  const ctx = useContext(PhoneOfflineExitGuardContext);
  return ctx ?? (async () => true);
}

export function PhoneOfflineExitGuardProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const queue = useOfflineStore((s) => s.queue);
  const [dialog, setDialog] = useState<{
    kind: PhoneOfflineExitKind;
    resolve: (proceed: boolean) => void;
  } | null>(null);

  const hasUnsyncedMarks = useMemo(() => {
    if (!queue) return false;
    const counts = countQueueOps(queue);
    return counts.pending + counts.failed > 0;
  }, [queue]);

  const confirmIfNeeded = useCallback<ConfirmFn>(
    async (kind) => {
      if (!isNativeCrmShell() || !hasUnsyncedMarks) return true;
      return new Promise<boolean>((resolve) => {
        setDialog({ kind, resolve });
      });
    },
    [hasUnsyncedMarks]
  );

  const closeDialog = (proceed: boolean) => {
    dialog?.resolve(proceed);
    setDialog(null);
  };

  const bodyKey: I18nKey =
    dialog?.kind === "orgSwitch"
      ? "offline.security.pendingMarksOrgSwitchBody"
      : "offline.security.pendingMarksLogoutBody";

  return (
    <PhoneOfflineExitGuardContext.Provider value={confirmIfNeeded}>
      {children}
      <AnimatePresence>
        {dialog ? (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
              onClick={() => closeDialog(false)}
            />
            <motion.div
              initial={{ y: 12, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl p-5 max-w-sm w-full space-y-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-2 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t("offline.security.pendingMarksTitle")}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{t(bodyKey)}</p>
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
                <button
                  type="button"
                  onClick={() => closeDialog(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer min-h-12"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => closeDialog(true)}
                  className="px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg cursor-pointer min-h-12"
                >
                  {t("offline.security.discardAndContinue")}
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </PhoneOfflineExitGuardContext.Provider>
  );
}
