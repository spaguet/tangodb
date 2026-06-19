import { Link } from "react-router-dom";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-10">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded flex items-center justify-center text-white font-sans font-semibold">
            T
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
            <p className="text-xs text-slate-400 font-sans uppercase tracking-wider">{subtitle}</p>
          </div>
        </div>

        {children}

        {footer}
      </div>
    </div>
  );
}

export function AuthLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="text-indigo-600 hover:text-indigo-700 font-medium">
      {children}
    </Link>
  );
}

const inputCls =
  "w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block mb-1";

export function AuthField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className={inputCls}
      />
    </div>
  );
}

export function AuthButton({
  children,
  loading,
  type = "submit",
  variant = "primary",
  onClick,
}: {
  children: React.ReactNode;
  loading?: boolean;
  type?: "button" | "submit";
  variant?: "primary" | "secondary";
  onClick?: () => void;
}) {
  const base =
    "w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-700"
      : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50";

  return (
    <button type={type} onClick={onClick} disabled={loading} className={`${base} ${styles}`}>
      {loading && (
        <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
      )}
      {children}
    </button>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
      {message}
    </div>
  );
}

export function AuthSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
      {message}
    </div>
  );
}
