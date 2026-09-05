# Цветовая палитра CRM — Studio Controller

Актуальные правила цветов основного приложения (`tangodb/`). Палитра **Light Theme** Studio Controller внедрена с версии **2.9.81**; дополнения — **2.9.82**.

**Связанные документы:** `.cursor/docs/ai/design_system.md` (UI-паттерны), демо [`tangodb/schedule-preview-new-colors.html`](../../tangodb/schedule-preview-new-colors.html), PNG [`tangodb/crm-colors-palette.png`](../../tangodb/crm-colors-palette.png).

**Источник токенов в коде:** `tangodb/src/index.css` (`@theme`), `tangodb/src/lib/scheduleColors.ts`, `tangodb/scripts/generate-crm-colors-png.py`.

---

## Принципы

| Область | Правило |
|---------|---------|
| Бренд / CTA / nav | `indigo-*` (тёплая шкала Studio Controller) |
| Успех / «оплачено» / «подтверждён» / присутствие | `green-*` — **не** для кнопок |
| Ошибка / долг / destructive | `rose-*` |
| Предупреждение (баннеры, «ожидает») | `amber-*` — **не** для кнопок |
| Блоки расписания | Мягкий фон + цветной текст + акцентная полоска слева (3px) |
| `violet-*` / `emerald-*` / `purple-*` | **Запрещены** в общем UI; мероприятия в сетке — кастомные hex в `scheduleColors.ts` |
| `sky-*` | **Не использовать** (персональные уроки — indigo pastel, не sky) |

---

## Нейтральные (slate / Graphite)

Стандартные Tailwind slate, без переопределения в `@theme`.

| Токен | Hex | Назначение |
|-------|-----|------------|
| `white` | `#FFFFFF` | Карточки, header, sidebar, модали |
| `slate-50` | `#F8FAFC` | Фон приложения |
| `slate-100` | `#F1F5F9` | Hover, разделители, неактивные табы |
| `slate-200` | `#E2E8F0` | Границы карточек, полей, header |
| `slate-300` | `#CBD5E1` | Пунктир, scrollbar thumb |
| `slate-400` | `#94A3B8` | Вторичный текст, метки полей; сегмент «Прочее» в структуре выручки |
| `slate-500` | `#64748B` | Подписи; маркер группового занятия в списках |
| `slate-600` | `#475569` | Текст навигации; **сдача зала** в структуре выручки; блок аренды в расписании |
| `slate-700` | `#334155` | Текст sidebar; граница блока аренды в расписании |
| `slate-800` | `#1E293B` | Основной текст, заголовки |
| `slate-900` | `#0F172A` | Overlay backdrop |
| `slate-950` | `#020617` | Hover текста навигации |

---

## Акцент бренда (indigo)

Переопределены в `@theme` (`index.css`). `indigo-300` / `indigo-400` — Tailwind defaults (`#A5B4FC`, `#818CF8`), для scrollbar hover и focus border.

| Токен | Hex | Назначение |
|-------|-----|------------|
| `indigo-50` | `#F5F7FF` | Фон активного nav, highlight-карточки |
| `indigo-100` | `#E8ECFF` | Focus ring полей, accent-границы |
| `indigo-200` | `#D7DEFF` | Hover border; border персональных в расписании и списках |
| `indigo-500` | `#6B76DC` | Иконки секций, loader, focus outline; абонементы в структуре выручки |
| `indigo-600` | `#5663D6` | **Primary CTA**, логотип, ссылки, маркер персонального в списках |
| `indigo-700` | `#4652B8` | Активный текст nav; secondary outline; персональные в структуре выручки |
| `indigo-800` | `#39449A` | Hover ссылок; текст персональных блоков в расписании |
| `indigo-900` | `#2F3778` | Тёмный акцент шкалы |

---

## Семантические цвета

### Успех / подтверждение (green)

| Токен | Hex | Назначение |
|-------|-----|------------|
| `green-50` | `#ECF7F1` | Фон бейджа «оплачено», «подтверждён», присутствие |
| `green-100` | `#D9EFE3` | Границы success-бейджей (Google Calendar synced и др.) |
| `green-500` | `#3F8F6B` | Акцент border (~30% в бейджах) |
| `green-600` | `#2E7D56` | Toast success, текст позитивных статусов |
| `green-700` | `#266B49` | Текст success-бейджей (synced и др.) |

