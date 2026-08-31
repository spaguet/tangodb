import { useRef, useState } from "react";
import { fieldCls as inputCls } from "../../components/ui/AppSelect";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import { btnAddCls, btnCancelCls } from "../../components/ui/buttonStyles";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import {
  useOrganizationRenterChannel,
  useSaveOrganizationRenterBot,
  useUpdateOrganizationRenterChannel,
} from "../../hooks/useOrganizationRenterChannel";
import {
  useDeleteOrganizationRentalQr,
  useOrganizationRentalQrAssets,
  useUpdateOrganizationRentalQr,
  useUploadOrganizationRentalQr,
} from "../../hooks/useOrganizationRentalQr";
import { resolveMutationError } from "../../lib/resolveMutationError";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export default function MiniAppChannelSection() {
  const { t } = useI18n();
  const toast = useToast();
  const channelQuery = useOrganizationRenterChannel();
  const qrQuery = useOrganizationRentalQrAssets();
  const saveChannel = useUpdateOrganizationRenterChannel();
  const saveBot = useSaveOrganizationRenterBot();
  const uploadQr = useUploadOrganizationRentalQr();
  const updateQr = useUpdateOrganizationRentalQr();
  const deleteQr = useDeleteOrganizationRentalQr();
  const fileRef = useRef<HTMLInputElement>(null);

  const [chatUrl, setChatUrl] = useState<string | null>(null);
  const [shortName, setShortName] = useState<string | null>(null);
  const [botToken, setBotToken] = useState("");
  const [qrLabel, setQrLabel] = useState("");
  const [qrActive, setQrActive] = useState(true);

  const channel = channelQuery.data;
  const shownChat = chatUrl ?? channel?.telegramChatUrl ?? "";
  const shownShort = shortName ?? channel?.appShortName ?? "";

  const handleSaveChannel = async () => {
    const res = await saveChannel.mutateAsync({
      telegramChatUrl: shownChat,
      appShortName: shownShort,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "hallRent.miniapp.error.saveChannel", t), "error");
      return;
    }
    toast(t("hallRent.miniapp.channelSaved"), "success");
  };

  const handleSaveBot = async () => {
    const token = botToken.trim();
    if (!token) {
      toast(t("hallRent.miniapp.botTokenPlaceholder"), "error");
      return;
    }
    const res = await saveBot.mutateAsync({
      botToken: token,
      appShortName: shownShort || undefined,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "hallRent.miniapp.error.saveBot", t), "error");
      return;
    }
    setBotToken("");
    toast(t("hallRent.miniapp.botSaved"), "success");
  };

  const handleCopyUrl = async () => {
    if (!channel?.miniappUrl) return;
    try {
      await navigator.clipboard.writeText(channel.miniappUrl);
      toast(t("common.copied"), "success");
    } catch {
      toast(t("hallRent.miniapp.error.copyUrl"), "error");
    }
  };

  const handleUploadQr = async (file: File) => {
    try {
      const contentBase64 = await fileToBase64(file);
      const res = await uploadQr.mutateAsync({
        label: qrLabel.trim(),
        isActive: qrActive,
        filename: file.name,
        contentBase64,
      });
      if (!res.success) {
        toast(resolveMutationError(res.error, "hallRent.miniapp.error.qrUpload", t), "error");
        return;
      }
      setQrLabel("");
      toast(t("hallRent.miniapp.qrUploaded"), "success");
    } catch {
      toast(t("hallRent.miniapp.error.qrUpload"), "error");
    }
  };

  if (channelQuery.isLoading) return <LoadingState label={t("hallRent.miniapp.loading")} />;
  if (channelQuery.isError) return <QueryErrorState error={channelQuery.error} />;

  return (
    <div className="space-y-4">
      <div className="field-stack">
        <label className={labelCls} htmlFor="renter-chat-url">
          {t("hallRent.miniapp.chatUrl")}
        </label>
        <input
          id="renter-chat-url"
          className={inputCls}
          value={shownChat}
          onChange={(e) => setChatUrl(e.target.value)}
        />
        <p className="text-[10px] text-slate-400">{t("hallRent.miniapp.chatUrlHint")}</p>
      </div>

      <div className="field-stack">
        <label className={labelCls} htmlFor="renter-app-short">
          {t("hallRent.miniapp.appShortName")}
        </label>
        <input
          id="renter-app-short"
          className={inputCls}
          value={shownShort}
          placeholder={t("hallRent.miniapp.appShortNamePlaceholder")}
          onChange={(e) => setShortName(e.target.value)}
        />
        <p className="text-[10px] text-slate-400">{t("hallRent.miniapp.appShortNameHint")}</p>
      </div>

      <button
        type="button"
        className={btnAddCls}
        disabled={saveChannel.isPending}
        onClick={() => {
          void handleSaveChannel();
        }}
      >
        {t("hallRent.miniapp.saveChannel")}
      </button>

      <div className="field-stack">
        <span className={labelCls}>{t("hallRent.miniapp.miniappUrl")}</span>
        {channel?.miniappUrl ? (
          <div className="flex flex-wrap gap-2 items-center">
            <code className="text-[11px] text-slate-700 break-all">{channel.miniappUrl}</code>
            <button type="button" className={btnAddCls} onClick={() => void handleCopyUrl()}>
              {t("hallRent.miniapp.copyUrl")}
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-400">{t("hallRent.miniapp.miniappUrlEmpty")}</p>
        )}
        <p className="text-[10px] text-slate-400">{t("hallRent.miniapp.botfatherHint")}</p>
      </div>

      <div className="field-stack">
        <label className={labelCls} htmlFor="renter-bot-token">
          {t("hallRent.miniapp.botToken")}
        </label>
        {channel?.tokenSet ? (
          <p className="text-xs text-slate-600">
            {t("hallRent.miniapp.botTokenSet", { last4: channel.tokenLast4 ?? "" })}
          </p>
        ) : null}
        <input
          id="renter-bot-token"
          className={inputCls}
          type="password"
          autoComplete="off"
          value={botToken}
          placeholder={t("hallRent.miniapp.botTokenPlaceholder")}
          onChange={(e) => setBotToken(e.target.value)}
        />
      </div>

      <button
        type="button"
        className={btnAddCls}
        disabled={saveBot.isPending}
        onClick={() => {
          void handleSaveBot();
        }}
      >
        {t("hallRent.miniapp.saveBot")}
      </button>

      <div className="border-t border-slate-100 pt-3 space-y-3">
        <h4 className="text-sm font-semibold text-slate-800">{t("hallRent.miniapp.qrLibrary")}</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="field-stack">
            <label className={labelCls} htmlFor="renter-qr-label">
              {t("hallRent.miniapp.qrLabel")}
            </label>
            <input
              id="renter-qr-label"
              className={inputCls}
              value={qrLabel}
              onChange={(e) => setQrLabel(e.target.value)}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 mt-5">
            <input
              type="checkbox"
              checked={qrActive}
              onChange={(e) => setQrActive(e.target.checked)}
            />
            {t("hallRent.miniapp.qrActive")}
          </label>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleUploadQr(file);
          }}
        />
        <button
          type="button"
          className={btnAddCls}
          disabled={uploadQr.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {t("hallRent.miniapp.qrUpload")}
        </button>

        {qrQuery.isLoading ? (
          <p className="text-xs text-slate-400">{t("common.loading.default")}</p>
        ) : qrQuery.data && qrQuery.data.length === 0 ? (
          <p className="text-xs text-slate-400">{t("hallRent.miniapp.qrEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {(qrQuery.data ?? []).map((asset) => (
              <li
                key={asset.id}
                className="rounded-lg border border-slate-100 p-3 flex flex-wrap gap-3 items-start"
              >
                {asset.signedUrl ? (
                  <img
                    src={asset.signedUrl}
                    alt={asset.label ?? t("hallRent.miniapp.qrLibrary")}
                    className="w-16 h-16 object-contain rounded border border-slate-100"
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-semibold text-slate-800">
                    {asset.label || t("hallRent.miniapp.qrLabel")}
                  </p>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={asset.isActive}
                      disabled={updateQr.isPending}
                      onChange={(e) => {
                        void updateQr.mutateAsync({ id: asset.id, isActive: e.target.checked }).then((res) => {
                          if (!res.success) {
                            toast(resolveMutationError(res.error, "hallRent.miniapp.error.qrUpdate", t), "error");
                          }
                        });
                      }}
                    />
                    {t("hallRent.miniapp.qrActive")}
                  </label>
                </div>
                <button
                  type="button"
                  className={btnCancelCls}
                  disabled={deleteQr.isPending}
                  onClick={() => {
                    void deleteQr.mutateAsync(asset.id).then((res) => {
                      if (!res.success) {
                        toast(resolveMutationError(res.error, "hallRent.miniapp.error.qrDelete", t), "error");
                        return;
                      }
                      toast(t("hallRent.miniapp.qrDeleted"), "success");
                    });
                  }}
                >
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
