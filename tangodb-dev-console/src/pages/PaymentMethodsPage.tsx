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

const MAX_QR_IMAGE_BYTES = 250 * 1024;

const SHARED_AMOUNT_HINT =
  "QR и номер счёта общие для lifetime и месяца. Меняется только сумма на экране покупки.";

function MonthlyPriceFields({
  amount,
  currency,
  onAmount,
  onCurrency,
}: {
  amount: string;
  currency: string;
  onAmount: (value: string) => void;
  onCurrency: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field
        label="Сумма / месяц"
        type="number"
        value={amount}
        onChange={onAmount}
        placeholder="29"
      />
      <Field label="Валюта / месяц" value={currency} onChange={onCurrency} placeholder="USD" />
    </div>
  );
}

function QrImageUpload({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [error, setError] = useState("");

  const handleFile = (file: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Загрузите изображение QR.");
      return;
    }
    if (file.size > MAX_QR_IMAGE_BYTES) {
      setError("QR слишком большой. Максимум 250 KB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      onChange(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => setError("Не удалось прочитать файл.");
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="text-xs text-slate-500 uppercase">QR изображение</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
        />
      </label>
      {value && (
        <div className="flex items-center gap-3">
          <img src={value} alt="QR preview" className="h-20 w-20 rounded-lg border border-slate-800 bg-white object-contain p-1" />
          <button
            type="button"
            onClick={() => onChange("")}
            className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Удалить QR
          </button>
        </div>
      )}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

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
      const saved = await savePaymentConfig(config, form.pricingRevision);
      setUpdatedAt(saved.updatedAt);
      setForm(configToFormState(saved.config));
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
          Публичные реквизиты для страницы покупки в CRM. QR хранится как небольшое изображение в конфиге.
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
          <Section
            title="Mini App — доступ с CRM"
            description="Отдельная ежемесячная цена модуля временно не используется. Mini App открывается при купленном доступе к CRM (lifetime или ежемесячная подписка CRM) и выключен на демо 30 дней. Поле в конфиге сохраняется для будущего возврата оплаты модуля."
          >
            <p className="text-sm text-slate-300 leading-relaxed">
              Сумма add-on в конфиге не показывается в CRM, пока модуль входит в лицензию CRM.
            </p>
          </Section>

          <Section
            title="CRM — пожизненно"
            description="Каноническая цена lifetime для витрины. Пер-способные поля ниже могут переопределять сумму для конкретного рельса."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Сумма"
                type="number"
                value={form.crmLifetime.amount}
                onChange={(amount) =>
                  setForm((prev) => ({ ...prev, crmLifetime: { ...prev.crmLifetime, amount } }))
                }
                placeholder="199"
              />
              <Field
                label="Валюта"
                value={form.crmLifetime.currency}
                onChange={(currency) =>
                  setForm((prev) => ({ ...prev, crmLifetime: { ...prev.crmLifetime, currency } }))
                }
                placeholder="USD"
              />
            </div>
          </Section>

          <Section
            title="CRM — ежемесячно"
            description="Каноническая цена месяца CRM. Пока не заполнена, server quote для monthly остаётся fail-closed."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Сумма"
                type="number"
                value={form.crmMonthly.amount}
                onChange={(amount) =>
                  setForm((prev) => ({ ...prev, crmMonthly: { ...prev.crmMonthly, amount } }))
                }
                placeholder="29"
              />
              <Field
                label="Валюта"
                value={form.crmMonthly.currency}
                onChange={(currency) =>
                  setForm((prev) => ({ ...prev, crmMonthly: { ...prev.crmMonthly, currency } }))
                }
                placeholder="USD"
              />
            </div>
          </Section>

          <p className="text-xs text-slate-500 border border-slate-800 rounded-lg px-3 py-2">{SHARED_AMOUNT_HINT}</p>

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
                  {row.id && (
                    <div>
                      <p className="text-xs text-slate-500 uppercase">Method code (crypto id)</p>
                      <p className="text-sm text-slate-300 font-mono break-all">{row.id}</p>
                    </div>
                  )}
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field
                      label="Сумма к оплате (lifetime)"
                      type="number"
                      value={row.amount}
                      onChange={(amount) => updateCrypto(index, { amount })}
                      placeholder="100"
                    />
                    <Field
                      label="Валюта (lifetime)"
                      value={row.currency}
                      onChange={(currency) => updateCrypto(index, { currency })}
                      placeholder="USD, USDT, VND"
                    />
                  </div>
                  <MonthlyPriceFields
                    amount={row.monthlyAmount}
                    currency={row.monthlyCurrency}
                    onAmount={(monthlyAmount) => updateCrypto(index, { monthlyAmount })}
                    onCurrency={(monthlyCurrency) => updateCrypto(index, { monthlyCurrency })}
                  />
                  <QrImageUpload value={row.qrImageUrl} onChange={(qrImageUrl) => updateCrypto(index, { qrImageUrl })} />
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
              <Field
                label="Сумма к оплате (lifetime)"
                type="number"
                value={form.bankTransfer.amount}
                onChange={(amount) =>
                  setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, amount } }))
                }
                placeholder="100"
              />
              <Field
                label="Валюта (lifetime)"
                value={form.bankTransfer.currency}
                onChange={(currency) =>
                  setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, currency } }))
                }
                placeholder="USD"
              />
            </div>
            <MonthlyPriceFields
              amount={form.bankTransfer.monthlyAmount}
              currency={form.bankTransfer.monthlyCurrency}
              onAmount={(monthlyAmount) =>
                setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, monthlyAmount } }))
              }
              onCurrency={(monthlyCurrency) =>
                setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, monthlyCurrency } }))
              }
            />
            <Field
              label="Комментарий к переводу"
              value={form.bankTransfer.note}
              onChange={(note) => setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, note } }))}
              multiline
              placeholder="Укажите email регистрации в CRM"
            />
            <QrImageUpload
              value={form.bankTransfer.qrImageUrl}
              onChange={(qrImageUrl) =>
                setForm((prev) => ({ ...prev, bankTransfer: { ...prev.bankTransfer, qrImageUrl } }))
              }
            />
          </Section>

          <Section title="Перевод на вьетнамский счёт">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Получатель"
                value={form.vietnameseBankTransfer.beneficiary}
                onChange={(beneficiary) =>
                  setForm((prev) => ({
                    ...prev,
                    vietnameseBankTransfer: { ...prev.vietnameseBankTransfer, beneficiary },
                  }))
                }
              />
              <Field
                label="Банк"
                value={form.vietnameseBankTransfer.bankName}
                onChange={(bankName) =>
                  setForm((prev) => ({
                    ...prev,
                    vietnameseBankTransfer: { ...prev.vietnameseBankTransfer, bankName },
                  }))
                }
              />
              <Field
                label="Счёт"
                value={form.vietnameseBankTransfer.accountNumber}
                onChange={(accountNumber) =>
                  setForm((prev) => ({
                    ...prev,
                    vietnameseBankTransfer: { ...prev.vietnameseBankTransfer, accountNumber },
                  }))
                }
              />
              <Field
                label="Сумма к оплате (lifetime)"
                type="number"
                value={form.vietnameseBankTransfer.amount}
                onChange={(amount) =>
                  setForm((prev) => ({
                    ...prev,
                    vietnameseBankTransfer: { ...prev.vietnameseBankTransfer, amount },
                  }))
                }
                placeholder="2500000"
              />
              <Field
                label="Валюта (lifetime)"
                value={form.vietnameseBankTransfer.currency}
                onChange={(currency) =>
                  setForm((prev) => ({
                    ...prev,
                    vietnameseBankTransfer: { ...prev.vietnameseBankTransfer, currency },
                  }))
                }
                placeholder="VND"
              />
            </div>
            <MonthlyPriceFields
              amount={form.vietnameseBankTransfer.monthlyAmount}
              currency={form.vietnameseBankTransfer.monthlyCurrency}
              onAmount={(monthlyAmount) =>
                setForm((prev) => ({
                  ...prev,
                  vietnameseBankTransfer: { ...prev.vietnameseBankTransfer, monthlyAmount },
                }))
              }
              onCurrency={(monthlyCurrency) =>
                setForm((prev) => ({
                  ...prev,
                  vietnameseBankTransfer: { ...prev.vietnameseBankTransfer, monthlyCurrency },
                }))
              }
            />
            <Field
              label="Комментарий"
              value={form.vietnameseBankTransfer.note}
              onChange={(note) =>
                setForm((prev) => ({
                  ...prev,
                  vietnameseBankTransfer: { ...prev.vietnameseBankTransfer, note },
                }))
              }
              multiline
              placeholder="Комментарий: email из CRM"
            />
            <QrImageUpload
              value={form.vietnameseBankTransfer.qrImageUrl}
              onChange={(qrImageUrl) =>
                setForm((prev) => ({
                  ...prev,
                  vietnameseBankTransfer: { ...prev.vietnameseBankTransfer, qrImageUrl },
                }))
              }
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
              <Field
                label="Сумма к оплате (lifetime)"
                type="number"
                value={form.mir.amount}
                onChange={(amount) => setForm((prev) => ({ ...prev, mir: { ...prev.mir, amount } }))}
                placeholder="10000"
              />
              <Field
                label="Валюта (lifetime)"
                value={form.mir.currency}
                onChange={(currency) => setForm((prev) => ({ ...prev, mir: { ...prev.mir, currency } }))}
                placeholder="RUB"
              />
            </div>
            <MonthlyPriceFields
              amount={form.mir.monthlyAmount}
              currency={form.mir.monthlyCurrency}
              onAmount={(monthlyAmount) => setForm((prev) => ({ ...prev, mir: { ...prev.mir, monthlyAmount } }))}
              onCurrency={(monthlyCurrency) =>
                setForm((prev) => ({ ...prev, mir: { ...prev.mir, monthlyCurrency } }))
              }
            />
            <Field
              label="Комментарий"
              value={form.mir.note}
              onChange={(note) => setForm((prev) => ({ ...prev, mir: { ...prev.mir, note } }))}
              multiline
              placeholder="Комментарий: email из CRM"
            />
            <QrImageUpload
              value={form.mir.qrImageUrl}
              onChange={(qrImageUrl) => setForm((prev) => ({ ...prev, mir: { ...prev.mir, qrImageUrl } }))}
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
