import type { Locale } from "../i18n";

type Props = {
  locale: Locale;
  onChange: (locale: Locale) => void;
};

export function LocaleSwitcher({ locale, onChange }: Props) {
  return (
    <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-100/80 text-xs font-semibold">
      {(["en", "ru"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onChange(code)}
          className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
            locale === code ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-700"
          }`}
          aria-pressed={locale === code}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
