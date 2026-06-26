import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { invokeDevFunction } from "../lib/supabase";

const EMPTY_TEMPLATE = `{
  "crypto": [
    {
      "coin": "BTC",
      "network": "Bitcoin",
      "address": "bc1qexample..."
    }
  ],
  "bankTransfer": {
    "beneficiary": "Example LLC",
    "bankName": "Example Bank",
    "ibanOrAccount": "GB00EXAMPLE0000000000",
    "swiftOrBic": "EXAMPLEGB",
    "note": "Укажите email регистрации в CRM"
  },
  "mir": {
    "recipient": "Иван Иванов",
    "phoneOrCard": "+7 900 000-00-00",
    "bankName": "Сбербанк",
    "note": "Комментарий: email из CRM"
  },
  "contacts": {
    "email": "support@example.com",
    "telegramUrl": "https://t.me/example",
    "whatsappUrl": "https://wa.me/79000000000"
  }
}`;

export default function PaymentMethodsPage() {
  const [jsonText, setJsonText] = useState(EMPTY_TEMPLATE);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const result = await invokeDevFunction<{ config?: unknown; updated_at?: string | null }>(
          "dev-console-payment-methods",
          { action: "get" }
        );
        if (cancelled) return;
        const config = result.config ?? {};
        const hasKeys = config && typeof config === "object" && Object.keys(config as object).length > 0;
        setJsonText(hasKeys ? JSON.stringify(config, null, 2) : EMPTY_TEMPLATE);
        setUpdatedAt(result.updated_at ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Config must be a JSON object");
      }
      const result = await invokeDevFunction<{ updated_at?: string | null }>("dev-console-payment-methods", {
        action: "update",
        config: parsed,
      });
      setUpdatedAt(result.updated_at ?? null);
      setSuccess("Payment config saved — CRM reads it from platform_payment_methods.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Payment methods</h2>
        <p className="text-xs text-slate-500 mt-1">
          Public payment instructions for CRM purchase page. QR codes are generated client-side from addresses.
        </p>
        {updatedAt && (
          <p className="text-xs text-slate-600 mt-2">Updated: {new Date(updatedAt).toLocaleString()}</p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-3 bg-slate-900 border border-slate-800 rounded-xl p-4">
          <label className="block space-y-1">
            <span className="text-xs text-slate-500 uppercase">Config JSON</span>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={24}
              spellCheck={false}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-200"
            />
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save config"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">{success}</p>}
    </div>
  );
}
