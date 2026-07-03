import { Coins } from "lucide-react";
import type { Locale } from "../../i18n";
import { formatMoney, priceTariffs } from "../data";
import { panelStrings } from "../panelStrings";

type Props = { locale: Locale };

function PriceCard({
  title,
  desc,
  price,
  meta,
  formatPrice,
}: {
  title: string;
  desc: string;
  price: number;
  meta: string;
  formatPrice: (n: number) => string;
}) {
  return (
    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col justify-between gap-4 h-full demo-field-disabled">
      <div className="min-w-0 flex-1 space-y-1">
        <h4 className="font-semibold text-slate-800 text-sm leading-snug">{title}</h4>
        <p className="text-[11px] text-slate-400 font-sans tracking-tight">
          {desc} · {formatPrice(price)}
        </p>
        <p className="text-[10px] text-slate-400 font-sans mt-1">{meta}</p>
      </div>
      <div className="flex items-center justify-end">
        <span className="text-sm font-semibold text-slate-700">{formatPrice(price)}</span>
      </div>
    </div>
  );
}

function TariffSection({
  title,
  items,
  formatPrice,
}: {
  title: string;
  items: readonly { title: string; desc: string; price: number; meta: string }[];
  formatPrice: (n: number) => string;
}) {
  return (
    <section className="panel-card-stack">
      <h3 className="font-semibold text-xs text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-2">
        {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => (
          <PriceCard key={item.title} {...item} formatPrice={formatPrice} />
        ))}
      </div>
    </section>
  );
}

export function PricesPanel({ locale }: Props) {
  const p = panelStrings(locale);
  const money = (n: number) => formatMoney(n, locale);

  return (
    <div id="panel-prices" className="panel-page-stack">
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="panel-form-header">
          <div className="panel-form-header-icon">
            <Coins className="w-5 h-5 text-indigo-600" />
          </div>
          <h2 className="text-base font-semibold tracking-tight text-slate-900">{p.pricesTitle}</h2>
          <p className="text-slate-400 text-[11px] leading-snug">{p.pricesSubtitle}</p>
        </div>

        <div className="space-y-6 pt-2">
          <TariffSection title={p.sectionGroup} items={priceTariffs.group} formatPrice={money} />
          <TariffSection title={p.sectionPrivate} items={priceTariffs.privateLesson} formatPrice={money} />
          <TariffSection title={p.sectionPackage} items={priceTariffs.privatePackage} formatPrice={money} />
          <TariffSection title={p.sectionSingle} items={priceTariffs.singleVisit} formatPrice={money} />
        </div>
      </div>
    </div>
  );
}
