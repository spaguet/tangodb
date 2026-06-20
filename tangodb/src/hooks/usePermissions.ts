import { useMemo } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  can,
  canAccessPanel,
  EMPTY_TEACHER_SCOPE,
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
      scope,
      teachersCanManageDisciplines: settings?.teachers_can_manage_disciplines ?? false,
      restrictedAdmin: membership?.meta?.restricted_admin ?? false,
      isReadOnly,
    }),
    [scope, settings?.teachers_can_manage_disciplines, membership?.meta?.restricted_admin, isReadOnly]
  );

  const canAction = (action: PermissionAction, context?: PermissionContext) =>
    can(role, action, { ...options, context });

  const canPanel = (panel: PanelId) => canAccessPanel(role, panel, options);

  return {
    role,
    scope,
    membership,
    isReadOnly,
    can: canAction,
    canAccessPanel: canPanel,
  };
}

export function useCan(action: PermissionAction, context?: PermissionContext): boolean {
  const { can: canAction } = usePermissions();
  return canAction(action, context);
}
