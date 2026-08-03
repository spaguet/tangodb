import type {
  VenueCostAttendanceTier,
  VenueCostGroupRule,
  VenueCostPerLessonRules,
  VenueCostPersonalRule,
} from "./venueCostRules";

export type VenueCostRuleSection = "group" | "personal";

export interface VenueCostBulkConflict {
  kind: "duplicate" | "ambiguous";
  section: VenueCostRuleSection;
  key: string;
  relatedKey?: string;
}

export function venueCostScopeSpecificity(rule: {
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
}): number {
  return Number(!!rule.teacherMemberId) + Number(!!rule.disciplineId) + Number(!!rule.locationId);
}

export function venueCostRulesOverlap(
  a: { teacherMemberId: string | null; disciplineId: string | null; locationId: string | null },
  b: { teacherMemberId: string | null; disciplineId: string | null; locationId: string | null }
): boolean {
  if (a.teacherMemberId && b.teacherMemberId && a.teacherMemberId !== b.teacherMemberId) return false;
  if (a.disciplineId && b.disciplineId && a.disciplineId !== b.disciplineId) return false;
  if (a.locationId && b.locationId && a.locationId !== b.locationId) return false;
  return true;
}

export function venueCostScopeKey(
  section: VenueCostRuleSection,
  teacherMemberId: string | null,
  disciplineId: string | null,
  locationId: string | null
): string {
  return `${section}:${teacherMemberId ?? "*"}:${disciplineId ?? "*"}:${locationId ?? "*"}`;
}

function cloneTiers(tiers: VenueCostAttendanceTier[]): VenueCostAttendanceTier[] {
  return tiers.map((tier) => ({ ...tier }));
}

function sectionRules(rules: VenueCostPerLessonRules, section: VenueCostRuleSection) {
  return section === "group" ? rules.group : rules.personal;
}

export function findVenueCostDuplicateKeys(rules: VenueCostPerLessonRules): string[] {
  const duplicates: string[] = [];
  for (const section of ["group", "personal"] as const) {
    const seen = new Map<string, number>();
    for (const rule of sectionRules(rules, section)) {
      const key = venueCostScopeKey(section, rule.teacherMemberId, rule.disciplineId, rule.locationId);
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count === 2) duplicates.push(key);
    }
  }
  return duplicates;
}

export function findVenueCostAmbiguousPairs(
  rules: VenueCostPerLessonRules
): Array<{ section: VenueCostRuleSection; keyA: string; keyB: string }> {
  const pairs: Array<{ section: VenueCostRuleSection; keyA: string; keyB: string }> = [];
  for (const section of ["group", "personal"] as const) {
    const list = sectionRules(rules, section);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (
          venueCostRulesOverlap(a, b) &&
          venueCostScopeSpecificity(a) === venueCostScopeSpecificity(b)
        ) {
          const keyA = venueCostScopeKey(section, a.teacherMemberId, a.disciplineId, a.locationId);
          const keyB = venueCostScopeKey(section, b.teacherMemberId, b.disciplineId, b.locationId);
          pairs.push({ section, keyA, keyB });
        }
      }
    }
  }
  return pairs;
}

/** Expand «all current teachers» into explicit teacher ids — no wildcard rules. */
export function expandVenueCostTeacherTargets(allTeacherIds: string[], selectedTeacherIds: string[]): string[] {
  if (selectedTeacherIds.length === 0) return [...allTeacherIds];
  return [...selectedTeacherIds];
}

export interface VenueCostBulkTeacherApplyPlan {
  section: VenueCostRuleSection;
  sourceIndex: number;
  teacherIds: string[];
  createdRules: number;
  skippedDuplicates: number;
  conflicts: VenueCostBulkConflict[];
  valid: boolean;
}