### Ошибка / долг / destructive (rose)

| Токен | Hex | Назначение |
|-------|-----|------------|
| `rose-50` | `#FFF5F6` | Фон блока должников, бейдж «отменён» |
| `rose-100` | `#FDE8EA` | Границы в блоке должников |
| `rose-300` | `#F3A0AA` | Hover border destructive; border конфликта в расписании |
| `rose-500` | `#E45B68` | Акцент (редко) |
| `rose-600` | `#D64554` | Ошибки, долг, destructive CTA, ring неоплаты |
| `rose-700` | `#B93645` | Текст конфликта в расписании |

### Предупреждение (amber)

| Токен | Hex | Назначение |
|-------|-----|------------|
| `amber-50` | `#FFFBEB` | Фон warning-баннеров |
| `amber-100` | `#FEF3C7` | Граница бейджа «ожидает» |
| `amber-500` | `#D89A24` | Бейдж «ожидает» (акцент) |
| `amber-600` | `#B7791F` | Текст бейджа «ожидает» |
| `amber-800` | `#92400E` | Demo retention, пассивные баннеры (Tailwind default) |

### Telegram

| Токен | Hex |
|-------|-----|
| `telegram` | `#229ED9` |
| `telegram-hover` | `#1C82B4` |

---

## Расписание — блоки занятий (`scheduleColors.ts`)

Токены `--color-lesson-*` в `@theme`; классы `bg-lesson-*`, `text-lesson-*`, `border-lesson-*`.

### Групповое занятие

| Свойство | Hex / класс |
|----------|-------------|
| Фон | `#F5F7FA` (`lesson-group-bg`) |
| Граница | `#E2E8F0` (`lesson-group-border`) |
| Текст | `#334155` (`lesson-group-text`) |
| Акцент (полоска) | `#64748B` (`lesson-group-accent`) |

### Персональное занятие

| Свойство | Hex / класс |
|----------|-------------|
| Фон | `#EEF0FF` (`lesson-personal-bg`) |
| Граница | `#D7DEFF` (`lesson-personal-border`) |
| Текст | `#39449A` (`lesson-personal-text`) |
| Акцент (полоска) | `#5663D6` (`lesson-personal-accent`) |

### Мероприятие

| Свойство | Hex / класс |
|----------|-------------|
| Фон | `#F5F0FF` (`lesson-event-bg`) |
| Граница | `#E5DBFF` (`lesson-event-border`) |
| Текст | `#6336A8` (`lesson-event-text`) |
| Акцент (полоска) | `#7C4DCC` (`lesson-event-accent`) |

### Аренда зала

| Свойство | Класс |
|----------|-------|
| Фон | `bg-slate-600` |
| Граница | `border-slate-700` |
| Текст | `text-white` |
| Акцентная полоска | нет |

### Конфликт / долг

| Свойство | Hex / класс |
|----------|-------------|
| Фон | `#FFFFF5` (`lesson-conflict-bg`) |
| Граница / ring | `#F3A0AA` / `#D64554` (`lesson-conflict-border` / `lesson-conflict-accent`) |
| Текст | `#B93645` (`lesson-conflict-text`) |

### Аренда Mini App (холд)

| Свойство | Значение |
|----------|----------|
| Базовые цвета | `slate-600` / `slate-700`, белый текст |
| Штриховка | `repeating-linear-gradient` (без rose ring) |
| Долг `lifecycle=debt` | `ring-lesson-conflict-accent` (`#D64554`) |

### Выделение выбранного урока

| Свойство | Значение |
|----------|----------|
| Ring | `ring-indigo-600` (`#5663D6`) |

---

## Статусные бейджи

| Статус | Фон | Текст | Граница |
|--------|-----|-------|---------|
| Активный | `indigo-50` `#F5F7FF` | `indigo-700` `#4652B8` | `indigo-200` `#D7DEFF` |
| Подтверждён / оплачено | `green-50` `#ECF7F1` | `green-600` `#2E7D56` | `green-500` ~30% |
| Ожидает | `amber-50` `#FFFBEB` | `amber-600` `#B7791F` | `amber-100` `#FEF3C7` |
| Отменён | `rose-50` `#FFF5F6` | `rose-600` `#D64554` | `rose-100` `#FDE8EA` |
| Черновик | `slate-100` | `slate-600` | `slate-200` |

