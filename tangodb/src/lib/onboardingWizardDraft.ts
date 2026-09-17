import type { OrgModules, OrgPreset } from "../types/organization";

const STORAGE_KEY = "tangodb:onboarding-wizard-draft:v1";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OnboardingWizardStep = "name" | "preset" | "locale" | "modules";

export interface OnboardingWizardDraft {
  version: 1;
  savedAt: number;
  organizationId: string;
  step: OnboardingWizardStep;
  orgName: string;
  preset: OrgPreset;
  locale: string;
  currencyCode: string;
  timezone: string;
  modules: OrgModules;
}

export function loadOnboardingWizardDraft(organizationId: string): OnboardingWizardDraft | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardingWizardDraft;
    if (parsed.version !== 1 || parsed.organizationId !== organizationId) return null;
    if (Date.now() - parsed.savedAt > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveOnboardingWizardDraft(draft: OnboardingWizardDraft): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* quota / private mode */
  }
}

export function clearOnboardingWizardDraft(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
