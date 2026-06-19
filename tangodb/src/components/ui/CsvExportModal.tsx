import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Copy, Share2, X } from "lucide-react";
import type { ToastType } from "../../App";
import { copyCsvToClipboard, saveCsvFromUserGesture } from "../../lib/exportCsv";
import { hasTelegramDownloadFile, isInsideTelegramClient } from "../../lib/telegram";

interface CsvExportModalProps {
  open: boolean;
  filename: string;
  content: string;
  onClose: () => void;
  onStatus: (msg: string, type?: ToastType) => void;
}

export default function CsvExportModal({
  open,
  filename,
  content,
  onClose,
  onStatus,
}: CsvExportModalProps) {
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveCsvFromUserGesture(content, filename);
      switch (result) {
        case "shared":
          onStatus("Выберите «Сохранить в Файлы» или другое приложение", "success");
          onClose();
          break;
        case "telegram":
          onStatus("Загрузка файла началась в Telegram", "success");
          onClose();
          break;
        case "clipboard":
          onStatus("CSV скопирован — вставьте в Excel или Numbers", "success");
          break;
        case "cancelled":
          onStatus("Сохранение отменено", "info");
          break;
        case "failed":
          onStatus("Не удалось сохранить — попробуйте «Скопировать»", "error");
          break;
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    setCopying(true);
    try {
      const ok = await copyCsvToClipboard(content);
      onStatus(
        ok ? "CSV скопирован — вставьте в Excel или Numbers" : "Не удалось скопировать",
        ok ? "success" : "error"
      );
    } finally {
      setCopying(false);
    }
  };

  const primaryLabel =
    isInsideTelegramClient() && hasTelegramDownloadFile()
      ? "Скачать через Telegram"
      : "Поделиться / Сохранить";

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="csv-export-title"
        >
          <motion.button
            type="button"
            aria-label="Закрыть"
            className="absolute inset-0 bg-slate-900/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="relative w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-xl p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 id="csv-export-title" className="text-base font-semibold text-slate-800">
                  Экспорт CSV
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {isInsideTelegramClient() && hasTelegramDownloadFile()
                    ? "Нажмите кнопку — файл скачается через Telegram или откроется меню «Поделиться»."
                    : "Нажмите кнопку — откроется меню «Поделиться», выберите «Сохранить в Файлы»."}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 break-all">
              {filename}
            </p>

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || copying}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-sans text-sm font-semibold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4" />
                {saving ? "Открываем…" : primaryLabel}
              </button>

              <button
                type="button"
                onClick={handleCopy}
                disabled={saving || copying}
                className="w-full py-3 px-4 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-700 font-sans text-sm font-semibold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Copy className="w-4 h-4" />
                {copying ? "Копируем…" : "Скопировать"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
