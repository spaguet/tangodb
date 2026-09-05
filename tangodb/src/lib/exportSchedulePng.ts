import { isMobileExportContext } from "./exportCsv";
import { computeDisplayRange, isPastDate, toISODateLocal } from "./scheduleWeek";
import {
  gridHeightPx,
  layoutDayLessons,
  lessonHeightPx,
  lessonTopPx,
  ROW_HEIGHT_PX,
  SLOT_MINUTES,
} from "./scheduleLayout";
import { dowShort, jsDayToIsoDow } from "./utils";
import type { DisplayLesson } from "../types";

const SCALE = 2;
const CANVAS_WIDTH = 1120;
const PAGE_PAD = 16;
const HEADER_H = 62;
const DAY_HEADER_H = 44;
const TIME_COL_W = 48;
const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';

const COLOR = {
  white: "#ffffff",
  slate50: "#f8fafc",
  slate100: "#f1f5f9",
  slate200: "#e2e8f0",
  slate400: "#94a3b8",
  slate500: "#64748b",
  slate700: "#334155",
  slate800: "#1e293b",
  todayHead: "#e2e8f0",
  todayBody: "#f1f5f9",
} as const;

const LESSON_FILL: Record<DisplayLesson["kind"], { fill: string; stroke: string }> = {
  group: { fill: "#4f46e5", stroke: "#4338ca" },
  personal: { fill: "#38bdf8", stroke: "#0ea5e9" },
  event: { fill: "#7c3aed", stroke: "#6d28d9" },
  rental: { fill: "#475569", stroke: "#334155" },
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();

  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 250);
}

