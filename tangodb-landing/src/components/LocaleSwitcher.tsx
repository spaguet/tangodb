import type { Locale } from "../i18n";

type Props = {
  locale: Locale;
  onChange: (locale: Locale) => void;
};

export function LocaleSwitcher({ locale, onChange }: Props) {
  return (
    <div className="flex rounded-lg border border-ink-200 p-0.5 bg-ink-100/10 text-xs font-semibold">
      {(["en", "ru"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onChange(code)}
          className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
            locale === code ? "bg-white text-gold-700 shadow-xs" : "text-ink-500 hover:text-ink-700"
          }`}
          aria-pressed={locale === code}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
