import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

export type AccordionItem = {
  id: string;
  question: string;
  answer: string;
};

type Props = {
  items: AccordionItem[];
};

export function Accordion({ items }: Props) {
  const baseId = useId();
  const [openId, setOpenId] = useState<string | null>(null);

  function toggle(id: string) {
    setOpenId((current) => (current === id ? null : id));
  }

  return (
    <div className="divide-y divide-slate-200 border-y border-slate-200">
      {items.map(({ id, question, answer }) => {
        const isOpen = openId === id;
        const panelId = `${baseId}-${id}-panel`;
        const buttonId = `${baseId}-${id}-button`;

        return (
          <div key={id}>
            <h3>
              <button
                id={buttonId}
                type="button"
                className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-semibold text-slate-900 transition-colors hover:text-indigo-600 sm:text-base"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(id)}
              >
                <span>{question}</span>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!isOpen}
              className="pb-4 text-sm leading-relaxed text-slate-600 sm:text-[0.9375rem]"
            >
              {answer}
            </div>
          </div>
        );
      })}
    </div>
  );
}
