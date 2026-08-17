import { useMemo, useState } from "react";
import { Plus, Pencil, StopCircle } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useScheduleGroups } from "../../hooks/useScheduleGroups";
import {
  useEndTeacherPayRuleEarly,
  useTeacherPayRules,
  useUpsertTeacherPayRule,
} from "../../hooks/useTeacherPayRules";
import {
  teacherPayRuleCanEdit,
  teacherPayRuleStatus,
  teacherPayTeacherShareLabel,
  validateTeacherPayRuleDraft,
  type TeacherPayLessonKind,
  type TeacherPayRule,
  type TeacherPayRuleDraft,
} from "../../lib/teacherPayRules";
import { orgLocalDateString } from "../../lib/orgFinanceDate";
import { useSettings } from "../useSettings";
import { EXPENSE_CATEGORIES, expenseCategoryKey } from "../../lib/expenseCategories";
import type { ExpenseCategory } from "../../types/expense";
import AppSelect, { fieldCls, selectLabelCls } from "../../components/ui/AppSelect";
import { btnAddSoftCls, btnCancelCls, btnAddCls } from "../../components/ui/buttonStyles";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useToast } from "../../App";
import type { I18nKey } from "../../lib/i18n/keys";
import { formatCurrency } from "../../lib/utils";

const emptyDraft = (memberId: string, onDate: string): TeacherPayRuleDraft => ({
  memberId,
  lessonKind: "all",
  disciplineId: null,
  scheduleGroupId: null,
  amountType: "percent",
  value: 0,
  expenseCategory: null,
  validFrom: onDate,
  validTo: null,
});

const TEACHER_PAY_RULE_ERROR_KEYS: Record<string, I18nKey> = {
  valid_from_required: "teacherPayRules.error.valid_from_required",
  invalid_date_range: "teacherPayRules.error.invalid_date_range",
  invalid_value: "teacherPayRules.error.invalid_value",
  invalid_percent: "teacherPayRules.error.invalid_percent",
  invalid_payload: "teacherPayRules.error.invalid",
  invalid_expense_category: "teacherPayRules.error.invalid",
  rule_overlap: "teacherPayRules.error.ruleOverlap",
  active_rule_not_editable: "teacherPayRules.error.activeRuleNotEditable",
  rule_not_found: "teacherPayRules.error.endEarlyFailed",
  end_date_in_past: "teacherPayRules.error.validToBeforeFrom",
  end_date_before_start: "teacherPayRules.error.validToBeforeFrom",
  forbidden: "teacherPayRules.error.saveFailed",
  member_not_found: "teacherPayRules.error.saveFailed",
  invalid_discipline: "teacherPayRules.error.disciplineRequired",
  invalid_schedule_group: "teacherPayRules.error.saveFailed",
  teacher_pay_rule_save_failed: "teacherPayRules.error.saveFailed",
  teacher_pay_rule_end_failed: "teacherPayRules.error.endEarlyFailed",
};

interface TeacherPayRulesPanelProps {
  memberId: string;
  canManage: boolean;
}

