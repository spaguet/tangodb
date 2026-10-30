import { createContext, useContext } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export const ToastContext = createContext<((msg: string, type?: ToastType) => void) | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a workspace layout");
  return ctx;
}

export const TOAST_STYLES: Record<ToastType, { icon: typeof Info; accent: string }> = {
  success: { icon: CheckCircle2, accent: "text-green-600" },
  error: { icon: AlertTriangle, accent: "text-rose-600" },
  info: { icon: Info, accent: "text-indigo-500" },
};
