import { useEffect, useState } from "react";
import { Bot, RefreshCw, Save, Send } from "lucide-react";
import { Field, Section } from "../components/FormField";
import { invokeDevFunction, supabaseEnvError } from "../lib/supabase";

interface BotCandidate {
  chatId: number;
  kind: "group" | "private";
  title: string | null;
  username: string | null;
  source: string;
}

interface GetResult {
  telegram_chat_id: number | null;
  title: string | null;
  updated_at: string | null;
  token_configured: boolean;
  blocked_count: number;
}

interface DetectResult {
  ok: boolean;
  reason?: string;
  hint?: string;
  webhook_url?: string | null;
  description?: string | null;
  bot?: { id: number | null; username: string | null };
  candidates?: BotCandidate[];
  token_configured?: boolean;
}

interface SaveResult {
  ok: boolean;
  telegram_chat_id?: number;
}

interface SendTestResult {
  ok: boolean;
  sent?: boolean;
  reason?: string;
  description?: string;
  blocked?: boolean;
  token_configured?: boolean;
  chat_configured?: boolean;
}

function formatCandidate(row: BotCandidate): string {
  const label = row.title || (row.username ? `@${row.username}` : row.kind);
  return `${row.chatId} · ${label} · ${row.source}`;
}

export default function PlatformBotPage() {
  const [chatId, setChatId] = useState("");
  const [title, setTitle] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [blockedCount, setBlockedCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BotCandidate[]>([]);
  const [botName, setBotName] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await invokeDevFunction<GetResult>("dev-console-platform-bot", { action: "get" });
      setChatId(result.telegram_chat_id != null ? String(result.telegram_chat_id) : "");
      setTitle(result.title ?? "");
      setTokenConfigured(result.token_configured);
      setBlockedCount(result.blocked_count ?? 0);
      setUpdatedAt(result.updated_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (action: string) => {
    setBusy(action);
    setError("");
    setSuccess("");
    try {
      if (action === "detect") {
        const result = await invokeDevFunction<DetectResult>("dev-console-platform-bot", {
          action: "detect",
        });
        setBotName(result.bot?.username ?? null);
        setWebhookUrl(result.webhook_url ?? null);
        setCandidates(result.candidates ?? []);
        if (result.reason === "config_missing") {
          setError("Нет PLATFORM_TELEGRAM_BOT_TOKEN в секретах Edge. Заявки и email не ломаются.");
        } else if (result.reason === "webhook_set") {
          setError(result.hint ?? "Снимите webhook, иначе Detect через getUpdates недоступен.");
        } else if (!result.ok && result.reason) {
          setError(result.description ?? result.reason);
        } else if ((result.candidates ?? []).length === 0) {
          setSuccess("Токен жив. Кандидатов нет — добавьте бота в группу или напишите /start в личку, либо вставьте chat_id вручную.");
        } else {
          setSuccess(`Найдено кандидатов: ${result.candidates?.length}. Выберите или вставьте chat_id вручную (канон).`);
        }
        return;
      }

      if (action === "save") {
        const result = await invokeDevFunction<SaveResult>("dev-console-platform-bot", {
          action: "save",
          telegram_chat_id: chatId.trim(),
          title: title.trim() || undefined,
        });
        if (result.telegram_chat_id != null) setChatId(String(result.telegram_chat_id));
        setSuccess("chat_id сохранён в platform_notification_settings. Токен в таблицу не пишется.");
        await load();
        return;
      }

      if (action === "send_test") {
        const result = await invokeDevFunction<SendTestResult>("dev-console-platform-bot", {
          action: "send_test",
        });
        if (result.ok && result.sent) {
          setSuccess("Тестовое сообщение отправлено.");
        } else if (result.reason === "config_missing") {
          setError(
            `config_missing — token: ${result.token_configured ? "есть" : "нет"}, chat_id: ${
              result.chat_configured ? "есть" : "нет"
            }.`
          );
        } else if (result.blocked) {
          setError(`Telegram blocked (${result.reason}). Верните бота в чат и Requeue blocked.`);
        } else {
          setError(result.description ?? result.reason ?? "Send test failed");
        }
        return;
      }

      if (action === "requeue_blocked") {
        const result = await invokeDevFunction<{ requeued: number }>("dev-console-platform-bot", {
          action: "requeue_blocked",
        });
        setSuccess(`Requeue: ${result.requeued} blocked → pending.`);
        await load();
        return;
      }

      if (action === "delete_webhook") {
        const result = await invokeDevFunction<{ ok: boolean; reason?: string }>(
          "dev-console-platform-bot",
          { action: "delete_webhook" }
        );
        if (result.ok) {
          setWebhookUrl(null);
          setSuccess("Webhook снят. Можно Detect.");
        } else {
          setError(result.reason ?? "deleteWebhook failed");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bot className="w-6 h-6" /> Platform bot
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Outbound-only: Detect / paste chat_id / Save / Send test. Username бота в CRM не показывается.
          {supabaseEnvError ? ` ${supabaseEnvError}` : ""}
        </p>
      </div>

      <Section
        title="Статус"
        description="Токен — секрет Edge PLATFORM_TELEGRAM_BOT_TOKEN. Destination — эта таблица."
      >
        <p className="text-sm text-slate-300">
          Token: {tokenConfigured ? "настроен" : "нет (Telegram = blocked / config_missing)"}
        </p>
        {botName && <p className="text-sm text-slate-400">getMe: @{botName} (только Dev Console)</p>}
        <p className="text-sm text-slate-300">Blocked outbox: {blockedCount}</p>
        {updatedAt && <p className="text-xs text-slate-500">Updated {updatedAt}</p>}
        {webhookUrl && (
          <p className="text-sm text-amber-400">
            Webhook установлен: {webhookUrl}. Detect через getUpdates не сработает, пока не снимете webhook.
          </p>
        )}
      </Section>

      <Section
        title="Destination"
        description="Группа chat_id &lt; 0 предпочтительна. Личка &gt; 0 после /start допустима. Ручной paste — канон."
      >
        <Field label="telegram_chat_id" value={chatId} onChange={setChatId} placeholder="-1001234567890" />
        <Field label="Title" value={title} onChange={setTitle} placeholder="developer group" />
        {candidates.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs uppercase text-slate-500">Кандидаты Detect</p>
            {candidates.map((row) => (
              <button
                key={`${row.chatId}-${row.source}`}
                type="button"
                onClick={() => setChatId(String(row.chatId))}
                className="block w-full text-left text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 hover:border-indigo-500 cursor-pointer"
              >
                {formatCandidate(row)}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => void run("detect")}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {busy === "detect" ? "Detect…" : "Detect"}
          </button>
          <button
            type="button"
            onClick={() => void run("save")}
            disabled={Boolean(busy) || !chatId.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => void run("send_test")}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            {busy === "send_test" ? "Sending…" : "Send test"}
          </button>
          <button
            type="button"
            onClick={() => void run("requeue_blocked")}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 cursor-pointer disabled:opacity-50"
          >
            Requeue blocked
          </button>
          {webhookUrl && (
            <button
              type="button"
              onClick={() => void run("delete_webhook")}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-amber-900/60 text-amber-100 hover:bg-amber-800 cursor-pointer disabled:opacity-50"
            >
              Remove webhook
            </button>
          )}
        </div>
      </Section>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}
    </div>
  );
}
