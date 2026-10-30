import { X } from "lucide-react";
import { motion } from "motion/react";
import type { NavItem } from "../../lib/i18n/navHelpers";
import { useI18n } from "../../hooks/useI18n";

type Props = {
  open: boolean;
  items: NavItem[];
  onClose: () => void;
  onPick: (item: NavItem) => void;
  isActive: (item: NavItem) => boolean;
};

export default function PhoneMoreSheet({ open, items, onClose, onPick, isActive }: Props) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:hidden">
      <motion.button
        type="button"
        aria-label={t("nav.aria.closeMenu")}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "tween", duration: 0.2 }}
        className="relative max-h-[70vh] overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-800">{t("phone.more.title")}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("nav.aria.closeMenu")}
            className="rounded-lg bg-slate-50 p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="max-h-[calc(70vh-4rem)] overflow-y-auto px-3 py-3 space-y-1">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <button
                key={`${item.path}-${item.label}`}
                type="button"
                onClick={() => onPick(item)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold cursor-pointer transition-colors ${
                  active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="leading-snug">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </motion.div>
    </div>
  );
}