export default function TeacherPayRulesPanel({ memberId, canManage }: TeacherPayRulesPanelProps) {
  const { t, formatDate } = useI18n();
  const { settings } = useSettings();
  const orgToday = orgLocalDateString(settings?.timezone ?? "UTC");
  const toast = useToast();
  const rulesQuery = useTeacherPayRules(memberId);
  const disciplinesQuery = useDisciplines();
  const groupsQuery = useScheduleGroups();
  const saveRule = useUpsertTeacherPayRule();
  const endEarly = useEndTeacherPayRuleEarly();
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<TeacherPayRuleDraft | null>(null);
  const [endTarget, setEndTarget] = useState<TeacherPayRule | null>(null);

  const disciplineName = useMemo(
    () => Object.fromEntries((disciplinesQuery.data ?? []).map((d) => [d.id, d.name])),
    [disciplinesQuery.data]
  );
  const groupName = useMemo(
    () => Object.fromEntries((groupsQuery.data ?? []).map((g) => [g.id, g.name.trim() || g.id])),
    [groupsQuery.data]
  );
  const filteredGroups = useMemo(() => {
    const groups = groupsQuery.data ?? [];
    if (!draft?.disciplineId) return groups;
    return groups.filter((g) => g.disciplineId === draft.disciplineId);
  }, [groupsQuery.data, draft?.disciplineId]);

  const rules = rulesQuery.data ?? [];
  const activeRules = rules.filter((rule) => teacherPayRuleStatus(rule, orgToday) === "active");
  const scheduledRules = rules.filter((rule) => teacherPayRuleStatus(rule, orgToday) === "scheduled");
  const pastRules = rules.filter((rule) => teacherPayRuleStatus(rule, orgToday) === "ended");

  const lessonKindLabel = (kind: TeacherPayLessonKind) => t(`teacherPayRules.lessonKind.${kind}`);

  const scopeLabel = (rule: TeacherPayRule) => {
    if (rule.scheduleGroupId) {
      return groupName[rule.scheduleGroupId] ?? rule.scheduleGroupId;
    }
    if (rule.disciplineId) {
      return disciplineName[rule.disciplineId] ?? rule.disciplineId;
    }
    return t("teacherPayRules.scope.all");
  };

  const ruleErrorMessage = (code: string) => {
    const key = TEACHER_PAY_RULE_ERROR_KEYS[code];
    return key ? t(key) : code;
  };

  const openCreate = () => {
    setDraft(emptyDraft(memberId, orgToday));
    setEditorOpen(true);
  };

  const openEdit = (rule: TeacherPayRule) => {
    if (!teacherPayRuleCanEdit(rule, orgToday)) {
      toast(t("teacherPayRules.error.activeRuleNotEditable"), "error");
      return;
    }
    setDraft({
      id: rule.id,
      memberId: rule.memberId,
      lessonKind: rule.lessonKind,
      disciplineId: rule.disciplineId,
      scheduleGroupId: rule.scheduleGroupId,
      amountType: rule.amountType,
      value: rule.value,
      expenseCategory: rule.expenseCategory,
      validFrom: rule.validFrom,
      validTo: rule.validTo,
    });
    setEditorOpen(true);
  };

  const handleSaveRule = async () => {
    if (!draft || saveRule.isPending) return;
    const errors = validateTeacherPayRuleDraft(draft);
    if (errors.length) {
      toast(ruleErrorMessage(errors[0] ?? "invalid_payload"), "error");
      return;
    }
    const result = await saveRule.mutateAsync({ draft });
    if (!result.success) {
      toast(ruleErrorMessage(result.error), "error");
      return;
    }
    toast(t("teacherPayRules.saved"), "success");
    setEditorOpen(false);
    setDraft(null);
  };

  const handleEndEarly = async () => {
    if (!endTarget || endEarly.isPending) return;
    const result = await endEarly.mutateAsync({ ruleId: endTarget.id });
    if (!result.success) {
      toast(ruleErrorMessage(result.error), "error");
      return;
    }
    toast(t("teacherPayRules.endEarlySuccess"), result.alreadyApplied ? "info" : "success");
    setEndTarget(null);
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-800">{t("teacherPayRules.title")}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t("teacherPayRules.subtitle")}</p>
        </div>
        {canManage && (
          <button type="button" onClick={openCreate} className={btnAddSoftCls}>
            <Plus className="w-3.5 h-3.5" />
            {t("teacherPayRules.add")}
          </button>
        )}
      </div>

      {rulesQuery.isLoading ? (
        <p className="text-xs text-slate-500">{t("common.loading.default")}</p>
      ) : rulesQuery.isError ? (
        <p className="text-xs text-red-600">{t("teacherPayRules.error.loadFailed")}</p>
      ) : rules.length === 0 ? (
        <p className="text-xs text-slate-500">{t("teacherPayRules.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {[...activeRules, ...scheduledRules, ...pastRules].map((rule) => {
            const status = teacherPayRuleStatus(rule, orgToday);
            return (
            <li
              key={rule.id}
              className={`rounded-lg border p-2.5 space-y-1 ${
                status === "active" ? "border-indigo-100 bg-white" : "border-slate-100 bg-slate-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">
                    {lessonKindLabel(rule.lessonKind)} · {scopeLabel(rule)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {t("teacherPayRules.studioShare")}:{" "}
                    {rule.amountType === "percent" ? `${rule.value}%` : formatCurrency(rule.value)}
                    {" · "}
                    {t("teacherPayRules.teacherShare")}:{" "}
                    {rule.amountType === "percent"
                      ? teacherPayTeacherShareLabel(rule)
                      : t("teacherPayRules.teacherShareFixedHint")}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {formatDate(rule.validFrom)} — {rule.validTo ? formatDate(rule.validTo) : "∞"}
                    {" · "}
                    {t(`teacherPayRules.status.${status}`)}
                  </p>
                  {rule.expenseCategory ? (
                    <p className="text-[10px] text-amber-700 mt-0.5">
                      {t("teacherPayRules.expenseCategory")}: {t(expenseCategoryKey(rule.expenseCategory))}
                    </p>
                  ) : null}
                </div>
                {canManage && status === "active" && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEndTarget(rule)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50"
                      aria-label={t("teacherPayRules.endEarly")}
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {canManage && status === "scheduled" && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(rule)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                      aria-label={t("common.edit")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
          })}
        </ul>
      )}

      {editorOpen && draft && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
          <p className="text-xs font-semibold text-slate-800">
            {draft.id ? t("teacherPayRules.editTitle") : t("teacherPayRules.createTitle")}
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            <AppSelect
              label={t("teacherPayRules.field.lessonKind")}
              value={draft.lessonKind}
              onChange={(e) => setDraft({ ...draft, lessonKind: e.target.value as TeacherPayLessonKind })}
            >
              <option value="all">{t("teacherPayRules.lessonKind.all")}</option>
              <option value="personal">{t("teacherPayRules.lessonKind.personal")}</option>
              <option value="group">{t("teacherPayRules.lessonKind.group")}</option>
              <option value="single_visit">{t("teacherPayRules.lessonKind.single_visit")}</option>
            </AppSelect>
            <AppSelect
              label={t("teacherPayRules.field.amountType")}
              value={draft.amountType}
              onChange={(e) =>
                setDraft({ ...draft, amountType: e.target.value as TeacherPayRuleDraft["amountType"] })
              }
            >
              <option value="percent">{t("teacherPayRules.amountType.percent")}</option>
              <option value="fixed">{t("teacherPayRules.amountType.fixed")}</option>
            </AppSelect>
            <AppSelect
              label={t("teacherPayRules.field.discipline")}
              value={draft.disciplineId ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  disciplineId: e.target.value || null,
                  scheduleGroupId: null,
                })
              }
            >
              <option value="">{t("teacherPayRules.scope.all")}</option>
              {(disciplinesQuery.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </AppSelect>
            <AppSelect
              label={t("teacherPayRules.field.scheduleGroup")}
              value={draft.scheduleGroupId ?? ""}
              onChange={(e) => setDraft({ ...draft, scheduleGroupId: e.target.value || null })}
            >
              <option value="">{t("teacherPayRules.scope.all")}</option>
              {(filteredGroups).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name.trim() || g.id}
                </option>
              ))}
            </AppSelect>
            <label className="field-stack">
              <span className={selectLabelCls}>{t("teacherPayRules.field.validFrom")}</span>
              <input
                className={fieldCls}
                type="date"
                value={draft.validFrom}
                onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })}
              />
            </label>
            <label className="field-stack">
              <span className={selectLabelCls}>{t("teacherPayRules.field.validTo")}</span>
              <input
                className={fieldCls}
                type="date"
                value={draft.validTo ?? ""}
                onChange={(e) => setDraft({ ...draft, validTo: e.target.value || null })}
              />
            </label>
            <label className="field-stack sm:col-span-2">
              <span className={selectLabelCls}>
                {draft.amountType === "percent"
                  ? t("teacherPayRules.field.studioPercent")
                  : t("teacherPayRules.field.studioFixed")}
              </span>
              <input
                className={fieldCls}
                type="number"
                min={0}
                max={draft.amountType === "percent" ? 100 : undefined}
                step={draft.amountType === "percent" ? 0.1 : 0.01}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) || 0 })}
              />
            </label>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.expenseCategory != null}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  expenseCategory: e.target.checked ? ("rent" as ExpenseCategory) : null,
                })
              }
              className="mt-0.5 rounded border-slate-300 text-indigo-600"
            />
            <span className="text-xs text-slate-700">{t("teacherPayRules.externalRentHint")}</span>
          </label>

          {draft.expenseCategory != null && (
            <AppSelect
              label={t("teacherPayRules.field.expenseCategory")}
              value={draft.expenseCategory}
              onChange={(e) =>
                setDraft({ ...draft, expenseCategory: e.target.value as ExpenseCategory })
              }
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {t(expenseCategoryKey(cat))}
                </option>
              ))}
            </AppSelect>
          )}

          <p className="text-[10px] text-slate-400">{t("teacherPayRules.studioShareHint")}</p>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
            <button
              type="button"
              className={btnCancelCls}
              onClick={() => {
                setEditorOpen(false);
                setDraft(null);
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={btnAddCls}
              disabled={saveRule.isPending}
              onClick={() => void handleSaveRule()}
            >
              {saveRule.isPending ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={endTarget != null}
        title={t("teacherPayRules.endEarlyConfirm.title")}
        description={t("teacherPayRules.endEarlyConfirm.body")}
        confirmLabel={t("teacherPayRules.endEarlyConfirm.confirm")}
        pending={endEarly.isPending}
        onCancel={() => setEndTarget(null)}
        onConfirm={() => void handleEndEarly()}
      />
    </div>
  );
}
