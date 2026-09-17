import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";

type SettingsAccessLocationState = {
  settingsAccessNotice?: "team";
};

export default function SettingsAccessNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useI18n();
  const shownRef = useRef(false);

  useEffect(() => {
    const notice = (location.state as SettingsAccessLocationState | null)?.settingsAccessNotice;
    if (!notice || shownRef.current) return;
    shownRef.current = true;
    if (notice === "team") {
      toast(t("settings.access.teamDenied"), "info");
    }
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate, toast, t]);

  return null;
}
