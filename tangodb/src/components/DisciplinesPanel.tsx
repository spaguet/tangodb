import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, Edit, Trash2, X } from "lucide-react";
import {
  useDeleteDiscipline,
  useDisciplines,
  useUpdateDiscipline,
} from "../hooks/useDisciplines";
import ConfirmDialog from "./ui/ConfirmDialog";
import RequirePermission from "./RequirePermission";
import LoadingState from "./ui/LoadingState";
import QueryErrorState from "./ui/QueryErrorState";
import { descriptionFieldCls, fieldCls as inputCls } from "./ui/AppSelect";
import { btnAddCls, btnCancelCls } from "./ui/buttonStyles";
import { useI18n } from "../hooks/useI18n";
import { resolveMutationError } from "../lib/resolveMutationError";
import type { ToastType } from "../App";
import type { Discipline } from "../types";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

interface DisciplinesPanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

export default function DisciplinesPanel({ toast }: DisciplinesPanelProps) {
  const { t } = useI18n();
  const { data: disciplines = [], isLoading, isError, error } = useDisciplines();
  const updateDiscipline = useUpdateDiscipline();
  const deleteDiscipline = useDeleteDiscipline();

  const [editing, setEditing] = useState<Discipline | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Discipline | null>(null);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const startEdit = (d: Discipline) => {
    setEditing(d);
    setEditName(d.name);
    setEditDescription(d.description);
    setEditCategory(d.category ?? "");
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const res = await updateDiscipline.mutateAsync({
      id: editing.id,
      name: editName,
      description: editDescription,
      category: editCategory,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "disciplines.error.saveFailed", t), "error");
    } else {
      toast(t("disciplines.success.updated"), "success");
      setEditing(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await deleteDiscipline.mutateAsync(deleteTarget.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "disciplines.error.deleteFailed", t), "error");
    } else {
      toast(t("disciplines.success.deleted", { name: deleteTarget.name }), "success");
      setDeleteTarget(null);
    }
  };

  if (isLoading) return <LoadingState label={t("disciplines.loading")} />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <>
      <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-500" />
            {t("disciplines.title")}
          </h2>
          <span className="text-[10px] bg-slate-100 text-slate-500 font-sans px-2 py-0.5 rounded-full font-semibold">
            {disciplines.length}
          </span>
        </div>

        {disciplines.length === 0 ? (
          <div className="text-center py-20 text-slate-400 space-y-3">
            <BookOpen className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-sm">
              {t("disciplines.empty")}
              {t("disciplines.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {disciplines.map((d) => (
              <div
                key={d.id}
                className="flex items-start justify-between gap-3 p-2.5 bg-slate-50 rounded-lg border border-slate-100 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{d.name}</p>
                  {d.description ? (
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{d.description}</p>
                  ) : (
                    <p className="text-[11px] text-slate-300 italic mt-0.5">{t("disciplines.noDescription")}</p>
                  )}
                  {d.category ? (
                    <p className="text-[10px] text-indigo-600 mt-0.5 font-semibold">{d.category}</p>
                  ) : null}
                </div>
                <RequirePermission action="disciplines.write" context={{ disciplineId: String(d.id) }}>
                <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => startEdit(d)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
                    title={t("common.edit")}
                    aria-label={`${t("common.edit")} ${d.name}`}
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(d)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                    title={t("common.delete")}
                    aria-label={`${t("common.delete")} ${d.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                </RequirePermission>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditing(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">{t("disciplines.editTitle")}</h3>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="panel-form-stack font-sans">
                <div className="field-stack">
                  <label className={labelCls}>{t("common.name")}</label>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
                </div>
                <div className="field-stack">
                  <label className={labelCls}>{t("common.description")}</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    className={descriptionFieldCls}
                  />
                </div>
                <div className="field-stack">
                  <label className={labelCls}>{t("disciplines.field.category")}</label>
                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    placeholder={t("disciplines.placeholder.category")}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1 text-xs">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={updateDiscipline.isPending}
                  className={`flex-1 ${btnAddCls}`}
                >
                  {updateDiscipline.isPending ? t("common.saving") : t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className={`flex-1 ${btnCancelCls}`}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("disciplines.confirm.deleteTitle")}
        description={
          deleteTarget ? (
            <>
              {t("disciplines.confirm.deleteBody", { name: deleteTarget.name })}
            </>
          ) : (
            ""
          )
        }
        confirmLabel={t("common.delete")}
        pending={deleteDiscipline.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