async function trySharePngFile(file: File): Promise<"shared" | "failed" | "cancelled"> {
  if (typeof navigator.share !== "function") return "failed";
  try {
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return "failed";
    await navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    return "failed";
  }
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low <= 0 ? "…" : `${text.slice(0, low)}…`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function formatTimeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function buildDayColumns(
  weekStart: Date,
  lessons: DisplayLesson[]
): { dateISO: string; dayOfWeek: number; dayNumber: number; lessons: DisplayLesson[] }[] {
  const columns: { dateISO: string; dayOfWeek: number; dayNumber: number; lessons: DisplayLesson[] }[] =
    [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + offset);
    const dateISO = toISODateLocal(date);
    columns.push({
      dateISO,
      dayOfWeek: jsDayToIsoDow(date.getDay()),
      dayNumber: date.getDate(),
      lessons: lessons.filter((l) => l.date === dateISO),
    });
  }
  return columns;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

export type SchedulePngExportResult = "downloaded" | "shared" | "cancelled" | "failed";

export interface SchedulePngExportInput {
  filename: string;
  title: string;
  locationLabel: string;
  weekLabel: string;
  weekStart: Date;
  lessons: DisplayLesson[];
  getLessonTitle: (lesson: DisplayLesson) => string;
  getLessonSubtitle: (lesson: DisplayLesson) => string | undefined;
  locale: string;
  emptyLabel: string;
}

/** Draw the weekly grid onto a canvas (avoids html-to-image + Tailwind oklch blank PNGs). */
export async function exportSchedulePng(input: SchedulePngExportInput): Promise<SchedulePngExportResult> {
  const { start: rangeStartMin, end: rangeEndMin } = computeDisplayRange(input.lessons);
  const gridH = gridHeightPx(rangeStartMin, rangeEndMin);
  const rowCount = (rangeEndMin - rangeStartMin) / SLOT_MINUTES;
  const cssH = PAGE_PAD + HEADER_H + DAY_HEADER_H + gridH + PAGE_PAD;
  const todayISO = toISODateLocal(new Date());
  const columns = buildDayColumns(input.weekStart, input.lessons);
  const dayW = (CANVAS_WIDTH - PAGE_PAD * 2 - TIME_COL_W) / 7;
  const gridTop = PAGE_PAD + HEADER_H + DAY_HEADER_H;
  const gridLeft = PAGE_PAD + TIME_COL_W;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(CANVAS_WIDTH * SCALE);
  canvas.height = Math.round(cssH * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "failed";

  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = COLOR.white;
  ctx.fillRect(0, 0, CANVAS_WIDTH, cssH);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = COLOR.slate800;
  ctx.font = `600 16px ${FONT}`;
  const headerMax = CANVAS_WIDTH - PAGE_PAD * 2;
  ctx.fillText(ellipsize(ctx, input.title, headerMax), PAGE_PAD, PAGE_PAD + 22);

  ctx.fillStyle = COLOR.slate700;
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(ellipsize(ctx, input.locationLabel, headerMax), PAGE_PAD, PAGE_PAD + 40);

  ctx.fillStyle = COLOR.slate500;
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText(ellipsize(ctx, input.weekLabel, headerMax), PAGE_PAD, PAGE_PAD + 56);

  ctx.strokeStyle = COLOR.slate200;
  ctx.lineWidth = 1;
  ctx.strokeRect(PAGE_PAD, PAGE_PAD + HEADER_H, CANVAS_WIDTH - PAGE_PAD * 2, DAY_HEADER_H + gridH);

  columns.forEach((col, i) => {
    const x = gridLeft + i * dayW;
    if (col.dateISO === todayISO) {
      ctx.fillStyle = COLOR.todayHead;
      ctx.fillRect(x, PAGE_PAD + HEADER_H, dayW, DAY_HEADER_H);
      ctx.fillStyle = COLOR.todayBody;
      ctx.fillRect(x, gridTop, dayW, gridH);
    } else {
      ctx.fillStyle = COLOR.slate50;
      ctx.fillRect(x, PAGE_PAD + HEADER_H, dayW, DAY_HEADER_H);
    }

    ctx.fillStyle = COLOR.slate400;
    ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(dowShort(col.dayOfWeek, input.locale).toUpperCase(), x + dayW / 2, PAGE_PAD + HEADER_H + 16);
    ctx.fillStyle = COLOR.slate800;
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText(String(col.dayNumber), x + dayW / 2, PAGE_PAD + HEADER_H + 34);
    ctx.textAlign = "left";

    ctx.strokeStyle = COLOR.slate100;
    ctx.beginPath();
    ctx.moveTo(x, PAGE_PAD + HEADER_H);
    ctx.lineTo(x, gridTop + gridH);
    ctx.stroke();
  });

  ctx.fillStyle = COLOR.slate50;
  ctx.fillRect(PAGE_PAD, PAGE_PAD + HEADER_H, TIME_COL_W, DAY_HEADER_H);
  ctx.strokeStyle = COLOR.slate100;
  ctx.beginPath();
  ctx.moveTo(gridLeft, PAGE_PAD + HEADER_H);
  ctx.lineTo(gridLeft, gridTop + gridH);
  ctx.stroke();

  for (let i = 0; i <= rowCount; i += 1) {
    const y = gridTop + i * ROW_HEIGHT_PX;
    ctx.strokeStyle = i % 4 === 0 ? COLOR.slate200 : COLOR.slate100;
    ctx.beginPath();
    ctx.moveTo(PAGE_PAD, y);
    ctx.lineTo(CANVAS_WIDTH - PAGE_PAD, y);
    ctx.stroke();
  }

  ctx.fillStyle = COLOR.slate400;
  ctx.font = `600 10px ${FONT}`;
  ctx.textAlign = "right";
  for (let min = rangeStartMin; min < rangeEndMin; min += 60) {
    const y = gridTop + ((min - rangeStartMin) / SLOT_MINUTES) * ROW_HEIGHT_PX;
    ctx.fillText(formatTimeLabel(min), gridLeft - 6, y - 2);
  }
  ctx.textAlign = "left";

  if (input.lessons.length === 0) {
    ctx.fillStyle = COLOR.slate400;
    ctx.font = `400 13px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(input.emptyLabel, PAGE_PAD + (CANVAS_WIDTH - PAGE_PAD * 2) / 2, gridTop + gridH / 2);
    ctx.textAlign = "left";
  } else {
    columns.forEach((col, i) => {
      const colX = gridLeft + i * dayW;
      const positioned = layoutDayLessons(col.lessons);
      for (const item of positioned) {
        const colors = LESSON_FILL[item.lesson.kind];
        const top = gridTop + lessonTopPx(item.lesson.timeStart, rangeStartMin);
        const height = lessonHeightPx(item.lesson.timeStart, item.lesson.timeEnd);
        const width = dayW / item.columnCount;
        const left = colX + item.column * width;
        const pad = 2;
        const x = left + pad;
        const y = top + 1;
        const w = Math.max(width - pad * 2, 4);
        const h = Math.max(height - 2, ROW_HEIGHT_PX - 2);
        const past = isPastDate(item.lesson.date);

        ctx.globalAlpha = past ? 0.5 : 1;
        ctx.fillStyle = colors.fill;
        roundRect(ctx, x, y, w, h, 4);
        ctx.fill();
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;

        const textX = x + 4;
        const textMax = w - 8;
        ctx.fillStyle = COLOR.white;
        ctx.font = `600 10px ${FONT}`;
        ctx.fillText(ellipsize(ctx, input.getLessonTitle(item.lesson), textMax), textX, y + 12);
        if (h >= ROW_HEIGHT_PX * 2) {
          const subtitle = input.getLessonSubtitle(item.lesson);
          if (subtitle) {
            ctx.globalAlpha = 0.85;
            ctx.font = `400 10px ${FONT}`;
            ctx.fillText(ellipsize(ctx, subtitle, textMax), textX, y + 24);
            ctx.globalAlpha = 1;
          }
        }
      }
    });
  }

  const blob = await canvasToBlob(canvas);
  if (!blob) return "failed";

  const file = new File([blob], input.filename, { type: "image/png" });

  if (isMobileExportContext()) {
    const shared = await trySharePngFile(file);
    if (shared === "shared") return "shared";
    if (shared === "cancelled") return "cancelled";
  }

  downloadBlob(blob, input.filename);
  return "downloaded";
}

function sanitizeLocationFilenamePart(value: string): string {
  const trimmed = value.trim().replace(/[/\\?%*:|"<>]/g, "-");
  const safe = trimmed.replace(/\s+/g, "_").slice(0, 48);
  return safe || "location";
}

export function buildSchedulePngFilename(
  weekStartISO: string,
  weekEndISO: string,
  locationLabel: string
): string {
  const slug = sanitizeLocationFilenamePart(locationLabel);
  return `schedule_${slug}_${weekStartISO}_${weekEndISO}.png`;
}
