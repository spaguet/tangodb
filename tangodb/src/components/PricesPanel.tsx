/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Coins, Edit, Plus, Trash2, X } from "lucide-react";
import { useCreatePrice, useDeletePrice, usePrices, useUpdatePrice, useUpdatePriceMeta } from "../hooks/usePrices";
import {
  formatCurrency,
  generateTariffTypeKey,
  getPriceCategory,
  getPriceDescription,
  getPriceLabel,
} from "../lib/utils";
import ConfirmDialog from "./ui/ConfirmDialog";
import LoadingState from "./ui/LoadingState";
import type { ToastType } from "../App";
import type { Price, PriceCategory } from "../types";

interface PricesPanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

const inputCls =
  "w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

const toggleCls = (selected: boolean) =>
  `py-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer text-center ${
    selected
      ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold"
      : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
  }`;

export default function PricesPanel({ toast }: PricesPanelProps) {
  const { data: prices = [], isLoading } = usePrices();
  const updatePrice = useUpdatePrice();
  const updatePriceMeta = useUpdatePriceMeta();
  const deletePrice = useDeletePrice();
  const createPrice = useCreatePrice();

  const [editedPrices, setEditedPrices] = useState<Record<number, string>>({});
  const [syncingRows, setSyncingRows] = useState<Record<number, boolean>>({});
  const [editingPrice, setEditingPrice] = useState<Price | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Price | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCategory, setNewCategory] = useState<PriceCategory>("group");
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newLessons, setNewLessons] = useState("8");
  const [newPrice, setNewPrice] = useState("");

  useEffect(() => {
    if (!showCreateModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowCreateModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showCreateModal]);

  useEffect(() => {
    if (!showCreateModal) {
      setNewCategory("group");
      setNewLabel("");
      setNewDescription("");
      setNewLessons("8");
      setNewPrice("");
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (!editingPrice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingPrice(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingPrice]);

  const handleInputChange = (id: number, val: string) => {
    setEditedPrices({ ...editedPrices, [id]: val });
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

  const startEditMeta = (p: Price) => {
    setEditingPrice(p);
    setEditLabel(getPriceLabel(p));
    setEditDescription(getPriceDescription(p));
  };

  const handleSaveMeta = async () => {
    if (!editingPrice?.id) return;
    if (!editLabel.trim()) {
      toast("Укажите название тарифа.", "error");
      return;
    }

    const res = await updatePriceMeta.mutateAsync({
      id: editingPrice.id,
      label: editLabel,
      description: editDescription,
    });

    if (!res.success) {
      toast(res.error || "Не удалось сохранить", "error");
    } else {
      toast("Тариф обновлён", "success");
      setEditingPrice(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.id) return;
    const res = await deletePrice.mutateAsync(deleteTarget.id);
    if (!res.success) {
      toast(res.error || "Не удалось удалить тариф", "error");
    } else {
      toast("Тариф удалён", "success");
      setDeleteTarget(null);
    }
  };

  const handleCreateTariff = async () => {
    if (!newLabel.trim()) {
      toast("Укажите название тарифа.", "error");
      return;
    }

    const parsedPrice = parseFloat(newPrice);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      toast("Введите корректную стоимость.", "error");
      return;
    }

    const lessons = newCategory === "group" ? parseInt(newLessons, 10) : 1;
    if (newCategory === "group" && (isNaN(lessons) || lessons < 1)) {
      toast("Укажите количество уроков (не меньше 1).", "error");
      return;
    }

    const res = await createPrice.mutateAsync({
      type: generateTariffTypeKey(),
      lessons,
      price: parsedPrice,
      label: newLabel,
      description: newDescription,
      category: newCategory,
    });

    if (!res.success) {
      toast(res.error || "Не удалось создать тариф", "error");
    } else {
      toast("Тариф добавлен в прайс-лист", "success");
      setShowCreateModal(false);
    }
  };

  const groupPrices = () => {
    const groupItems: { priceObj: Price }[] = [];
    const privateItems: { priceObj: Price }[] = [];

    prices.forEach((p) => {
      const item = { priceObj: p };
      if (getPriceCategory(p) === "private") privateItems.push(item);
      else groupItems.push(item);
    });

    return { groupItems, privateItems };
  };

  const { groupItems, privateItems } = groupPrices();

  if (isLoading) return <LoadingState label="Загрузка прайс-листа..." />;

  const renderPriceRow = (item: { priceObj: Price }) => {
    const p = item.priceObj;
    const priceId = p.id!;
    const currentInputVal = editedPrices[priceId] !== undefined ? editedPrices[priceId] : p.price.toString();
    const isSyncing = syncingRows[priceId] || false;
    const isTouched = editedPrices[priceId] !== undefined && editedPrices[priceId] !== p.price.toString();
    const title = getPriceLabel(p);
    const description = getPriceDescription(p);

    return (
      <div
        key={priceId}
        className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-slate-800 text-sm leading-snug break-words min-w-0 flex-1">
              {title}
            </h4>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => startEditMeta(p)}
                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
                title="Редактировать"
                aria-label={`Редактировать ${title}`}
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(p)}
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                title="Удалить"
                aria-label={`Удалить ${title}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 font-sans tracking-tight font-normal">
            {description}
            {getPriceCategory(p) === "group" ? ` · ${p.lessons} ${p.lessons === 1 ? "урок" : p.lessons < 5 ? "урока" : "уроков"}` : ""}
            {" · "}
            {formatCurrency(p.price)}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
          <div className="relative font-sans w-28 text-right">
            <input
              type="number"
              value={currentInputVal}
              disabled={isSyncing}
              onChange={(e) => handleInputChange(priceId, e.target.value)}
              aria-label={`Цена: ${title}`}
              className="w-full bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-2.5 py-1.5 text-xs text-right font-semibold pr-6 transition-all disabled:opacity-60"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-sans font-normal text-slate-400">
              ₫
            </span>
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
    <div id="panel-prices" className="panel-page-stack">
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 mb-3">
          <div className="flex items-center gap-2.5 text-slate-800 min-w-0">
            <Coins className="w-4.5 h-4.5 text-indigo-500 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">Тарифы и прайс-лист</h2>
              <p className="text-slate-400 text-xs mt-0.5">
                Изменённые тарифы сразу обновят стоимость на кассе оформления.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Добавить тариф
          </button>
        </div>

        {prices.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            <p>Прайс-лист пуст.</p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="mt-3 text-indigo-600 hover:text-indigo-700 text-xs font-semibold uppercase tracking-wider cursor-pointer"
            >
              Добавить первый тариф
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="panel-card-stack">
              <h3 className="font-semibold text-xs text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-2">
                Групповые занятия
              </h3>
              <div className="space-y-3">{groupItems.map(renderPriceRow)}</div>
            </div>

            <div className="panel-card-stack">
              <h3 className="font-semibold text-xs text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-2">
                Индивидуальные уроки
              </h3>
              <div className="space-y-3">{privateItems.map(renderPriceRow)}</div>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {editingPrice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingPrice(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">Редактировать тариф</h3>
                <button
                  type="button"
                  onClick={() => setEditingPrice(null)}
                  aria-label="Закрыть"
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="panel-form-stack font-sans">
                <div className="field-stack">
                  <label className={labelCls}>Название</label>
                  <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className={inputCls} />
                </div>
                <div className="field-stack">
                  <label className={labelCls}>Описание</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    className={`${inputCls} resize-none`}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1 text-xs">
                <button
                  type="button"
                  onClick={handleSaveMeta}
                  disabled={updatePriceMeta.isPending}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {updatePriceMeta.isPending ? "..." : "Принять"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingPrice(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">Новый тариф</h3>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  aria-label="Закрыть"
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="panel-form-stack font-sans">
                <div className="field-stack">
                  <label className={labelCls}>Тип</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewCategory("group")}
                      className={toggleCls(newCategory === "group")}
                    >
                      Групповые уроки
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewCategory("private")}
                      className={toggleCls(newCategory === "private")}
                    >
                      Персональные уроки
                    </button>
                  </div>
                </div>

                <div className="field-stack">
                  <label className={labelCls}>Название</label>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    className={inputCls}
                    autoFocus
                  />
                </div>

                <div className="field-stack">
                  <label className={labelCls}>Описание</label>
                  <textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    rows={2}
                    className={`${inputCls} resize-none`}
                  />
                </div>

                {newCategory === "group" && (
                  <div className="field-stack">
                    <label className={labelCls}>Количество уроков</label>
                    <input
                      type="number"
                      min={1}
                      value={newLessons}
                      onChange={(e) => setNewLessons(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                )}

                <div className="field-stack">
                  <label className={labelCls}>Стоимость</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      className={`${inputCls} pr-8`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">₫</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1 text-xs">
                <button
                  type="button"
                  onClick={handleCreateTariff}
                  disabled={createPrice.isPending}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {createPrice.isPending ? "..." : "Подтвердить"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить тариф?"
        description={
          deleteTarget ? (
            <>
              Тариф{" "}
              <strong className="font-semibold text-slate-800">{getPriceLabel(deleteTarget)}</strong> будет удалён из
              прайс-листа.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Удалить"
        pending={deletePrice.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
