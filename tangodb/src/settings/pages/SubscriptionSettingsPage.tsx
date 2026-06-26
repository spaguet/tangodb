import { useEffect, useState } from "react";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useSettings } from "../SettingsProvider";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";

export default function SubscriptionSettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings, isLoading, updateSettings, isUpdating, freezePolicy } = useSettings();

  const [freezeMaxCount, setFreezeMaxCount] = useState(1);
  const [freezeMinLessons, setFreezeMinLessons] = useState(8);
  const [freezeDeductsLesson, setFreezeDeductsLesson] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setFreezeMaxCount(settings.freeze_max_count);
    setFreezeMinLessons(settings.freeze_min_lessons);
    setFreezeDeductsLesson(settings.freeze_deducts_lesson);
    setDirty(false);
  }, [settings]);

  if (isLoading || !settings) return <LoadingState label={t("settings.general.loading")} />;

  const handleSave = async () => {
    const res = await updateSettings({
      freeze_max_count: freezeMaxCount,
      freeze_min_lessons: freezeMinLessons,
      freeze_deducts_lesson: freezeDeductsLesson,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "settings.saveError", t), "error");
    } else {
      toast(t("settings.subscriptions.saveSuccess"), "success");
      setDirty(false);
    }
  };

  const policyDeducts = freezePolicy.freezeDeductsLesson
    ? t("settings.subscriptions.policyDeducts")
    : t("settings.subscriptions.policyNoDeduct");

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t("settings.subscriptions.title")}</h2>
        <p className="text-xs text-slate-500 mt-1">{t("settings.subscriptions.subtitle")}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4 font-sans">
        <div className="field-stack">
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
            {t("settings.subscriptions.freezeMax")}
          </label>
          <input
            type="number"
            min={0}
            value={freezeMaxCount}
            onChange={(e) => {
              setFreezeMaxCount(Number(e.target.value));
              setDirty(true);
            }}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div className="field-stack">
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
            {t("settings.subscriptions.freezeMin")}
          </label>
          <input
            type="number"
            min={0}
            value={freezeMinLessons}
            onChange={(e) => {
              setFreezeMinLessons(Number(e.target.value));
              setDirty(true);
            }}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={freezeDeductsLesson}
            onChange={(e) => {
              setFreezeDeductsLesson(e.target.checked);
              setDirty(true);
            }}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          {t("settings.subscriptions.freezeDeducts")}
        </label>

        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
          {t("settings.subscriptions.policySummary", {
            max: freezePolicy.freezeMaxCount,
            min: freezePolicy.freezeMinLessons,
            deducts: policyDeducts,
          })}
        </p>

        <RequirePermission action="settings.manage" mode="hide">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || isUpdating}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {isUpdating ? t("common.saving") : t("common.save")}
          </button>
        </RequirePermission>
      </div>
    </div>
  );
}
