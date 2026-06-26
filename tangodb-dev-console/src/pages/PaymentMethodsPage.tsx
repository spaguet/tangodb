import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Field, Section } from "../components/FormField";
import {
  configToFormState,
  emptyCryptoRow,
  emptyPaymentConfigForm,
  formStateToConfig,
  type PaymentConfigFormState,
} from "../lib/paymentConfig";
import { loadPaymentConfig, savePaymentConfig, supabaseEnvError } from "../lib/supabase";

export default function PaymentMethodsPage() {
  const [form, setForm] = useState<PaymentConfigFormState>(emptyPaymentConfigForm);
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
        const result = await loadPaymentConfig();
        if (cancelled) return;
        setForm(configToFormState(result.config));
        setUpdatedAt(result.updatedAt);
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

  const updateCrypto = (index: number, patch: Partial<PaymentConfigFormState["crypto"][number]>) => {
    setForm((prev) => ({
      ...prev,
      crypto: prev.crypto.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const config = formStateToConfig(form);
      const nextUpdatedAt = await savePaymentConfig(config);
      setUpdatedAt(nextUpdatedAt);
      setSuccess("Реквизиты сохранены — CRM подхватит их на странице покупки.");
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
          Публичные реквизиты для страницы покупки в CRM. QR-коды генерируются на клиенте из адресов.
        </p>
        {updatedAt && (
          <p className="text-xs text-slate-600 mt-2">Обновлено: {new Date(updatedAt).toLocaleString("ru-RU")}</p>
        )}
      </div>

      {supabaseEnvError && (
        <p className="text-sm text-amber-400 bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2">
          {supabaseEnvError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Загрузка…</p>
      ) : (
        <div className="space-y-4">
          <Section title="Криптовалюта" description="Один блок = одна монета/сеть. QR строится из адреса или URI template.">
            <div className="space-y-4">
              {form.crypto.map((row, index) => (
                <div key={index} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-400">Кошелёк {index + 1}</p>
                    {form.crypto.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            crypto: prev.crypto.filter((_, i) => i !== index),
                          }))
                        }
                        className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Удалить
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field
                      label="Монета"
                      value={row.coin}
                      onChange={(coin) => updateCrypto(index, { coin })}
                      placeholder="BTC, ETH, USDT_TRC20, TON"
                    />
                    <Field
                      label="Сеть"
                      value={row.network}
                      onChange={(network) => updateCrypto(index, { network })}
                      placeholder="Bitcoin, TRC20, ERC20"
                    />
                  </div>
                  <Field
                    label="Адрес"
                    value={row.address}
                    onChange={(address) => updateCrypto(index, { address })}
                    placeholder="bc1q… / 0x… / T…"
                  />
                  <Field
                    label="URI template (опционально)"
                    value={row.uriTemplate}
                    onChange={(uriTemplate) => updateCrypto(index, { uriTemplate })}
                    placeholder="ton://transfer/… или bitcoin:…"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    crypto: [...prev.crypto, emptyCryptoRow()],
                  }))
                }
                className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Добавить кошелёк
              </button>
            </div>
          </Section>

          <Section title="Банковский перевод / MasterCard">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Получатель"
                value={form.bankTransfer.beneficiary}
                onChange={(beneficiary) =>
                  setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, beneficiary } }))
                }
              />
              <Field
                label="Банк"
                value={form.bankTransfer.bankName}
                onChange={(bankName) =>
                  setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, bankName } }))
                }
              />
              <Field
                label="Счёт / IBAN"
                value={form.bankTransfer.ibanOrAccount}
                onChange={(ibanOrAccount) =>
                  setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, ibanOrAccount } }))
                }
              />
              <Field
                label="SWIFT / BIC"
                value={form.bankTransfer.swiftOrBic}
                onChange={(swiftOrBic) =>
                  setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, swiftOrBic } }))
                }
              />
              <Field
                label="Карта (last4)"
                value={form.bankTransfer.cardLast4}
                onChange={(cardLast4) =>
                  setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, cardLast4 } }))
                }
                placeholder="1234"
              />
            </div>
            <Field
              label="Комментарий к переводу"
              value={form.bankTransfer.note}
              onChange={(note) => setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, note } }))}
              multiline
              placeholder="Укажите email регистрации в CRM"
            />
          </Section>

          <Section title="МИР">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Получатель"
                value={form.mir.recipient}
                onChange={(recipient) => setForm((prev) => ({ ...prev, mir: { ...prev.mir, recipient } }))}
              />
              <Field
                label="Телефон / карта"
                value={form.mir.phoneOrCard}
                onChange={(phoneOrCard) => setForm((prev) => ({ ...prev, mir: { ...prev.mir, phoneOrCard } }))}
              />
              <Field
                label="Банк"
                value={form.mir.bankName}
                onChange={(bankName) => setForm((prev) => ({ ...prev, mir: { ...prev.mir, bankName } }))}
              />
            </div>
            <Field
              label="Комментарий"
              value={form.mir.note}
              onChange={(note) => setForm((prev) => ({ ...prev, mir: { ...prev.mir, note } }))}
              multiline
              placeholder="Комментарий: email из CRM"
            />
          </Section>

          <Section title="Контакты разработчика">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Email"
                type="email"
                value={form.contacts.email}
                onChange={(email) => setForm((prev) => ({ ...prev, contacts: { ...prev.contacts, email } }))}
                placeholder="support@example.com"
              />
              <Field
                label="Telegram URL"
                type="url"
                value={form.contacts.telegramUrl}
                onChange={(telegramUrl) =>
                  setForm((prev) => ({ ...prev, contacts: { ...prev.contacts, telegramUrl } }))
                }
                placeholder="https://t.me/username"
              />
              <Field
                label="WhatsApp URL"
                type="url"
                value={form.contacts.whatsappUrl}
                onChange={(whatsappUrl) =>
                  setForm((prev) => ({ ...prev, contacts: { ...prev.contacts, whatsappUrl } }))
                }
                placeholder="https://wa.me/79000000000"
              />
            </div>
          </Section>

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !!supabaseEnvError}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Сохранение…" : "Сохранить реквизиты"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">{success}</p>}
    </div>
  );
}
