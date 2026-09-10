import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import { btnPrimaryCls, btnSecondaryCls, fieldCls, panelCls, sectionTitleCls } from "../../lib/crmUi";
import { formatMoney } from "../../lib/format";
import { rpcGetRentalQrAccessUrl, rpcListActiveQr, rpcSubmitTopup } from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import { resolveTopupAmountMax } from "../../lib/topupLimits";
import { formatTopupAmount } from "../../lib/quoteBalance";
import { qrDownloadFilename, resolveOrgRentalQrUrl } from "../../lib/qrUrl";
import { isStudioQrSignedUrl } from "../../lib/qrProxy";
import { copyText, downloadQrToDevice, openStudioChat, topupDraftMessage } from "../../lib/studioChat";
import type { PendingTopup, QrAsset } from "../../lib/types";
import { t, tFill, type Locale } from "../../i18n/strings";

export type TopupFormProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  supabase: SupabaseClient;
  pendingTopup: PendingTopup | null;
  refreshKey?: number;
  initialAmount?: number | null;
  onInitialAmountConsumed?: () => void;
  onSubmitted?: () => void | Promise<void>;
  onFinished?: () => void;
  showTitle?: boolean;
  framed?: boolean;
};

export default function TopupForm({
  locale,
  bootstrap,
  supabase,
  pendingTopup,
  refreshKey = 0,
  initialAmount,
  onInitialAmountConsumed,
  onSubmitted,
  onFinished,
  showTitle = true,
  framed = true,
}: TopupFormProps) {
  const [qrs, setQrs] = useState<QrAsset[]>([]);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupMethod, setTopupMethod] = useState<"qr" | "cash">("cash");
  const [topupQrId, setTopupQrId] = useState("");
  const [topupMsg, setTopupMsg] = useState<string | null>(null);
  const [topupMsgIsError, setTopupMsgIsError] = useState(false);
  const [topupSubmitting, setTopupSubmitting] = useState(false);
  const [topupSubmitted, setTopupSubmitted] = useState<{
    correlationCode: string;
    amountLabel: string;
    method: "qr" | "cash";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastOpenedChatMessageRef = useRef<string | null>(null);
  const topupFormRef = useRef<HTMLDivElement | null>(null);

  const resolveQrAssetUrl = useCallback(
    async (asset: QrAsset): Promise<Pick<QrAsset, "signed_url" | "download_url">> => {
      const asDisplayUrl = (url: string | null | undefined): string | null => {
        const raw = url?.trim() ?? "";
        if (/^https:\/\//i.test(raw)) return raw;
        if (/^data:image\//i.test(raw)) return raw;
        return null;
      };

      const isTrustedDisplayUrl = (url: string | null | undefined): string | null => {
        const display = asDisplayUrl(url);
        if (!display) return null;
        if (/^data:image\//i.test(display)) return display;
        return isStudioQrSignedUrl(display) ? display : null;
      };

      const cached =
        isTrustedDisplayUrl(asset.signed_url) ?? isTrustedDisplayUrl(asset.download_url);
      if (cached) return { signed_url: cached, download_url: cached };

      try {
        const signed = await resolveOrgRentalQrUrl(supabase, asset);
        const https = asDisplayUrl(signed);
        if (https) return { signed_url: https, download_url: https };
      } catch {
        /* fall through */
      }

      try {
        const viaFunction = await rpcGetRentalQrAccessUrl(supabase, asset.id);
        const display = asDisplayUrl(viaFunction?.displaySrc);
        const download = asDisplayUrl(viaFunction?.downloadUrl) ?? display;
        if (display) return { signed_url: display, download_url: download };
      } catch {
        /* fall through */
      }

      return { signed_url: null, download_url: null };
    },
    [supabase]
  );

  useEffect(() => {
    if (!bootstrap.addonActive) return;
    let cancelled = false;
    (async () => {
      try {
        const assets = await rpcListActiveQr(supabase);
        const resolved = await Promise.all(
          assets.map(async (asset) => ({
            ...asset,
            ...(await resolveQrAssetUrl(asset)),
          }))
        );
        if (cancelled) return;
        setQrs(resolved);
        const firstQrId = resolved[0]?.id ?? "";
        setTopupQrId((prev) =>
          resolved.some((asset) => asset.id === prev) ? prev : firstQrId
        );
        if (firstQrId) {
          setTopupMethod((prev) => (prev === "cash" ? "qr" : prev));
        } else {
          setTopupMethod((prev) => (prev === "qr" ? "cash" : prev));
        }
      } catch {
        if (cancelled) return;
        setQrs([]);
        setTopupQrId("");
        setTopupMethod("cash");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, bootstrap.addonActive, resolveQrAssetUrl, refreshKey]);

  useEffect(() => {
    if (initialAmount == null || initialAmount <= 0) return;
    setTopupAmount(formatTopupAmount(initialAmount));
    onInitialAmountConsumed?.();
  }, [initialAmount, onInitialAmountConsumed]);

  const draftForAmount = (amountLabel: string, correlationCode?: string) =>
    topupDraftMessage({ locale, amountLabel, method: topupMethod, correlationCode });

  const resolveActiveQrId = useCallback(
    () => topupQrId || qrs[0]?.id || "",
    [topupQrId, qrs]
  );

  const showTopupValidation = (message: string) => {
    setTopupMsgIsError(true);
    setTopupMsg(message);
    topupFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const parsedAmount = (): number | null => {
    const amount = Number(topupAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return amount;
  };

  const selectTopupMethod = (method: "qr" | "cash") => {
    setTopupMsg(null);
    setTopupMsgIsError(false);
    if (method === "qr") {
      const nextQrId = resolveActiveQrId();
      if (nextQrId) setTopupQrId(nextQrId);
    }
    setTopupMethod(method);
  };

  const openChatWithMessage = async (message: string) => {
    const url = bootstrap.chatUrl;
    if (!url) {
      setError(t(locale, "topupNeedChat"));
      return false;
    }
    if (lastOpenedChatMessageRef.current === message) {
      return true;
    }
    const copied = await copyText(message);
    openStudioChat(url);
    lastOpenedChatMessageRef.current = message;
    setTopupMsg(copied ? t(locale, "topupCopied") : null);
    setTopupMsgIsError(false);
    return true;
  };

  const openReceiptChat = async () => {
    setError(null);
    const amount = parsedAmount();
    if (amount == null) {
      showTopupValidation(t(locale, "topupAmountRequired"));
      return;
    }
    const amountLabel = formatMoney(amount, bootstrap.currencyCode, locale);
    await openChatWithMessage(draftForAmount(amountLabel));
  };

  const refreshQrUrl = useCallback(
    async (asset: QrAsset): Promise<string | null> => {
      const next = await resolveQrAssetUrl(asset);
      setQrs((prev) =>
        prev.map((item) => (item.id === asset.id ? { ...item, ...next } : item))
      );
      return next.signed_url;
    },
    [resolveQrAssetUrl]
  );

  const submitTopup = async () => {
    setTopupMsg(null);
    setTopupMsgIsError(false);
    setError(null);
    const amount = parsedAmount();
    if (amount == null) {
      showTopupValidation(t(locale, "topupAmountRequired"));
      return;
    }
    const amountLabel = formatMoney(amount, bootstrap.currencyCode, locale);
    const topupMax = resolveTopupAmountMax(bootstrap.currencyCode, bootstrap.topupMaxAmount);
    if (amount > topupMax) {
      showTopupValidation(
        tFill(locale, "topupAmountTooLarge", {
          max: formatMoney(topupMax, bootstrap.currencyCode, locale),
        })
      );
      return;
    }
    const activeQrId = resolveActiveQrId();
    if (topupMethod === "qr" && !bootstrap.chatUrl) {
      showTopupValidation(t(locale, "topupNeedChat"));
      return;
    }
    if (topupMethod === "qr" && !activeQrId) {
      showTopupValidation(t(locale, "topupQrInvalid"));
      return;
    }
    if (topupMethod === "qr" && activeQrId !== topupQrId) {
      setTopupQrId(activeQrId);
    }
    setTopupSubmitting(true);
    try {
      const result = await rpcSubmitTopup(supabase, {
        amount,
        method: topupMethod,
        ...(topupMethod === "qr" ? { qr_asset_id: activeQrId } : {}),
      });
      setTopupAmount("");
      lastOpenedChatMessageRef.current = null;
      setTopupSubmitted({
        correlationCode: result.correlation_code,
        amountLabel,
        method: topupMethod,
      });
      await onSubmitted?.();
    } catch (err) {
      const key = rpcErrorKey(err);
      const message = t(locale, key);
      if (
        key === "topupAmountRequired" ||
        key === "topupQrInvalid" ||
        key === "topupNeedChat" ||
        key === "topupChatRequired" ||
        key === "topupPendingExists" ||
        key === "topupAmountTooLarge"
      ) {
        showTopupValidation(
          key === "topupAmountTooLarge"
            ? tFill(locale, "topupAmountTooLarge", {
                max: formatMoney(
                  resolveTopupAmountMax(bootstrap.currencyCode, bootstrap.topupMaxAmount),
                  bootstrap.currencyCode,
                  locale
                ),
              })
            : message
        );
      } else {
        setError(message);
      }
    } finally {
      setTopupSubmitting(false);
    }
  };

  const finishSubmitted = () => {
    setTopupSubmitted(null);
    onFinished?.();
  };

  const openSubmittedTopupChat = async () => {
    if (!topupSubmitted) return;
    const message = draftForAmount(topupSubmitted.amountLabel, topupSubmitted.correlationCode);
    const opened = await openChatWithMessage(message);
    if (opened) finishSubmitted();
  };

  const methodActiveCls = "bg-indigo-600 text-white border border-indigo-600";
  const methodIdleCls = "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50";
  const body = (
    <div ref={topupFormRef} className={framed ? `${panelCls} space-y-3 p-3` : "space-y-3"}>
      {showTitle ? <h2 className={sectionTitleCls}>{t(locale, "topup")}</h2> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {pendingTopup ? (
        <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-xs leading-relaxed text-indigo-900">
          {t(locale, "topupPendingBlocked")}
        </p>
      ) : null}
      {!bootstrap.addonActive ? (
        <p className="text-xs text-slate-500">{t(locale, "addonInactiveTopup")}</p>
      ) : (
        <>
          <input
            type="number"
            inputMode="decimal"
            className={fieldCls}
            placeholder={t(locale, "topupAmount")}
            value={topupAmount}
            onChange={(e) => setTopupAmount(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                topupMethod === "cash" ? methodActiveCls : methodIdleCls
              }`}
              onClick={() => selectTopupMethod("cash")}
            >
              {t(locale, "topupMethodCash")}
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                topupMethod === "qr" ? methodActiveCls : methodIdleCls
              }`}
              onClick={() => selectTopupMethod("qr")}
              disabled={qrs.length === 0}
            >
              {t(locale, "topupMethodQr")}
            </button>
          </div>
          {topupMethod === "qr" && qrs.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {qrs.map((q, index) => (
                <button
                  key={q.id}
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    topupQrId === q.id ? methodActiveCls : methodIdleCls
                  }`}
                  onClick={() => setTopupQrId(q.id)}
                >
                  {q.label?.trim() || `${t(locale, "topupMethodQr")} ${index + 1}`}
                </button>
              ))}
            </div>
          ) : null}
          {topupMethod === "qr" && qrs.length === 0 ? (
            <p className="text-xs text-slate-500">{t(locale, "topupNoQr")}</p>
          ) : null}
          {qrs.map((q) =>
            topupMethod === "qr" && q.id === topupQrId ? (
              <StudioQrPreview
                key={q.id}
                locale={locale}
                asset={q}
                refreshUrl={refreshQrUrl}
                onSaved={() => {
                  setTopupMsg(t(locale, "topupQrSaved"));
                  setTopupMsgIsError(false);
                }}
                onSaveFailed={() => setError(t(locale, "topupQrSaveFailed"))}
              />
            ) : null
          )}
          <p className="text-xs leading-relaxed text-slate-600">
            {t(locale, topupMethod === "qr" ? "topupReceiptHint" : "topupCashHint")}
          </p>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-medium leading-relaxed text-amber-900">
            {t(locale, "topupMustSubmitCrm")}
          </p>
          {bootstrap.chatUrl ? (
            <button
              type="button"
              className={`w-full ${btnSecondaryCls}`}
              onClick={() => void openReceiptChat()}
              disabled={Boolean(pendingTopup) || topupSubmitting}
            >
              {t(locale, "topupOpenChat")}
            </button>
          ) : topupMethod === "qr" ? (
            <p className="text-xs leading-relaxed text-amber-800">{t(locale, "topupNeedChat")}</p>
          ) : null}
          <button
            type="button"
            className={`w-full ${btnPrimaryCls}`}
            onClick={() => void submitTopup()}
            disabled={Boolean(pendingTopup) || topupSubmitting}
          >
            {topupSubmitting ? t(locale, "topupSubmitting") : t(locale, "topupSubmit")}
          </button>
          {topupMsg ? (
            <p
              className={`text-xs font-medium ${
                topupMsgIsError ? "text-amber-800" : "text-indigo-600"
              }`}
            >
              {topupMsg}
            </p>
          ) : null}
        </>
      )}

      {topupSubmitted ? (
        <TopupSubmittedSheet
          locale={locale}
          submitted={topupSubmitted}
          chatUrl={bootstrap.chatUrl}
          onOpenChat={() => void openSubmittedTopupChat()}
          onClose={finishSubmitted}
        />
      ) : null}
    </div>
  );

  return body;
}

type TopupSubmittedSheetProps = {
  locale: Locale;
  submitted: { correlationCode: string; amountLabel: string; method: "qr" | "cash" };
  chatUrl: string | null;
  onOpenChat: () => void;
  onClose: () => void;
};

function TopupSubmittedSheet({
  locale,
  submitted,
  chatUrl,
  onOpenChat,
  onClose,
}: TopupSubmittedSheetProps) {
  const bodyKey = submitted.method === "qr" ? "topupSubmittedQrBody" : "topupSubmittedCashBody";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-xl border border-slate-200 bg-white p-4 pb-8 text-slate-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900">{t(locale, "topupSubmittedTitle")}</h2>
        <p className="text-sm font-semibold text-indigo-700">
          {tFill(locale, "topupSubmittedCode", { code: submitted.correlationCode })}
        </p>
        <p className="text-sm leading-relaxed text-slate-600">{t(locale, bodyKey)}</p>
        {chatUrl ? (
          <button type="button" className={`w-full ${btnPrimaryCls}`} onClick={onOpenChat}>
            {t(locale, "topupOpenChat")}
          </button>
        ) : (
          <p className="text-xs leading-relaxed text-amber-800">{t(locale, "topupNeedChat")}</p>
        )}
        <button type="button" className={`w-full ${btnSecondaryCls}`} onClick={onClose}>
          {t(locale, "topupSubmittedDone")}
        </button>
      </div>
    </div>
  );
}

type StudioQrPreviewProps = {
  locale: Locale;
  asset: QrAsset;
  refreshUrl: (asset: QrAsset) => Promise<string | null>;
  onSaved: () => void;
  onSaveFailed: () => void;
};

function StudioQrPreview({ locale, asset, refreshUrl, onSaved, onSaveFailed }: StudioQrPreviewProps) {
  const trustedInitialSrc = (() => {
    const raw = asset.signed_url?.trim() ?? asset.download_url?.trim() ?? "";
    if (/^data:image\//i.test(raw)) return raw;
    if (/^https:\/\//i.test(raw) && isStudioQrSignedUrl(raw)) return raw;
    return null;
  })();
  const [src, setSrc] = useState<string | null>(trustedInitialSrc);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">(
    trustedInitialSrc ? "ready" : "loading"
  );
  const imageRetryUsedRef = useRef(false);
  const refreshUrlRef = useRef(refreshUrl);
  const assetRef = useRef(asset);
  const [saving, setSaving] = useState(false);
  refreshUrlRef.current = refreshUrl;
  assetRef.current = asset;

  useEffect(() => {
    const raw = asset.signed_url?.trim() ?? asset.download_url?.trim() ?? "";
    const cached =
      /^data:image\//i.test(raw)
        ? raw
        : /^https:\/\//i.test(raw) && isStudioQrSignedUrl(raw)
          ? raw
          : null;
    if (cached) {
      setSrc(cached);
      setPhase("ready");
      return;
    }
    let cancelled = false;
    setPhase("loading");
    imageRetryUsedRef.current = false;
    void refreshUrlRef.current(assetRef.current).then(
      (next) => {
        if (cancelled) return;
        setSrc(next);
        setPhase(next ? "ready" : "failed");
      },
      () => {
        if (cancelled) return;
        setSrc(null);
        setPhase("failed");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.signed_url, asset.storage_path, asset.download_url]);

  const saveQr = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const displaySrc =
        src ??
        (await refreshUrlRef.current(assetRef.current).then((next) => {
          setSrc(next);
          setPhase(next ? "ready" : "failed");
          return next;
        }));
      if (!displaySrc) {
        onSaveFailed();
        return;
      }
      const current = assetRef.current;
      const ok = await downloadQrToDevice(
        displaySrc,
        qrDownloadFilename(current.label, current.id),
        current.download_url
      );
      if (ok) onSaved();
      else onSaveFailed();
    } finally {
      setSaving(false);
    }
  };

  const handleImageError = () => {
    if (src?.startsWith("data:") || imageRetryUsedRef.current) {
      setSrc(null);
      setPhase("failed");
      return;
    }
    imageRetryUsedRef.current = true;
    setPhase("loading");
    void refreshUrlRef.current(assetRef.current).then(
      (next) => {
        setSrc(next);
        setPhase(next ? "ready" : "failed");
      },
      () => {
        setSrc(null);
        setPhase("failed");
      }
    );
  };

  return (
    <div className="space-y-2">
      {src && phase !== "failed" ? (
        <img
          src={src}
          alt={asset.label ?? t(locale, "topupMethodQr")}
          className="mx-auto max-h-48 w-auto rounded-lg border border-slate-200 bg-white p-2"
          onError={handleImageError}
        />
      ) : phase === "loading" ? (
        <p className="text-xs text-slate-500">{t(locale, "loading")}</p>
      ) : (
        <p className="text-xs text-amber-800">{t(locale, "topupQrBroken")}</p>
      )}
      <button
        type="button"
        className={`w-full ${btnSecondaryCls}`}
        disabled={saving || phase === "loading"}
        onClick={() => void saveQr()}
      >
        {saving ? t(locale, "topupQrSaving") : t(locale, "topupSaveQr")}
      </button>
      <p className="text-[10px] leading-relaxed text-slate-400">{t(locale, "topupQrSaveWaitHint")}</p>
    </div>
  );
}