---

## UI-элементы

| Элемент | Классы / hex |
|---------|--------------|
| Primary button | `bg-indigo-600` hover `indigo-700` |
| Secondary button | `text-indigo-700` + `border-indigo-200` |
| Активный пункт sidebar | `bg-indigo-50` + `text-indigo-700` + `border-l-indigo-600` |
| Focus outline (`:focus-visible`) | `#6B76DC` |
| Focus ring полей | `ring-indigo-100` |
| Scrollbar thumb hover | `indigo-400` (Tailwind default) |
| Loader / spinner | `text-indigo-500` |
| Toast success | `text-green-600` |
| Toast error | `text-rose-600` |
| Toast info | `text-indigo-500` |

---

## Списки и таблицы (вне сетки расписания)

| Тип | Маркер | Фон строки |
|-----|--------|------------|
| Групповой | `bg-slate-500` | `bg-slate-50` |
| Персональный | `bg-indigo-600` | `bg-indigo-50/60`, border `indigo-200` |

Эталон: `AttendancePanel.tsx`, `SchedulePanel.tsx`, `PersonalLessonsList.tsx`.

---

## Финансовый обзор — структура выручки (`FinancialDashboard.tsx`)

Константа `SPLIT_COLORS`:

| Сегмент | Класс | Hex (прибл.) |
|---------|-------|--------------|
| Абонементы (`subscription`) | `bg-indigo-500` | `#6B76DC` |
| Персональные (`personal`) | `bg-indigo-700` | `#4652B8` |
| Разовые (`single_visit`) | `bg-indigo-400` | `#818CF8` |
| Прочее (`other`) | `bg-slate-400` | `#94A3B8` |
| Сдача зала (`rental`) | `bg-slate-600` | `#475569` |

> **Не использовать** `violet-*` для аренды — цвет совпадает с семантикой аренды зала в расписании (`slate-600`).

---

## Telegram Mini App (`tangodb-renter/`)

Версия **0.1.1**. Те же токены `@theme` в `tangodb-renter/src/index.css`, общие классы в `crmUi.ts`.

| Область | Правило |
|---------|---------|
| CTA / nav / chips | `indigo-600` / `indigo-700` |
| Своя бронь в сетке (`mine`) | `bg-slate-600`, ring `slate-700` — как аренда в CRM |
| Холд (`mine_hold`) | `slot-hold` (slate-600 + штриховка) |
| Долг (`mine_debt`) | `bg-rose-600`, ring `rose-700` |
| Успех (бронь создана) | `successBannerCls` → `green-50` / `green-700` |
| Кредит в истории кошелька | `text-green-700`; дебет — `text-rose-600` |
| Entry spinner fallback | `#5663D6` (не sky) |

**Не использовать:** `emerald-*`, `violet-*`, `sky-*`.

---

## Файлы-эталоны

| Область | Файл |
|---------|------|
| Токены Tailwind | `tangodb/src/index.css` |
| Блоки расписания | `tangodb/src/lib/scheduleColors.ts`, `LessonBlock.tsx` |
| Кнопки | `tangodb/src/components/ui/buttonStyles.ts` |
| Toast | `tangodb/src/App.tsx` |
| Структура выручки | `tangodb/src/components/FinancialDashboard.tsx` |
| PNG-палитра | `tangodb/scripts/generate-crm-colors-png.py` → `crm-colors-palette.png` |
| UI-паттерны (общие) | `.cursor/docs/ai/design_system.md` |
| Mini App | `tangodb-renter/src/index.css`, `tangodb-renter/src/lib/crmUi.ts` |

---

## Changelog документа

| Дата | Изменение |
|------|-----------|
| 2026-09-05 | Mini App (0.1.1): `@theme`, `crmUi`, slate для своих слотов, green вместо emerald |
| 2026-09-05 | Документ переписан: актуальные правила вместо плана миграции; структура выручки (`slate-600` для rental, 2.9.82) |
| 2026-09-05 | Внедрено в CRM (2.9.81): `@theme`, `scheduleColors.ts`, `LessonBlock`, design_system |
| 2026-09-05 | Первая версия по preview `schedule-preview-new-colors.html` |
