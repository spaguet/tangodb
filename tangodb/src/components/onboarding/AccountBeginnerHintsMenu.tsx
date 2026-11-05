import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleHelp, LogOut } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import { useDismissOnRouteChange } from "../../hooks/useDismissOnRouteChange";
import { useBeginnerHints } from "../../hooks/useBeginnerHints";
import { useSettings } from "../../settings/SettingsProvider";
import { usePermissions } from "../../hooks/usePermissions";
import { btnHeaderSignOutCls } from "../ui/buttonStyles";
import { usePhoneOfflineExitConfirm } from "../phone/PhoneOfflineExitGuard";

interface AccountBeginnerHintsMenuProps {
  fullWidth?: boolean;
}

export default function AccountBeginnerHintsMenu({ fullWidth = false }: AccountBeginnerHintsMenuProps) {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const confirmOfflineExit = usePhoneOfflineExitConfirm();
  const toast = useToast();
  const { restoreAllHints, showBeginnerHints } = useBeginnerHints();
  const { updateSettings, isUpdating } = useSettings();
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useDismissOnRouteChange(() => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  const handleShowHints = async () => {
    restoreAllHints();
    if (!showBeginnerHints && can("settings.manage")) {
      const res = await updateSettings({ show_beginner_hints: true });
      if (!res.success) {
        toast(t("settings.saveError"), "error");
        setOpen(false);
        return;
      }
    }
    toast(t("beginnerHints.restored"), "success");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${fullWidth ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer ${
          fullWidth ? "w-full justify-between" : ""
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="hidden sm:inline">{t("beginnerHints.accountMenu")}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>

      {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-slate-200 bg-white shadow-lg py-1"
          >
            <button
              type="button"
              role="menuitem"
              disabled={isUpdating}
              onClick={() => void handleShowHints()}
              className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-60 flex items-center gap-2"
            >
              <CircleHelp className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              {t("beginnerHints.showAgain")}
            </button>
            <div className="px-2 pt-2 pb-2 mt-1 border-t border-slate-100">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void (async () => {
                    setOpen(false);
                    const proceed = await confirmOfflineExit("logout");
                    if (!proceed) return;
                    await signOut();
                  })();
                }}
                className={`${btnHeaderSignOutCls} w-full justify-start whitespace-nowrap`}
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                {t("nav.signOut")}
              </button>
            </div>
          </div>
      )}
    </div>
  );
}
