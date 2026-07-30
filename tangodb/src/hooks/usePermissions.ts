import { useMemo } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import { normalizeOrgModules } from "../lib/orgModules";
import {
  can,
  canAccessPanel,
  EMPTY_TEACHER_SCOPE,
  permissionOptionsFromSettings,
  type PanelId,
  type PermissionAction,
  type PermissionContext,
  type PermissionOptions,
} from "../lib/permissions";

export function usePermissions() {
  const { role, settings, isReadOnly, memberships, organizationId } = useOrganization();

  const membership = useMemo(
    () => memberships.find((m) => m.organization_id === organizationId) ?? null,
    [memberships, organizationId]
  );

  const scope = membership?.scope ?? EMPTY_TEACHER_SCOPE;

  const options: PermissionOptions = useMemo(
    () => ({
      ...permissionOptionsFromSettings(settings, scope, {
        restrictedAdmin: membership?.meta?.restricted_admin ?? false,
        isReadOnly,
      }),
      modules: normalizeOrgModules(settings?.modules),
    }),
    [settings, scope, membership?.meta?.restricted_admin, isReadOnly]
  );

  const canAction = (action: PermissionAction, context?: PermissionContext) =>
    can(role, action, { ...options, context });

  const canPanel = (panel: PanelId) => canAccessPanel(role, panel, options);

  const canEditPastSchedule = membership?.meta?.can_edit_past_schedule ?? false;

  return {
    role,
    scope,
    membership,
    isReadOnly,
    canEditPastSchedule,
    can: canAction,
    canAccessPanel: canPanel,
  };
}

export function useCan(action: PermissionAction, context?: PermissionContext): boolean {
  const { can: canAction } = usePermissions();
  return canAction(action, context);
}
