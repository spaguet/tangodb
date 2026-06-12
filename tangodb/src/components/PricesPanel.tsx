/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Coins } from "lucide-react";
import { usePrices, useUpdatePrice } from "../hooks/usePrices";
import { formatCurrency } from "../lib/utils";
import LoadingState from "./ui/LoadingState";
import type { ToastType } from "../App";
import type { Price } from "../types";

interface PricesPanelProps {
  toast: (msg: string, type?: ToastType) => void;
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
      toast("Введите корректную сумму.", "error");
      return;
    }

    if (parsed === originalValue) {
      toast("Цена не изменилась.", "info");
      return;
    }

    setSyncingRows((prev) => ({ ...prev, [id]: true }));

    const res = await updatePrice.mutateAsync({ id, newPrice: parsed });
    setSyncingRows((prev) => ({ ...prev, [id]: false }));

    if (!res.success) {
      toast(res.error || "Ошибка сохранения, перепроверьте соединение", "error");
    } else {
      toast("Новый тариф записан в базу", "success");
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

  if (isLoading) return <LoadingState label="Загрузка прайс-листа..." />;

  const renderPriceRow = (item: { info: (typeof LABELS_CATALOG)[string]; priceObj: Price }) => {
    const p = item.priceObj;
    const priceId = p.id!;
    const currentInputVal = editedPrices[priceId] !== undefined ? editedPrices[priceId] : p.price.toString();
    const isSyncing = syncingRows[priceId] || false;
    const isTouched = editedPrices[priceId] !== undefined && editedPrices[priceId] !== p.price.toString();

    return (
      <div
        key={priceId}
        className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <h4 className="font-semibold text-slate-800 text-sm leading-tight">{item.info.label}</h4>
          <p className="text-[11px] text-slate-400 font-sans tracking-tight font-normal">
            {item.info.sub} · {formatCurrency(p.price)}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="relative font-sans w-28 text-right">
            <input
              type="number"
              value={currentInputVal}
              disabled={isSyncing}
              onChange={(e) => handleInputChange(priceId, e.target.value)}
              aria-label={`Цена: ${item.info.label}`}
              className="w-full bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-2.5 py-1.5 text-xs text-right font-semibold pr-6 transition-all disabled:opacity-60"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-sans font-normal text-slate-400">₫</span>
          </div>

          <button
            onClick={() => handleSavePrice(priceId, p.price)}
            disabled={isSyncing || !isTouched}
            className={`px-3 py-1.5 rounded-lg text-xs font-sans font-semibold uppercase transition-colors flex items-center gap-1.5 border ${
              isTouched
                ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 cursor-pointer"
                : "bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed"
            }`}
          >
            {isSyncing ? "..." : "Сохранить"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div id="panel-prices" className="space-y-6">
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2.5 text-slate-800 border-b border-slate-100 pb-3 mb-5">
          <Coins className="w-4.5 h-4.5 text-indigo-500" />
          <div>
            <h2 className="text-base font-semibold tracking-tight">Тарифы и прайс-лист</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Изменённые тарифы сразу обновят стоимость на кассе оформления.
            </p>
          </div>
        </div>

        {prices.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">Прайс-лист пуст.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="font-semibold text-xs text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-2">
                Групповые занятия
              </h3>
              <div className="space-y-3">{groupItems.map(renderPriceRow)}</div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-xs text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-2">
                Индивидуальные уроки
              </h3>
              <div className="space-y-3">{privateItems.map(renderPriceRow)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
