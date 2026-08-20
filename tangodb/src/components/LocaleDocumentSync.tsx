import { useEffect } from "react";
import { useI18n } from "../hooks/useI18n";

function htmlLangFromLocale(locale: string): string {
  if (locale.startsWith("en")) return "en";
  if (locale.startsWith("vi")) return "vi";
  return "ru";
}

/** Keeps `<html lang>` in sync with org locale so native form validation messages match UI language. */
export default function LocaleDocumentSync() {
  const { locale } = useI18n();

  useEffect(() => {
    document.documentElement.lang = htmlLangFromLocale(locale);
  }, [locale]);

  return null;
}
