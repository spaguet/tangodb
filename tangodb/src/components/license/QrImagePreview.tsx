import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { btnAddCls } from "../ui/buttonStyles";

function qrDownloadFilename(dataUrl: string): string {
  const match = /^data:image\/(\w+);/i.exec(dataUrl);
  const ext = match?.[1]?.toLowerCase() === "jpeg" ? "jpg" : match?.[1]?.toLowerCase() ?? "png";
  return `payment-qr.${ext}`;
}

function downloadQrImage(dataUrl: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = qrDownloadFilename(dataUrl);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function QrImagePreview({ value }: { value?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!value) return null;

  const label = t("license.payment.field.qr");

  return (
    <>
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-slate-100 bg-white p-2 cursor-pointer transition-colors hover:border-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          aria-label={label}
        >
          <img src={value} alt={label} className="w-36 h-36 object-contain" />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ y: 12, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl p-4 w-full max-w-sm panel-card-stack"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute top-3 right-3 rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>

              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 pr-8">{label}</p>

              <div className="mt-3 flex justify-center rounded-lg border border-slate-100 bg-white p-4">
                <img src={value} alt={label} className="w-full max-w-[min(80vw,320px)] aspect-square object-contain" />
              </div>

              <button
                type="button"
                onClick={() => downloadQrImage(value)}
                className={`mt-4 w-full ${btnAddCls}`}
              >
                <Download className="w-4 h-4" />
                {t("license.payment.qr.download")}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
