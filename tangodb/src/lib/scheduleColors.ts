/** Discipline color palette — indigo shades + amber/teal/sky per SCHEDULE_TZ §5.2 */
const DISCIPLINE_PALETTE = [
  { bg: "bg-indigo-500", border: "border-indigo-600", text: "text-white" },
  { bg: "bg-indigo-600", border: "border-indigo-700", text: "text-white" },
  { bg: "bg-indigo-700", border: "border-indigo-800", text: "text-white" },
  { bg: "bg-amber-500", border: "border-amber-600", text: "text-white" },
  { bg: "bg-teal-500", border: "border-teal-600", text: "text-white" },
  { bg: "bg-sky-500", border: "border-sky-600", text: "text-white" },
] as const;

export type DisciplineColorClasses = (typeof DISCIPLINE_PALETTE)[number];

function hashDisciplineId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getDisciplineColor(disciplineId: string | null): DisciplineColorClasses {
  if (!disciplineId) return DISCIPLINE_PALETTE[0];
  return DISCIPLINE_PALETTE[hashDisciplineId(disciplineId) % DISCIPLINE_PALETTE.length];
}

/** Personal lessons use darker indigo per design_system.md */
export const PERSONAL_LESSON_COLOR = {
  bg: "bg-indigo-700",
  border: "border-indigo-800",
  text: "text-white",
} as const;
