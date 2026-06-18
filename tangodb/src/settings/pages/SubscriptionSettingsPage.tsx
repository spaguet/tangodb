import { useEffect, useState } from "react";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useSettings } from "../SettingsProvider";

export default function SubscriptionSettingsPage() {
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

  if (isLoading || !settings) return <LoadingState label="Загрузка настроек..." />;

  const handleSave = async () => {
    const res = await updateSettings({
      freeze_max_count: freezeMaxCount,
      freeze_min_lessons: freezeMinLessons,
      freeze_deducts_lesson: freezeDeductsLesson,
    });
    if (!res.success) {
      toast(res.error ?? "Не удалось сохранить", "error");
    } else {
      toast("Настройки абонементов сохранены", "success");
      setDirty(false);
    }
  };

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Абонементы</h2>
        <p className="text-xs text-slate-500 mt-1">Политика заморозки в журнале посещений.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4 font-sans">
        <div className="field-stack">
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
            Макс. заморозок на абонемент
          </label>
          <input
            type="number"
            min={0}
            value={freezeMaxCount}
            onChange={(e) => { setFreezeMaxCount(Number(e.target.value)); setDirty(true); }}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div className="field-stack">
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
            Мин. уроков в абонементе для заморозки
          </label>
          <input
            type="number"
            min={0}
            value={freezeMinLessons}
            onChange={(e) => { setFreezeMinLessons(Number(e.target.value)); setDirty(true); }}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={freezeDeductsLesson}
            onChange={(e) => { setFreezeDeductsLesson(e.target.checked); setDirty(true); }}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Заморозка списывает занятие с баланса
        </label>

        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
          Текущая политика: до {freezePolicy.freezeMaxCount} заморозок для абонементов от{" "}
          {freezePolicy.freezeMinLessons} уроков
          {freezePolicy.freezeDeductsLesson ? ", занятие списывается" : ", занятие не списывается"}.
        </p>

        <RequirePermission action="settings.manage" mode="hide">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || isUpdating}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {isUpdating ? "Сохранение..." : "Сохранить"}
          </button>
        </RequirePermission>
      </div>
    </div>
  );
}
