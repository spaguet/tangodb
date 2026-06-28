import type { I18nKey } from "./i18n/keys";
import { normalizeTeacherScope } from "./teacherScope";
import type { AuditLogRow } from "../hooks/useOrgAuditLog";

type TranslateFn = (key: I18nKey, params?: Record<string, string | number>) => string;

export interface AuditFormatContext {
  translate: TranslateFn;
  memberNameByUserId: Map<string, string>;
  clientNameById: Map<string, string>;
}

const AUDIT_FIELD_LABEL_KEYS: Record<string, I18nKey> = {
  role: "team.auditField.role",
  scope: "team.auditField.scope",
  meta: "team.auditField.meta",
  display_name: "team.auditField.displayName",
  first_name: "common.firstName",
  last_name: "common.lastName",
  patronymic: "memberProfile.field.patronymic",
  contact_email: "team.auditField.contactEmail",
  phone: "team.auditField.phone",
  telegram: "team.auditField.telegram",
  profile_notes: "memberProfile.field.other",
  is_active: "team.auditField.isActive",
  email: "team.auditField.contactEmail",
  expires_at: "team.auditField.expiresAt",
  locale: "team.auditField.locale",
  currency_code: "team.auditField.currencyCode",
  currency_display: "team.auditField.currencyDisplay",
  modules: "team.auditField.modules",
  branding_name: "team.auditField.brandingName",
  pair_cycle_enabled: "team.auditField.pairCycleEnabled",
};

const AUDIT_MODULE_LABEL_KEYS: Record<string, I18nKey> = {
  group_subscriptions: "settings.org.module.groupSubscriptions",
  personal_lessons: "settings.org.module.personalLessons",
  finance_basic: "settings.org.module.financeBasic",
  pair_subscriptions: "settings.org.module.pairSubscriptions",
  trio_lessons: "settings.org.module.trioLessons",
  multi_discipline: "settings.org.module.multiDiscipline",
  locations: "settings.org.module.locations",
};

const ROLE_LABEL_KEYS: Record<string, I18nKey> = {
  owner: "team.role.owner",
  director: "team.role.director",
  admin: "team.role.admin",
  teacher: "team.role.teacher",
  accountant: "team.role.accountant",
};

