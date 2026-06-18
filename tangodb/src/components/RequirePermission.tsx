import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { useCan } from "../hooks/usePermissions";
import type { PermissionAction, PermissionContext } from "../lib/permissions";

interface RequirePermissionProps {
  action: PermissionAction;
  context?: PermissionContext;
  children: ReactNode;
  fallback?: ReactNode;
  mode?: "hide" | "disable";
}

export default function RequirePermission({
  action,
  context,
  children,
  fallback = null,
  mode = "hide",
}: RequirePermissionProps) {
  const allowed = useCan(action, context);

  if (allowed) return <>{children}</>;

  if (mode === "disable" && isValidElement(children)) {
    const element = children as ReactElement<{ disabled?: boolean; title?: string }>;
    return cloneElement(element, {
      disabled: true,
      title: element.props.title ?? "Недостаточно прав",
    });
  }

  return <>{fallback}</>;
}
