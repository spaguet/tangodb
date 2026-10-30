import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { App } from "@capacitor/app";
import { bindNativeShellHandlers } from "../../lib/nativeShell";
import { findFirstEnabledAccessiblePanelPath } from "../../lib/permissions";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { normalizeOrgModules } from "../../lib/orgModules";
import { useToast } from "../../lib/toastContext";
import { useI18n } from "../../hooks/useI18n";

/** Wires Capacitor back button and external links once per native session. */
export default function NativeShellBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const showToast = useToast();
  const { role, options } = usePermissions();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);
  const lastRootBackRef = useRef(0);

  useEffect(() => {
    bindNativeShellHandlers({
      navigateBack: () => navigate(-1),
      onRootBack: () => {
        const home =
          findFirstEnabledAccessiblePanelPath(role, modules, options) ?? "/";
        const atRoot =
          location.pathname === home ||
          location.pathname === "/" ||
          location.pathname === home.replace(/\/$/, "");

        if (!atRoot) {
          navigate(-1);
          return;
        }

        const now = Date.now();
        if (now - lastRootBackRef.current < 2000) {
          void App.exitApp();
          return;
        }
        lastRootBackRef.current = now;
        showToast(t("phone.back.exitHint"), "info");
      },
    });
  }, [location.pathname, modules, navigate, options, role, showToast, t]);

  return null;
}