export function planVenueCostTeacherBulkApply(
  rules: VenueCostPerLessonRules,
  section: VenueCostRuleSection,
  sourceIndex: number,
  teacherIds: string[]
): VenueCostBulkTeacherApplyPlan {
  const list = sectionRules(rules, section);
  const source = list[sourceIndex];
  const base: VenueCostBulkTeacherApplyPlan = {
    section,
    sourceIndex,
    teacherIds,
    createdRules: 0,
    skippedDuplicates: 0,
    conflicts: [],
    valid: false,
  };
  if (!source) {
    base.conflicts.push({ kind: "duplicate", section, key: "invalid_source" });
    return base;
  }

  const existingKeys = new Set(
    list.map((rule) => venueCostScopeKey(section, rule.teacherMemberId, rule.disciplineId, rule.locationId))
  );
  const proposed: (VenueCostGroupRule | VenueCostPersonalRule)[] = [];

  for (const teacherId of teacherIds) {
    if (!teacherId) continue;
    if (teacherId === source.teacherMemberId) continue;
    const key = venueCostScopeKey(section, teacherId, source.disciplineId, source.locationId);
    if (existingKeys.has(key)) {
      base.skippedDuplicates += 1;
      continue;
    }
    if (section === "group") {
      proposed.push({
        teacherMemberId: teacherId,
        disciplineId: source.disciplineId,
        locationId: source.locationId,
        attendanceTiers: cloneTiers((source as VenueCostGroupRule).attendanceTiers),
      });
    } else {
      proposed.push({
        teacherMemberId: teacherId,
        disciplineId: source.disciplineId,
        locationId: source.locationId,
        amount: (source as VenueCostPersonalRule).amount,
      });
    }
    existingKeys.add(key);
    base.createdRules += 1;
  }

  if (base.createdRules === 0) {
    return base;
  }

  const merged: VenueCostPerLessonRules =
    section === "group"
      ? { ...rules, group: [...rules.group, ...(proposed as VenueCostGroupRule[])] }
      : { ...rules, personal: [...rules.personal, ...(proposed as VenueCostPersonalRule[])] };

  const ambiguous = findVenueCostAmbiguousPairs(merged);
  for (const pair of ambiguous) {
    const involvesNew =
      proposed.some(
        (rule) =>
          venueCostScopeKey(pair.section, rule.teacherMemberId, rule.disciplineId, rule.locationId) === pair.keyA ||
          venueCostScopeKey(pair.section, rule.teacherMemberId, rule.disciplineId, rule.locationId) === pair.keyB
      );
    if (involvesNew) {
      base.conflicts.push({
        kind: "ambiguous",
        section: pair.section,
        key: pair.keyA,
        relatedKey: pair.keyB,
      });
    }
  }

  base.valid = base.conflicts.length === 0 && base.createdRules > 0;
  return base;
}

export function applyVenueCostTeacherBulkApply(
  rules: VenueCostPerLessonRules,
  plan: VenueCostBulkTeacherApplyPlan
): VenueCostPerLessonRules | null {
  if (!plan.valid) return null;
  const verified = planVenueCostTeacherBulkApply(rules, plan.section, plan.sourceIndex, plan.teacherIds);
  if (!verified.valid || verified.createdRules !== plan.createdRules) return null;

  const list = sectionRules(rules, plan.section);
  const source = list[plan.sourceIndex];
  if (!source) return null;

  const newRules: (VenueCostGroupRule | VenueCostPersonalRule)[] = [];
  const existingKeys = new Set(
    list.map((rule) =>
      venueCostScopeKey(plan.section, rule.teacherMemberId, rule.disciplineId, rule.locationId)
    )
  );

  for (const teacherId of plan.teacherIds) {
    if (!teacherId || teacherId === source.teacherMemberId) continue;
    const key = venueCostScopeKey(plan.section, teacherId, source.disciplineId, source.locationId);
    if (existingKeys.has(key)) continue;
    if (plan.section === "group") {
      newRules.push({
        teacherMemberId: teacherId,
        disciplineId: source.disciplineId,
        locationId: source.locationId,
        attendanceTiers: cloneTiers((source as VenueCostGroupRule).attendanceTiers),
      });
    } else {
      newRules.push({
        teacherMemberId: teacherId,
        disciplineId: source.disciplineId,
        locationId: source.locationId,
        amount: (source as VenueCostPersonalRule).amount,
      });
    }
    existingKeys.add(key);
  }

  if (newRules.length !== plan.createdRules) return null;

  if (plan.section === "group") {
    return { ...rules, group: [...rules.group, ...(newRules as VenueCostGroupRule[])] };
  }
  return { ...rules, personal: [...rules.personal, ...(newRules as VenueCostPersonalRule[])] };
}

export interface VenueCostBulkLocationCopyPlan {
  sourceLocationId: string;
  targetLocationIds: string[];
  createdRules: number;
  skippedDuplicates: number;
  conflicts: VenueCostBulkConflict[];
  valid: boolean;
}

