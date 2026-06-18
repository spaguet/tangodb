import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { invokeDevFunction } from "../lib/supabase";

export default function KeysPage() {
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"generate" | "payment">("generate");

  const run = async () => {
    setLoading(true);
    setError("");
    setGeneratedKey(null);
    try {
      const fn = mode === "generate" ? "dev-console-generate-key" : "dev-console-issue-key";
      const body =
        mode === "generate"
          ? { note: note || undefined, email: email || undefined }
          : { email, invoice_ref: invoiceRef || undefined, note: note || undefined };
      const result = await invokeDevFunction<{ key: string }>(fn, body);
      setGeneratedKey(result.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-lg space-y-6">
      <h2 className="text-2xl font-bold text-white">Lifetime keys</h2>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("generate")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer ${
            mode === "generate" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"
          }`}
        >
          Generate
        </button>
        <button
          type="button"
          onClick={() => setMode("payment")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer ${
            mode === "payment" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"
          }`}
        >
          Manual payment
        </button>
      </div>

      <div className="space-y-3 bg-slate-900 border border-slate-800 rounded-xl p-4">
        {mode === "payment" && (
          <>
            <label className="block space-y-1">
              <span className="text-xs text-slate-500 uppercase">Customer email *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-500 uppercase">Invoice ref</span>
              <input
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
              />
            </label>
          </>
        )}
        {mode === "generate" && (
          <label className="block space-y-1">
            <span className="text-xs text-slate-500 uppercase">Recipient email (optional)</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-xs text-slate-500 uppercase">Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading || (mode === "payment" && !email.trim())}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {loading ? "…" : mode === "generate" ? "Generate lifetime key" : "Issue key after payment"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {generatedKey && (
        <div className="p-4 bg-emerald-950/50 border border-emerald-800 rounded-xl space-y-2">
          <p className="text-xs text-emerald-400 uppercase font-semibold">Key — copy now</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm font-mono text-emerald-200 break-all">{generatedKey}</code>
            <button type="button" onClick={copy} className="p-2 text-emerald-400 hover:bg-emerald-900/50 rounded cursor-pointer">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
