/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Coins, ShieldCheck, BookmarkCheck } from "lucide-react";
import { Price } from "../types";

interface PricesPanelProps {
  prices: Price[];
  onUpdatePrice: (rowIndex: number, newPrice: number) => Promise<{ success: boolean; error?: string }>;
  toast: (msg: string) => void;
}

// Map key types of database price rows to readable translations
const LABELS_CATALOG: Record<string, { label: string; sub: string; col: string }> = {
  "solo": { label: "Соло Абонемент (4 урока)", sub: "Групповые занятия, полмесяца", col: "group" },
  "solo_8": { label: "Соло Абонемент (8 уроков)", sub: "Групповые занятия, один месяц", col: "group" },
  "pair_hm": { label: "Парный Абонемент (4 урока)", sub: "Групповые занятия, полмесяца", col: "group" },
  "pair_m1": { label: "Парный — Месяц 1 (8 уроков)", sub: "Групповые занятия, первый цикл", col: "group" },
  "pair_m2": { label: "Парный — Месяц 2 (8 уроков)", sub: "Групповые занятия, второй цикл", col: "group" },
  "pair_m3": { label: "Парный — Месяц 3 (8 уроков)", sub: "Групповые занятия, третий цикл", col: "group" },
  "personal_solo": { label: "Индивидуальный Соло Урок", sub: "Приватная сессия (1 ученик)", col: "private" },
  "personal_pair": { label: "Индивидуальный Парный Урок", sub: "Приватная сессия (2 ученика)", col: "private" },
  "personal_trio": { label: "Индивидуальный Трио Урок", sub: "Приватная сессия (3 ученика)", col: "private" }
};

export default function PricesPanel({ prices, onUpdatePrice, toast }: PricesPanelProps) {
  const [editedPrices, setEditedPrices] = useState<Record<number, string>>({});
  const [syncingRows, setSyncingRows] = useState<Record<number, boolean>>({});

  const handleInputChange = (rowIndex: number, val: string) => {
    setEditedPrices({
      ...editedPrices,
      [rowIndex]: val
    });
  };

  const handleSavePrice = async (rowIndex: number, originalValue: number) => {
    const rawValue = editedPrices[rowIndex];
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

    // Trigger state change visually
    setSyncingRows(prev => ({ ...prev, [rowIndex]: true }));
    toast("⏳ Сохранение цены в Google Таблицу...");

    const res = await onUpdatePrice(rowIndex, parsed);
    setSyncingRows(prev => ({ ...prev, [rowIndex]: false }));

    if (!res.success) {
      toast(`⚠️ Ошибка сохранения: ${res.error || "перепроверьте соединение"}`);
    } else {
      toast("✅ Новый тариф успешно записан в базу!");
    }
  };

  const formatCur = (num: number) => {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "VND", maximumFractionDigits: 0 })
      .format(num)
      .replace("VND", "₫");
  };

  // Group columns logic
  const groupPrices = () => {
    const groupItems: { info: any; priceObj: Price }[] = [];
    const privateItems: { info: any; priceObj: Price }[] = [];

    prices.forEach(p => {
      // spreadsheet might identify 8 classes solo row under "solo" label, distinct from 4 classes row
      let lookupKey = p.type.trim();
      if (lookupKey === "solo" && p.lessons === 8) {
        lookupKey = "solo_8";
      }

      const info = LABELS_CATALOG[lookupKey] || { label: p.type, sub: `${p.lessons} занятий`, col: "other" };
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
          <div className="text-center py-16 text-stone-400 italic">
            Загрузка прайс-листа из Google-таблицы...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 font-sans">
            {/* COLUMN 1: GROUP CLASSES PRICES */}
            <div className="space-y-4">
              <h3 className="font-serif font-black text-sm text-wine-900 uppercase tracking-widest border-b border-stone-100 pb-2">
                Групповые занятия
              </h3>

              <div className="space-y-4">
                {groupItems.map(item => {
                  const p = item.priceObj;
                  const currentInputVal = editedPrices[p.row] !== undefined ? editedPrices[p.row] : p.price.toString();
                  const isSyncing = syncingRows[p.row] || false;
                  const isTouched = editedPrices[p.row] !== undefined && editedPrices[p.row] !== p.price.toString();

                  return (
                    <div
                      key={p.row}
                      className="p-4 bg-stone-50/50 rounded-xl border border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <h4 className="font-serif font-bold text-stone-800 text-sm leading-tight">
                          {item.info.label}
                        </h4>
                        <p className="text-[11px] text-stone-400 font-mono tracking-tight font-medium">
                          {item.info.sub} · {formatCur(p.price)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <div className="relative font-mono w-28 text-right">
                          <input
                            type="number"
                            value={currentInputVal}
                            disabled={isSyncing}
                            onChange={(e) => handleInputChange(p.row, e.target.value)}
                            className="w-full bg-white border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-lg px-2.5 py-1.5 text-xs text-right font-bold pr-6 transition-all"
                          />
                          <span className="absolute right-2.5 top-2 text-[10px] font-sans font-medium text-stone-400">₫</span>
                        </div>

                        <button
                          onClick={() => handleSavePrice(p.row, p.price)}
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
                })}
              </div>
            </div>

            {/* COLUMN 2: PRIVATE LESSONS */}
            <div className="space-y-4">
              <h3 className="font-serif font-black text-sm text-wine-900 uppercase tracking-widest border-b border-stone-100 pb-2">
                Индивидуальные уроки (Приваты)
              </h3>

              <div className="space-y-4">
                {privateItems.map(item => {
                  const p = item.priceObj;
                  const currentInputVal = editedPrices[p.row] !== undefined ? editedPrices[p.row] : p.price.toString();
                  const isSyncing = syncingRows[p.row] || false;
                  const isTouched = editedPrices[p.row] !== undefined && editedPrices[p.row] !== p.price.toString();

                  return (
                    <div
                      key={p.row}
                      className="p-4 bg-stone-50/50 rounded-xl border border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <h4 className="font-serif font-bold text-stone-850 text-sm leading-tight">
                          {item.info.label}
                        </h4>
                        <p className="text-[11px] text-stone-400 font-mono tracking-tight font-medium">
                          {item.info.sub} · {formatCur(p.price)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <div className="relative font-mono w-28 text-right">
                          <input
                            type="number"
                            value={currentInputVal}
                            disabled={isSyncing}
                            onChange={(e) => handleInputChange(p.row, e.target.value)}
                            className="w-full bg-white border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-lg px-2.5 py-1.5 text-xs text-right font-bold pr-6 transition-all"
                          />
                          <span className="absolute right-2.5 top-2 text-[10px] font-sans font-medium text-stone-400">₫</span>
                        </div>

                        <button
                          onClick={() => handleSavePrice(p.row, p.price)}
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
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
