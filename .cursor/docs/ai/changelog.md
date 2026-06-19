# Changelog

История значимых изменений кода. Обновлять при каждом изменении кода.

## Формат

```
YYYY-MM-DD — краткое описание (причина / контекст)
```

## Записи

2026-06-19 — Продажа абонемента: уменьшены отступы между полями формы (panel-form-stack-compact).
2026-06-19 — PricesPanel: откат auto-fill/minmax — восстановлена сетка секций; ширина карточек через меньше колонок (xl:3) и w-36.
2026-06-19 — PricesPanel: шире карточки тарифов (min 20rem, auto-fill) — сумма и кнопки не обрезаются в узкой сетке.
2026-06-19 — PricesPanel: поле суммы тарифа шире (w-36), чтобы вмещались длинные числа.
2026-06-19 — PricesPanel: секции тарифов вертикально (групповые → персональные → пакеты), карточки внутри секции — горизонтальная сетка.
2026-06-19 — Создание кастомных тарифов: organization_id в insert + миграция (DEFAULT auth_organization_id, CHECK tariff_*).
2026-06-19 — Унификация акцентных цветов: violet и emerald заменены на indigo по всему tangodb/; design_system.md зафиксирован как правило проекта.
2026-06-19 — Типографика nav/logo: text-[8px]/text-[9px] заменены на text-[10px]/text-[11px] для читаемости и соответствия design system.
2026-06-19 — Аудит design system: CsvExportModal rounded-xl, ClientAutocomplete dropdown z-50, иконки stat-карточек Dashboard w-5 h-5.
2026-06-19 — Empty state: PricesPanel, DisciplinesPanel и AttendancePanel приведены к эталону (py-20, иконка w-8, text-sm).
2026-06-19 — Sell-панели и popup на md+: полная ширина под PageTabs, двухколоночные формы, шире модали; мобильный layout без изменений.
