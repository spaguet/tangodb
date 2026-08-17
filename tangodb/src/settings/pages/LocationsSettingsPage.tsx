import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MapPin, Edit, Trash2, Plus, X } from "lucide-react";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import {
  useAddLocation,
  useDeleteLocation,
  useLocations,
  useUpdateLocation,
  type Location,
} from "../../hooks/useLocations";
import { fieldCls as inputCls } from "../../components/ui/AppSelect";
import { btnAddCls, btnCancelCls } from "../../components/ui/buttonStyles";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function LocationsSettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data: locations = [], isLoading, isError, error } = useLocations();
  const addLocation = useAddLocation();
  const updateLocation = useUpdateLocation();
  const deleteLocation = useDeleteLocation();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [editing, setEditing] = useState<Location | null>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const handleAdd = async () => {
    const res = await addLocation.mutateAsync({ name: newName, address: newAddress });
    if (!res.success) {
      toast(resolveMutationError(res.error, "settings.locations.addFailed", t), "error");
    } else {
      toast(t("settings.locations.addSuccess"), "success");
      setNewName("");
      setNewAddress("");
      setShowAdd(false);
    }
  };

  const startEdit = (loc: Location) => {
    setEditing(loc);
    setEditName(loc.name);
    setEditAddress(loc.address);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const res = await updateLocation.mutateAsync({
      id: editing.id,
      name: editName,
      address: editAddress,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "settings.saveError", t), "error");
    } else {
      toast(t("settings.locations.updateSuccess"), "success");
      setEditing(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await deleteLocation.mutateAsync(deleteTarget.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "common.deleteFailed", t), "error");
    } else {
      toast(t("settings.locations.deleteSuccess", { name: deleteTarget.name }), "success");
      setDeleteTarget(null);
    }
  };

  if (isLoading) return <LoadingState label={t("attendance.loadingLocations")} />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <div className="panel-card-stack max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t("settings.locations.title")}</h2>
          <p className="text-xs text-slate-500 mt-1">{t("settings.locations.subtitle")}</p>
        </div>
        <RequirePermission action="settings.manage" mode="hide">
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("common.add")}
          </button>
        </RequirePermission>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-2">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-indigo-500" />
            {t("settings.locations.list")}
          </h3>
          <span className="text-[10px] bg-slate-100 text-slate-500 font-sans px-2 py-0.5 rounded-full font-semibold">
            {locations.length}
          </span>
        </div>

        {locations.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">{t("settings.locations.empty")}</p>
        ) : (
          <div className="space-y-1.5">
            {locations.map((loc) => (
              <div
                key={loc.id}
                className="flex items-start justify-between gap-3 p-2.5 bg-slate-50 rounded-lg border border-slate-100 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{loc.name}</p>
                  {loc.address ? (
                    <p className="text-[11px] text-slate-400 mt-0.5">{loc.address}</p>
                  ) : (
                    <p className="text-[11px] text-slate-300 italic mt-0.5">{t("common.noAddress")}</p>
                  )}
                </div>
                <RequirePermission action="settings.manage" mode="hide">
                  <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => startEdit(loc)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
                      aria-label={`${t("common.edit")} ${loc.name}`}
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(loc)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                      aria-label={`${t("common.delete")} ${loc.name}`}
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
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdd(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold text-slate-900">{t("settings.locations.newTitle")}</h3>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="panel-form-stack font-sans">
                <div className="field-stack">
                  <label className={labelCls}>{t("common.name")}</label>
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className={inputCls} />
                </div>
                <div className="field-stack">
                  <label className={labelCls}>{t("common.address")}</label>
                  <input
                    type="text"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleAdd}
                disabled={addLocation.isPending}
                className={`w-full ${btnAddCls}`}
              >
                {addLocation.isPending ? "..." : t("common.add")}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold text-slate-900">{t("settings.locations.editTitle")}</h3>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer"
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
                  <label className={labelCls}>{t("common.address")}</label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={updateLocation.isPending}
                  className={`flex-1 ${btnAddCls}`}
                >
                  {t("common.save")}
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
        open={deleteTarget != null}
        title={t("settings.locations.deleteTitle")}
        description={
          deleteTarget ? t("settings.locations.deleteBody", { name: deleteTarget.name }) : ""
        }
        confirmLabel={t("common.delete")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