const HIDDEN_AUDIT_FIELDS = new Set([
  "id",
  "organization_id",
  "user_id",
  "created_at",
  "updated_at",
  "joined_at",
  "invited_at",
  "client_id",
  "client_id1",
  "client_id2",
  "client_id3",
  "client_id4",
  "subscription_id",
  "personal_lesson_id",
  "discipline_id",
  "price_id",
  "location_id",
  "schedule_group_id",
  "schedule_slot_id",
  "teacher_member_id",
  "created_by",
  "row_id",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clientLabel(id: string | null | undefined, ctx: AuditFormatContext): string {
  if (!id) return "";
  return ctx.clientNameById.get(id) ?? id.slice(0, 8);
}

function clientsFromData(data: Record<string, unknown> | null, ctx: AuditFormatContext): string {
  if (!data) return "—";
  const names = [
    clientLabel(data.client_id1 as string, ctx),
    clientLabel(data.client_id2 as string, ctx),
    clientLabel(data.client_id3 as string, ctx),
    clientLabel(data.client_id as string, ctx),
    typeof data.client_display === "string" ? data.client_display : "",
    typeof data.first_name === "string" || typeof data.last_name === "string"
      ? [data.last_name, data.first_name].filter(Boolean).join(" ")
      : "",
  ].filter(Boolean);
  return names[0] ?? "—";
}

function formatScopeLine(scope: unknown, translate: TranslateFn): string {
  const normalized = normalizeTeacherScope(scope);
  const parts: string[] = [
    `${translate("team.scope.allDisciplines")}: ${normalized.all_disciplines ? translate("common.yes") : translate("common.no")}`,
    `${translate("team.scope.allLocations")}: ${normalized.all_locations ? translate("common.yes") : translate("common.no")}`,
    `${translate("team.scope.allClients")}: ${normalized.can_view_all_clients ? translate("common.yes") : translate("common.no")}`,
  ];
  if (!normalized.all_disciplines && normalized.discipline_ids.length > 0) {
    parts.push(
      translate("team.auditScope.selectedDisciplines", { count: normalized.discipline_ids.length })
    );
  }
  if (!normalized.all_locations && normalized.location_ids.length > 0) {
    parts.push(translate("team.auditScope.selectedLocations", { count: normalized.location_ids.length }));
  }
  return parts.join("; ");
}

function formatScopeChange(oldValue: unknown, newValue: unknown, translate: TranslateFn): string {
  const oldScope = normalizeTeacherScope(oldValue);
  const newScope = normalizeTeacherScope(newValue);
  const parts: string[] = [];

  if (oldScope.all_disciplines !== newScope.all_disciplines) {
    parts.push(
      `${translate("team.scope.allDisciplines")}: ${oldScope.all_disciplines ? translate("common.yes") : translate("common.no")} → ${newScope.all_disciplines ? translate("common.yes") : translate("common.no")}`
    );
  }
  if (oldScope.all_locations !== newScope.all_locations) {
    parts.push(
      `${translate("team.scope.allLocations")}: ${oldScope.all_locations ? translate("common.yes") : translate("common.no")} → ${newScope.all_locations ? translate("common.yes") : translate("common.no")}`
    );
  }
  if (oldScope.can_view_all_clients !== newScope.can_view_all_clients) {
    parts.push(
      `${translate("team.scope.allClients")}: ${oldScope.can_view_all_clients ? translate("common.yes") : translate("common.no")} → ${newScope.can_view_all_clients ? translate("common.yes") : translate("common.no")}`
    );
  }
  if (
    !newScope.all_disciplines &&
    JSON.stringify(oldScope.discipline_ids) !== JSON.stringify(newScope.discipline_ids)
  ) {
    parts.push(
      `${translate("team.scope.disciplines")}: ${oldScope.discipline_ids.length} → ${newScope.discipline_ids.length}`
    );
  }
  if (
    !newScope.all_locations &&
    JSON.stringify(oldScope.location_ids) !== JSON.stringify(newScope.location_ids)
  ) {
    parts.push(
      `${translate("team.scope.locations")}: ${oldScope.location_ids.length} → ${newScope.location_ids.length}`
    );
  }

  return parts.length > 0 ? parts.join("; ") : formatScopeLine(newValue, translate);
}

function auditValueLabel(value: unknown, ctx: AuditFormatContext, fieldKey?: string): string {
  const { translate } = ctx;
  if (value === null || value === undefined || value === "") return "—";
  if (fieldKey === "role" && typeof value === "string") {
    const roleKey = ROLE_LABEL_KEYS[value];
    return roleKey ? translate(roleKey) : value;
  }
  if (fieldKey === "scope") return formatScopeLine(value, translate);
  if (typeof value === "boolean") return value ? translate("common.yes") : translate("common.no");
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (isRecord(value)) return "—";
  return String(value);
}

function auditModuleLabel(key: string, translate: TranslateFn): string {
  const labelKey = AUDIT_MODULE_LABEL_KEYS[key];
  return labelKey ? translate(labelKey) : key;
}

function auditModulesInsertLabel(value: unknown, translate: TranslateFn): string {
  if (!isRecord(value)) return auditValueLabel(value, { translate, memberNameByUserId: new Map(), clientNameById: new Map() });

  const enabled = Object.entries(value)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => auditModuleLabel(key, translate));

  return enabled.length > 0 ? enabled.join(", ") : "—";
}

export function auditOperationLabel(operation: string, translate: TranslateFn): string {
  if (operation === "INSERT") return translate("team.auditOperation.insert");
  if (operation === "UPDATE") return translate("team.auditOperation.update");
  if (operation === "DELETE") return translate("team.auditOperation.delete");
  return operation;
}

function subscriptionItemLabel(data: Record<string, unknown> | null, translate: TranslateFn): string {
  if (!data) return translate("team.auditTable.subscriptions");
  const lessons = data.lessons_total ?? data.lessons_left;
  if (lessons !== null && lessons !== undefined) {
    return translate("team.auditItem.subscription", { lessons: String(lessons) });
  }
  return translate("team.auditTable.subscriptions");
}

export function formatAuditSummary(row: AuditLogRow, ctx: AuditFormatContext): string | null {
  const { translate } = ctx;
  const data = row.operation === "DELETE" ? row.old_data : row.new_data;

  switch (row.table_name) {
    case "subscriptions": {
      const item = subscriptionItemLabel(data, translate);
      const client = clientsFromData(data, ctx);
      if (row.operation === "INSERT") {
        return translate("team.auditSummary.soldSubscription", { item, client });
      }
      if (row.operation === "DELETE") {
        return translate("team.auditSummary.deletedSubscription", { item, client });
      }
      if (row.operation === "UPDATE") {
        return translate("team.auditSummary.updatedSubscription", { item, client });
      }
      break;
    }
    case "clients": {
      const client = clientsFromData(data, ctx);
      if (row.operation === "INSERT") {
        return translate("team.auditSummary.addedClient", { client });
      }
      if (row.operation === "DELETE") {
        return translate("team.auditSummary.deletedClient", { client });
      }
      if (row.operation === "UPDATE") {
        if (data?.archived_at && !row.old_data?.archived_at) {
          return translate("team.auditSummary.archivedClient", { client });
        }
        return translate("team.auditSummary.updatedClient", { client });
      }
      break;
    }
    case "payments": {
      const client =
        (typeof data?.client_display === "string" && data.client_display) ||
        clientsFromData(data, ctx);
      const amount = data?.amount != null ? String(data.amount) : "—";
      if (row.operation === "INSERT") {
        return translate("team.auditSummary.paymentReceived", { amount, client });
      }
      if (row.operation === "DELETE") {
        return translate("team.auditSummary.deletedPayment", { amount, client });
      }
      break;
    }
    case "personal_lessons": {
      const client = clientsFromData(data, ctx);
      const date = typeof data?.date === "string" ? data.date : "—";
      if (row.operation === "INSERT") {
        return translate("team.auditSummary.addedPersonalLesson", { client, date });
      }
      if (row.operation === "DELETE") {
        return translate("team.auditSummary.deletedPersonalLesson", { client, date });
      }
      if (row.operation === "UPDATE") {
        return translate("team.auditSummary.updatedPersonalLesson", { client, date });
      }
      break;
    }
    case "attendance": {
      const status = typeof data?.attendance_status === "string" ? data.attendance_status : "—";
      const date = typeof data?.date === "string" ? data.date : "—";
      return translate("team.auditSummary.attendance", { status, date });
    }
    case "single_visits": {
      const client = clientsFromData(data, ctx);
      const date = typeof data?.visit_date === "string" ? data.visit_date : "—";
      if (row.operation === "INSERT") {
        return translate("team.auditSummary.addedSingleVisit", { client, date });
      }
      if (row.operation === "DELETE") {
        return translate("team.auditSummary.deletedSingleVisit", { client, date });
      }
      break;
    }
    default:
      return null;
  }

  return null;
}

export function auditChangedFields(
  row: Pick<AuditLogRow, "operation" | "old_data" | "new_data" | "table_name">,
  ctx: AuditFormatContext
): string[] {
  const { translate } = ctx;
  const oldData = row.old_data ?? {};
  const newData = row.new_data ?? {};
  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  const details: string[] = [];

  for (const key of keys) {
    if (HIDDEN_AUDIT_FIELDS.has(key)) continue;
    const oldValue = oldData[key];
    const newValue = newData[key];
    if (row.operation === "UPDATE" && JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    if (row.operation === "INSERT" && (newValue === null || newValue === undefined || newValue === "")) continue;

    const labelKey = AUDIT_FIELD_LABEL_KEYS[key];
    const label = labelKey ? translate(labelKey) : key;

    if (key === "scope") {
      if (row.operation === "INSERT") {
        details.push(`${label}: ${formatScopeLine(newValue, translate)}`);
      } else if (row.operation === "DELETE") {
        details.push(`${label}: ${formatScopeLine(oldValue, translate)}`);
      } else {
        details.push(`${label}: ${formatScopeChange(oldValue, newValue, translate)}`);
      }
      continue;
    }

    if (key === "modules") {
      if (row.operation === "INSERT") {
        details.push(`${label}: ${auditModulesInsertLabel(newValue, translate)}`);
      } else if (row.operation === "DELETE") {
        details.push(`${label}: ${auditModulesInsertLabel(oldValue, translate)}`);
      } else if (isRecord(oldValue) && isRecord(newValue)) {
        const moduleKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
        for (const moduleKey of moduleKeys) {
          if (JSON.stringify(oldValue[moduleKey]) === JSON.stringify(newValue[moduleKey])) continue;
          details.push(
            `${label}: ${auditModuleLabel(moduleKey, translate)}: ${auditValueLabel(oldValue[moduleKey], ctx)} → ${auditValueLabel(newValue[moduleKey], ctx)}`
          );
        }
      } else {
        details.push(
          `${label}: ${auditValueLabel(oldValue, ctx)} → ${auditValueLabel(newValue, ctx)}`
        );
      }
      continue;
    }

    if (row.operation === "INSERT") {
      details.push(`${label}: ${auditValueLabel(newValue, ctx, key)}`);
    } else if (row.operation === "DELETE") {
      details.push(`${label}: ${auditValueLabel(oldValue, ctx, key)}`);
    } else {
      details.push(
        `${label}: ${auditValueLabel(oldValue, ctx, key)} → ${auditValueLabel(newValue, ctx, key)}`
      );
    }
  }

  return details;
}

export function formatAuditActor(
  changedBy: string | null,
  ctx: AuditFormatContext
): string {
  const { translate, memberNameByUserId } = ctx;
  if (!changedBy) return translate("team.auditSystem");
  const name = memberNameByUserId.get(changedBy);
  return name
    ? translate("team.auditActor", { name, id: changedBy })
    : translate("team.auditActorIdOnly", { id: changedBy });
}
