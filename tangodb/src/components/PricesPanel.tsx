/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Coins } from "lucide-react";
import { usePrices, useUpdatePrice } from "../hooks/usePrices";
import { formatCurrency } from "../lib/utils";
import type { Price } from "../types";

interface PricesPanelProps {
  toast: (msg: string) => void;
}

const LABELS_CATALOG: Record<string, { label: string; sub: string; col: string }> = {
  solo: { label: "Соло Абонемент (4 урока)", sub: "Групповые занятия, полмесяца", col: "group" },
  solo_8: { label: "Соло Абонемент (8 уроков)", sub: "Групповые занятия, один месяц", col: "group" },
  pair_hm: { label: "Парный Абонемент (4 урока)", sub: "Групповые занятия, полмесяца", col: "group" },
  pair_m1: { label: "Парный — Месяц 1 (8 уроков)", sub: "Групповые занятия, первый цикл", col: "group" },
  pair_m2: { label: "Парный — Месяц 2 (8 уроков)", sub: "Групповые занятия, второй цикл", col: "group" },
  pair_m3: { label: "Парный — Месяц 3 (8 уроков)", sub: "Групповые занятия, третий цикл", col: "group" },
  personal_solo: { label: "Индивидуальный Соло Урок", sub: "Приватная сессия (1 ученик)", col: "private" },
  personal_pair: { label: "Индивидуальный Парный Урок", sub: "Приватная сессия (2 ученика)", col: "private" },
  personal_trio: { label: "Индивидуальный Трио Урок", sub: "Приватная сессия (3 ученика)", col: "private" },
};

export default function PricesPanel({ toast }: PricesPanelProps) {
  const { data: prices = [], isLoading } = usePrices();
  const updatePrice = useUpdatePrice();

  const [editedPrices, setEditedPrices] = useState<Record<number, string>>({});
  const [syncingRows, setSyncingRows] = useState<Record<number, boolean>>({});

  const handleInputChange = (id: number, val: string) => {
    setEditedPrices({
      ...editedPrices,
      [id]: val,
    });
  };

  const handleSavePrice = async (id: number, originalValue: number) => {
    const rawValue = editedPrices[id];
    if (rawValue === undefined) return;

    const parsed = parseFloat(rawValue);
    if (isNaN(parsed) || parsed < 0) {
      toast("⚠️ Введите корректную сумму цены.");
      return;
    }

    if (parsed === originalValue) {
      toast("ℹ️ Цена не поменялась.");
      return;
    }

    setSyncingRows((prev) => ({ ...prev, [id]: true }));
    toast("⏳ Сохранение цены...");

    const res = await updatePrice.mutateAsync({ id, newPrice: parsed });
    setSyncingRows((prev) => ({ ...prev, [id]: false }));

    if (!res.success) {
      toast(`⚠️ Ошибка сохранения: ${res.error || "перепроверьте соединение"}`);
    } else {
      toast("✅ Новый тариф успешно записан в базу!");
      setEditedPrices((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const groupPrices = () => {
    const groupItems: { info: (typeof LABELS_CATALOG)[string]; priceObj: Price }[] = [];
    const privateItems: { info: (typeof LABELS_CATALOG)[string]; priceObj: Price }[] = [];

    prices.forEach((p) => {
      let lookupKey = p.type.trim();
      if (lookupKey === "solo" && p.lessons === 8) {
        lookupKey = "solo_8";
      }

      const info = LABELS_CATALOG[lookupKey] || {
        label: p.type,
        sub: `${p.lessons} занятий`,
        col: "other",
      };
      const item = { info, priceObj: p };

      if (info.col === "private") {
        privateItems.push(item);
      } else {
        groupItems.push(item);
      }
    });

    return { groupItems, privateItems };
  };

  const { groupItems, privateItems } = groupPrices();

  if (isLoading) return null;

  const renderPriceRow = (item: { info: (typeof LABELS_CATALOG)[string]; priceObj: Price }) => {
    const p = item.priceObj;
    const priceId = p.id!;
    const currentInputVal = editedPrices[priceId] !== undefined ? editedPrices[priceId] : p.price.toString();
    const isSyncing = syncingRows[priceId] || false;
    const isTouched = editedPrices[priceId] !== undefined && editedPrices[priceId] !== p.price.toString();

    return (
      <div
        key={priceId}
        className="p-4 bg-stone-50/50 rounded-xl border border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <h4 className="font-serif font-bold text-stone-800 text-sm leading-tight">{item.info.label}</h4>
          <p className="text-[11px] text-stone-400 font-mono tracking-tight font-medium">
            {item.info.sub} · {formatCurrency(p.price)}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="relative font-mono w-28 text-right">
            <input
              type="number"
              value={currentInputVal}
              disabled={isSyncing}
              onChange={(e) => handleInputChange(priceId, e.target.value)}
              className="w-full bg-white border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-lg px-2.5 py-1.5 text-xs text-right font-bold pr-6 transition-all"
            />
            <span className="absolute right-2.5 top-2 text-[10px] font-sans font-medium text-stone-400">₫</span>
          </div>

          <button
            onClick={() => handleSavePrice(priceId, p.price)}
            disabled={isSyncing || !isTouched}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase transition-all flex items-center gap-1.5 cursor-pointer border ${
              isTouched
                ? "bg-gold-400 hover:bg-gold-500 text-stone-900 border-gold-400"
                : "bg-stone-100/50 text-stone-300 border-stone-150 cursor-not-allowed"
            }`}
          >
            {isSyncing ? "..." : "Save"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div id="panel-prices" className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-gold-100 shadow-sm">
        <div className="flex items-center gap-2.5 text-stone-900 border-b border-stone-50 pb-3 mb-5">
          <Coins className="w-5 h-5 text-gold-500" />
          <div>
            <h2 className="font-serif text-lg font-bold">Тарифы и Прайс-лист</h2>
            <p className="text-stone-400 text-xs font-sans mt-0.5">
              Отрегулируйте тарифы студии. Они мгновенно обновят стоимость абонементов на кассе оформления.
            </p>
          </div>
        </div>

        {prices.length === 0 ? (
          <div className="text-center py-16 text-stone-400 italic">Загрузка прайс-листа...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 font-sans">
            <div className="space-y-4">
              <h3 className="font-serif font-black text-sm text-wine-900 uppercase tracking-widest border-b border-stone-100 pb-2">
                Групповые занятия
              </h3>
              <div className="space-y-4">{groupItems.map(renderPriceRow)}</div>
            </div>

            <div className="space-y-4">
              <h3 className="font-serif font-black text-sm text-wine-900 uppercase tracking-widest border-b border-stone-100 pb-2">
                Индивидуальные уроки (Приваты)
              </h3>
              <div className="space-y-4">{privateItems.map(renderPriceRow)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
