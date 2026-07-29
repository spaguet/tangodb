import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RefreshCw, Users, X } from "lucide-react";
import type { Client, Subscription, SubscriptionGroupLink } from "../../types";
import ClientAutocomplete from "../ui/ClientAutocomplete";
import DatePickerField from "../ui/DatePickerField";
import { fieldCls } from "../ui/AppSelect";
import { useI18n } from "../../hooks/useI18n";
import { useReplaceSubscriptionPartner } from "../../hooks/useSubscriptionMemberChanges";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatClientName } from "../../lib/utils";
import { isPairGroupSubscription, subscriptionMemberSlots } from "../../lib/subscriptionMembers";
import { getSubscriptionGroupDisplayNames } from "../../lib/scheduleGroups";
import { toISODateLocal } from "../../lib/scheduleWeek";
import type { ToastType } from "../../App";

interface ReplaceSubscriptionPartnerDialogProps {
  subscription: Subscription | null;
  clients: Client[];
  groupNameById: Record<string, string>;
  groupsBySubId: Record<string, SubscriptionGroupLink[]>;
  toast: (msg: string, type?: ToastType) => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function ReplaceSubscriptionPartnerDialog({
  subscription,
  clients,
  groupNameById,
  groupsBySubId,
  toast,
  onClose,
  onSuccess,
}: ReplaceSubscriptionPartnerDialogProps) {
  const { t } = useI18n();
  const replacePartner = useReplaceSubscriptionPartner();
  const today = useMemo(() => toISODateLocal(new Date()), []);

  const memberSlots = useMemo(
    () => (subscription ? subscriptionMemberSlots(subscription) : []),
    [subscription]
  );

  const [outgoingClientId, setOutgoingClientId] = useState("");
  const [newClientQuery, setNewClientQuery] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!subscription) return;
    const defaultOutgoing =
      memberSlots.find((s) => s.slot === 2)?.clientId ?? memberSlots[1]?.clientId ?? "";
    setOutgoingClientId(defaultOutgoing);
    setNewClientQuery("");
    setNewClientId("");
    setEffectiveDate(today);
    setReason("");
  }, [subscription, memberSlots, today]);

  useEffect(() => {
    if (!subscription) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !replacePartner.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subscription, replacePartner.isPending, onClose]);

  if (!subscription || !isPairGroupSubscription(subscription)) return null;

  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const linkedGroupNames = getSubscriptionGroupDisplayNames(
    subscription.id,
    groupsBySubId,
    groupNameById
  );

  const outgoingClient = outgoingClientId ? clientMap[outgoingClientId] : null;
  const incomingClient = newClientId ? clientMap[newClientId] : null;

  const handleSubmit = async () => {
    if (!outgoingClientId) {
      toast(t("subscriptions.partnerReplace.error.selectOutgoing"), "error");
      return;
    }
    if (!newClientId) {
      toast(t("subscriptions.partnerReplace.error.selectIncoming"), "error");
      return;
    }
    if (outgoingClientId === newClientId) {
      toast(t("subscriptions.partnerReplace.error.sameClient"), "error");
      return;
    }
    if (!effectiveDate) {
      toast(t("subscriptions.partnerReplace.error.effectiveDate"), "error");
      return;
    }
    if (effectiveDate < subscription.activationDate) {
      toast(t("subscriptions.partnerReplace.error.beforeActivation"), "error");
      return;
    }

    const res = await replacePartner.mutateAsync({
      subscriptionId: subscription.id,
      outgoingClientId,
      incomingClientId: newClientId,
      effectiveDate,
      reason,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "subscriptions.partnerReplace.error.failed", t), "error");
      return;
    }

    toast(
      res.status === "scheduled"
        ? t("subscriptions.partnerReplace.success.scheduled")
        : t("subscriptions.partnerReplace.success.applied"),
      "success"
    );
    onSuccess();
  };

  return (
    <AnimatePresence>
      {subscription && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-indigo-600 shrink-0" />
                <h2 className="text-base font-semibold text-slate-900">
                  {t("subscriptions.partnerReplace.title")}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 space-y-2 text-[11px] text-slate-600">
              <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                {t("subscriptions.partnerReplace.currentMembers")}
              </p>
              <ul className="space-y-1">
                {memberSlots.map(({ slot, clientId }) => {
                  const client = clientMap[clientId];
                  return (
                    <li key={slot}>
                      {client
                        ? formatClientName(client.lastName, client.firstName)
                        : clientId}
                    </li>
                  );
                })}
              </ul>
              <p>
                {t("subscriptions.partnerReplace.lessonsLeft", {
                  left: subscription.lessonsLeft,
                  total: subscription.lessonsTotal,
                })}
              </p>
              {linkedGroupNames.length > 0 ? (
                <p>{t("subscriptions.partnerReplace.groups", { groups: linkedGroupNames.join(", ") })}</p>
              ) : null}
              <p className="text-amber-700">{t("subscriptions.partnerReplace.warning")}</p>
            </div>

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className={labelCls}>{t("subscriptions.partnerReplace.outgoingLabel")}</span>
                <select
                  value={outgoingClientId}
                  onChange={(e) => setOutgoingClientId(e.target.value)}
                  className={fieldCls}
                >
                  {memberSlots.map(({ slot, clientId }) => {
                    const client = clientMap[clientId];
                    return (
                      <option key={slot} value={clientId}>
                        {client
                          ? formatClientName(client.lastName, client.firstName)
                          : clientId}
                      </option>
                    );
                  })}
                </select>
              </label>

              <ClientAutocomplete
                label={t("subscriptions.partnerReplace.incomingLabel")}
                clients={clients.filter(
                  (c) =>
                    !memberSlots.some((s) => s.clientId === c.id) ||
                    c.id === newClientId
                )}
                query={newClientQuery}
                selectedId={newClientId}
                onQueryChange={(q) => {
                  setNewClientQuery(q);
                  setNewClientId("");
                }}
                onSelect={(c) => {
                  setNewClientId(c.id);
                  setNewClientQuery(`${c.lastName} ${c.firstName}`.trim());
                }}
              />

              <DatePickerField
                label={t("subscriptions.partnerReplace.effectiveDate")}
                value={effectiveDate}
                min={subscription.activationDate}
                onChange={setEffectiveDate}
              />

              <label className="block space-y-1">
                <span className={labelCls}>{t("subscriptions.partnerReplace.reasonLabel")}</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className={`${fieldCls} resize-none`}
                  placeholder={t("subscriptions.partnerReplace.reasonPlaceholder")}
                />
              </label>
            </div>

            {outgoingClient && incomingClient ? (
              <p className="text-[11px] text-slate-500">
                {t("subscriptions.partnerReplace.preview", {
                  outgoing: formatClientName(outgoingClient.lastName, outgoingClient.firstName),
                  incoming: formatClientName(incomingClient.lastName, incomingClient.firstName),
                  date: effectiveDate,
                })}
              </p>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={replacePartner.isPending}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold uppercase rounded-lg cursor-pointer"
              >
                {replacePartner.isPending
                  ? t("subscriptions.partnerReplace.submitPending")
                  : t("subscriptions.partnerReplace.submit")}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={replacePartner.isPending}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase rounded-lg cursor-pointer"
              >
                {t("common.cancel")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
