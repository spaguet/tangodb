"""Generate CRM color palette PNG from design_system.md tokens (Studio Controller palette)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PALETTE: list[tuple[str, list[tuple[str, str]]]] = [
    (
        "Нейтральные (slate)",
        [
            ("white", "#ffffff"),
            ("slate-50", "#f8fafc"),
            ("slate-100", "#f1f5f9"),
            ("slate-200", "#e2e8f0"),
            ("slate-300", "#cbd5e1"),
            ("slate-400", "#94a3b8"),
            ("slate-500", "#64748b"),
            ("slate-600", "#475569"),
            ("slate-700", "#334155"),
            ("slate-800", "#1e293b"),
            ("slate-900", "#0f172a"),
            ("slate-950", "#020617"),
        ],
    ),
    (
        "Акцент (indigo)",
        [
            ("indigo-50", "#f5f7ff"),
            ("indigo-100", "#e8ecff"),
            ("indigo-200", "#d7deff"),
            ("indigo-500", "#6b76dc"),
            ("indigo-600", "#5663d6"),
            ("indigo-700", "#4652b8"),
            ("indigo-800", "#39449a"),
            ("indigo-900", "#2f3778"),
        ],
    ),
    (
        "Семантические — успех (green)",
        [
            ("green-50", "#ecf7f1"),
            ("green-500", "#3f8f6b"),
            ("green-600", "#2e7d56"),
        ],
    ),
    (
        "Семантические — ошибка / долг (rose)",
        [
            ("rose-50", "#fff5f6"),
            ("rose-100", "#fde8ea"),
            ("rose-300", "#f3a0aa"),
            ("rose-500", "#e45b68"),
            ("rose-600", "#d64554"),
            ("rose-700", "#b93645"),
        ],
    ),
    (
        "Семантические — предупреждение (amber, баннеры / ожидает)",
        [
            ("amber-50", "#fffbeb"),
            ("amber-100", "#fef3c7"),
            ("amber-500", "#d89a24"),
            ("amber-600", "#b7791f"),
        ],
    ),
    (
        "Telegram (исключение из палитры)",
        [
            ("telegram", "#229ED9"),
            ("telegram-hover", "#1C82B4"),
        ],
    ),
    (
        "Расписание — групповые",
        [
            ("lesson-group-bg", "#f5f7fa"),
            ("lesson-group-accent", "#64748b"),
        ],
    ),
    (
        "Расписание — персональные",
        [
            ("lesson-personal-bg", "#eef0ff"),
            ("lesson-personal-accent", "#5663d6"),
        ],
    ),
    (
        "Расписание — мероприятия (custom hex)",
        [
            ("lesson-event-bg", "#f5f0ff"),
            ("lesson-event-accent", "#7c4dcc"),
        ],
    ),
]

MARGIN = 48
ROW_H = 44
SECTION_GAP = 28
TITLE_H = 56
SECTION_TITLE_H = 32
SWATCH_W = 120
GAP = 16
WIDTH = 920

FONT_CANDIDATES = [
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = FONT_CANDIDATES if not bold else [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        *FONT_CANDIDATES,
    ]
    for path in names:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def text_color_for_bg(hex_color: str) -> str:
    r, g, b = hex_to_rgb(hex_color)
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return "#1e293b" if luminance > 170 else "#ffffff"


def total_height() -> int:
    rows = sum(len(colors) for _, colors in PALETTE)
    sections = len(PALETTE)
    return (
        MARGIN
        + TITLE_H
        + sections * SECTION_TITLE_H
        + rows * ROW_H
        + (sections - 1) * SECTION_GAP
        + MARGIN
    )


def main() -> None:
    height = total_height()
    img = Image.new("RGB", (WIDTH, height), "#f8fafc")
    draw = ImageDraw.Draw(img)
    font_title = load_font(22, bold=True)
    font_section = load_font(13, bold=True)
    font_row = load_font(15)
    font_hex = load_font(15)

    y = MARGIN
    draw.text((MARGIN, y), "TangoDB CRM — цветовая палитра (Studio Controller)", fill="#1e293b", font=font_title)
    y += TITLE_H

    for section_idx, (section_name, colors) in enumerate(PALETTE):
        if section_idx > 0:
            y += SECTION_GAP
        draw.text((MARGIN, y), section_name, fill="#64748b", font=font_section)
        y += SECTION_TITLE_H

        for token, hex_color in colors:
            swatch_x = MARGIN
            swatch_y = y + 6
            swatch_h = ROW_H - 12
            rgb = hex_to_rgb(hex_color)
            border = "#e2e8f0" if hex_color.lower() in ("#ffffff", "#fff") else hex_color

            draw.rounded_rectangle(
                (swatch_x, swatch_y, swatch_x + SWATCH_W, swatch_y + swatch_h),
                radius=8,
                fill=rgb,
                outline=hex_to_rgb(border),
                width=1,
            )

            label = f"{token}"
            hex_label = hex_color.upper()
            label_x = swatch_x + SWATCH_W + GAP
            draw.text((label_x, y + 10), label, fill="#1e293b", font=font_row)
            draw.text((label_x + 220, y + 10), hex_label, fill="#5663d6", font=font_hex)

            on_swatch = text_color_for_bg(hex_color)
            draw.text(
                (swatch_x + 10, swatch_y + swatch_h - 22),
                hex_label,
                fill=on_swatch,
                font=load_font(11),
            )

            y += ROW_H

    out = Path(__file__).resolve().parents[1] / "crm-colors-palette.png"
    img.save(out, format="PNG", optimize=True)
    print(f"Saved: {out} ({WIDTH}x{height})")


if __name__ == "__main__":
    main()
