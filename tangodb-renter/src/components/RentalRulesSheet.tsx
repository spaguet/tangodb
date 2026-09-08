import rentalRulesRu from "../../docs/rental_rules_ru.md?raw";
import { t, type Locale } from "../i18n/strings";
import { btnSecondaryCls } from "../lib/crmUi";
import { renderMarkdown } from "../lib/renderMarkdown";

type RentalRulesSheetProps = {
  locale: Locale;
  onClose: () => void;
};

export default function RentalRulesSheet({ locale, onClose }: RentalRulesSheetProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rental-rules-title"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 shadow-xs">
        <h2 id="rental-rules-title" className="text-base font-semibold text-slate-900">
          {t(locale, "rulesTitle")}
        </h2>
        <button type="button" className={btnSecondaryCls} onClick={onClose}>
          {t(locale, "rulesClose")}
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-4 py-4 pb-8 [-webkit-overflow-scrolling:touch]">
        {renderMarkdown(rentalRulesRu)}
      </div>
    </div>
  );
}
