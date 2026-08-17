import { useEffect, useState } from "react";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useSettings } from "../SettingsProvider";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { btnAddCls } from "../../components/ui/buttonStyles";

export default function SubscriptionSettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings, isLoading, updateSettings, isUpdating } = useSettings();

  const [freezeEnabled, setFreezeEnabled] = useState(true);
  const [freezeMaxCount, setFreezeMaxCount] = useState(1);
  const [freezeMinLessons, setFreezeMinLessons] = useState(8);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setFreezeEnabled(settings.freeze_enabled);
    setFreezeMaxCount(settings.freeze_max_count);
    setFreezeMinLessons(settings.freeze_min_lessons);
    setDirty(false);
  }, [settings]);

  if (isLoading || !settings) return <LoadingState label={t("settings.general.loading")} />;

  const handleSave = async () => {
    const res = await updateSettings({
      freeze_enabled: freezeEnabled,
      freeze_max_count: freezeMaxCount,
      freeze_min_lessons: freezeMinLessons,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "settings.saveError", t), "error");
    } else {
      toast(t("settings.subscriptions.saveSuccess"), "success");
      setDirty(false);
    }
  };

  const policySummary = freezeEnabled
    ? t("settings.subscriptions.policySummary", {
        max: freezeMaxCount,
        min: freezeMinLessons,
      })
    : t("settings.subscriptions.policyDisabled");

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-ink-900">{t("settings.subscriptions.title")}</h2>
        <p className="text-xs text-ink-500 mt-1">{t("settings.subscriptions.subtitle")}</p>
      </div>

      <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-4 space-y-4 font-sans">
        <label className="flex items-start gap-2 text-sm text-ink-700 cursor-pointer">
          <input
            type="checkbox"
            checked={freezeEnabled}
            onChange={(e) => {
              setFreezeEnabled(e.target.checked);
              setDirty(true);
            }}
            className="mt-0.5 rounded border-ink-300 text-gold-700 focus:ring-gold-500"
          />
          <span>
            <span className="font-medium">{t("settings.subscriptions.freezeEnabled")}</span>
            <p className="text-xs text-ink-500 mt-1 leading-relaxed">
              {t("settings.subscriptions.freezeEnabledDescription")}
            </p>
          </span>
        </label>

        <div
          className={`space-y-4 transition-opacity ${freezeEnabled ? "" : "opacity-45 pointer-events-none"}`}
          aria-disabled={!freezeEnabled}
        >
          <div className="field-stack">
            <label className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block">
              {t("settings.subscriptions.freezeMax")}
            </label>
            <input
              type="number"
              min={0}
              value={freezeMaxCount}
              disabled={!freezeEnabled}
              onChange={(e) => {
                setFreezeMaxCount(Number(e.target.value));
                setDirty(true);
              }}
              className="w-full bg-ink-50 border border-ink-200 rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed"
            />
          </div>

          <div className="field-stack">
            <label className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block">
              {t("settings.subscriptions.freezeMin")}
            </label>
            <input
              type="number"
              min={0}
              value={freezeMinLessons}
              disabled={!freezeEnabled}
              onChange={(e) => {
                setFreezeMinLessons(Number(e.target.value));
                setDirty(true);
              }}
              className="w-full bg-ink-50 border border-ink-200 rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed"
            />
          </div>
        </div>

        <p className="text-xs text-ink-500 bg-ink-50 rounded-lg px-3 py-2 leading-relaxed">
          {policySummary}
        </p>

        <RequirePermission action="settings.manage" mode="hide">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || isUpdating}
            className={`w-full ${btnAddCls}`}
          >
            {isUpdating ? t("common.saving") : t("common.save")}
          </button>
        </RequirePermission>
      </div>
    </div>
  );
}
