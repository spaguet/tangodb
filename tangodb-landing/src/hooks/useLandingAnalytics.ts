import { useEffect } from "react";
import type { Locale } from "../i18n";
import { initLandingAnalytics } from "../lib/landingAnalytics";

export function useLandingAnalytics(locale: Locale) {
  useEffect(() => {
    return initLandingAnalytics(locale);
  }, [locale]);
}
