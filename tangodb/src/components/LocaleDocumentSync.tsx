import { useEffect } from "react";
import { useI18n } from "../hooks/useI18n";

/** Keeps `<html lang>` in sync with org locale so native form validation messages match UI language. */
export default function LocaleDocumentSync() {
  const { locale } = useI18n();

  useEffect(() => {
    document.documentElement.lang = locale.startsWith("en") ? "en" : "ru";
  }, [locale]);

  return null;
}
