import { useMemo } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import { isModuleEnabled, normalizeOrgModules } from "../lib/orgModules";
import type { OrgModules } from "../types/organization";

export function useOrgModules(): OrgModules {
  const { settings } = useOrganization();
  return useMemo(() => normalizeOrgModules(settings?.modules), [settings?.modules]);
}

export function usePersonalLessonsModuleEnabled(): boolean {
  const modules = useOrgModules();
  return isModuleEnabled(modules, "personal_lessons");
}