export function planVenueCostLocationBulkCopy(
  rules: VenueCostPerLessonRules,
  sourceLocationId: string,
  targetLocationIds: string[],
  sections: VenueCostRuleSection[] = ["group", "personal"]
): VenueCostBulkLocationCopyPlan {
  const base: VenueCostBulkLocationCopyPlan = {
    sourceLocationId,
    targetLocationIds,
    createdRules: 0,
    skippedDuplicates: 0,
    conflicts: [],
    valid: false,
  };

  if (!sourceLocationId || targetLocationIds.length === 0) return base;

  const proposed: { section: VenueCostRuleSection; rule: VenueCostGroupRule | VenueCostPersonalRule }[] = [];

  for (const section of sections) {
    const list = sectionRules(rules, section);
    const sourceRules = list.filter((rule) => rule.locationId === sourceLocationId);
    const existingKeys = new Set(
      list.map((rule) => venueCostScopeKey(section, rule.teacherMemberId, rule.disciplineId, rule.locationId))
    );

    for (const source of sourceRules) {
      for (const targetLocationId of targetLocationIds) {
        if (targetLocationId === sourceLocationId) continue;
        const key = venueCostScopeKey(
          section,
          source.teacherMemberId,
          source.disciplineId,
          targetLocationId
        );
        if (existingKeys.has(key)) {
          base.skippedDuplicates += 1;
          continue;
        }
        if (section === "group") {
          proposed.push({
            section,
            rule: {
              teacherMemberId: source.teacherMemberId,
              disciplineId: source.disciplineId,
              locationId: targetLocationId,
              attendanceTiers: cloneTiers((source as VenueCostGroupRule).attendanceTiers),
            },
          });
        } else {
          proposed.push({
            section,
            rule: {
              teacherMemberId: source.teacherMemberId,
              disciplineId: source.disciplineId,
              locationId: targetLocationId,
              amount: (source as VenueCostPersonalRule).amount,
            },
          });
        }
        existingKeys.add(key);
        base.createdRules += 1;
      }
    }
  }

  if (base.createdRules === 0) return base;

  const merged: VenueCostPerLessonRules = { ...rules };
  for (const item of proposed) {
    if (item.section === "group") {
      merged.group = [...merged.group, item.rule as VenueCostGroupRule];
    } else {
      merged.personal = [...merged.personal, item.rule as VenueCostPersonalRule];
    }
  }

  const ambiguous = findVenueCostAmbiguousPairs(merged);
  for (const pair of ambiguous) {
    const involvesNew = proposed.some(
      (item) =>
        venueCostScopeKey(item.section, item.rule.teacherMemberId, item.rule.disciplineId, item.rule.locationId) ===
          pair.keyA ||
        venueCostScopeKey(item.section, item.rule.teacherMemberId, item.rule.disciplineId, item.rule.locationId) ===
          pair.keyB
    );
    if (involvesNew) {
      base.conflicts.push({
        kind: "ambiguous",
        section: pair.section,
        key: pair.keyA,
        relatedKey: pair.keyB,
      });
    }
  }

  base.valid = base.conflicts.length === 0 && base.createdRules > 0;
  return base;
}

export function applyVenueCostLocationBulkCopy(
  rules: VenueCostPerLessonRules,
  plan: VenueCostBulkLocationCopyPlan,
  sections: VenueCostRuleSection[] = ["group", "personal"]
): VenueCostPerLessonRules | null {
  if (!plan.valid) return null;
  const verified = planVenueCostLocationBulkCopy(
    rules,
    plan.sourceLocationId,
    plan.targetLocationIds,
    sections
  );
  if (!verified.valid || verified.createdRules !== plan.createdRules) return null;

  const next: VenueCostPerLessonRules = { ...rules, group: [...rules.group], personal: [...rules.personal] };

  for (const section of sections) {
    const list = sectionRules(rules, section);
    const sourceRules = list.filter((rule) => rule.locationId === plan.sourceLocationId);
    const existingKeys = new Set(
      sectionRules(next, section).map((rule) =>
        venueCostScopeKey(section, rule.teacherMemberId, rule.disciplineId, rule.locationId)
      )
    );

    for (const source of sourceRules) {
      for (const targetLocationId of plan.targetLocationIds) {
        if (targetLocationId === plan.sourceLocationId) continue;
        const key = venueCostScopeKey(
          section,
          source.teacherMemberId,
          source.disciplineId,
          targetLocationId
        );
        if (existingKeys.has(key)) continue;
        if (section === "group") {
          next.group.push({
            teacherMemberId: source.teacherMemberId,
            disciplineId: source.disciplineId,
            locationId: targetLocationId,
            attendanceTiers: cloneTiers((source as VenueCostGroupRule).attendanceTiers),
          });
        } else {
          next.personal.push({
            teacherMemberId: source.teacherMemberId,
            disciplineId: source.disciplineId,
            locationId: targetLocationId,
            amount: (source as VenueCostPersonalRule).amount,
          });
        }
        existingKeys.add(key);
      }
    }
  }

  const appliedCount = planVenueCostLocationBulkCopy(
    rules,
    plan.sourceLocationId,
    plan.targetLocationIds,
    sections
  ).createdRules;
  if (appliedCount !== plan.createdRules) return null;

  return next;
}
