# TangoDB — Расписание: Технический аудит, ТЗ и план реализации

> Документ создан: 2026-06-21  
> Версия: **1.4** (уточнение переходного периода locationId/teacherMemberId, 2026-06-22)  
> Базовый контекст: `tangodb_roles_rbac_TZ.md`, `.cursor/docs/ai/design_system.md`, `.cursor/docs/ai/architecture.md`

---

## 1. Исполнительное резюме

Запрошено полное переосмысление раздела «Расписание групп»: от карточного списка → к недельной сетке-календарю (как в CRM на скриншоте). Дополнительно: слияние персональных уроков в расписание, права по ролям, история изменений, долги — под расписанием.

**Масштаб работ:** большой. Затрагивает БД, 10+ компонентов, 4+ хука, навигацию, RBAC-согласование. Оценка: **10 промптов-агентов (Промпт 0–9)** — decision log, миграция/хуки, UI-сетка, CRUD, долги, навигация, регрессия.

**Статус решений:** ключевые архитектурные вопросы из §3 согласованы (§11). Перед стартом — зафиксировать в `decision_log.md`.

---

## 2. Аудит текущего состояния

### 2.1. Что уже есть (переиспользуем)

| Что | Файл | Статус |
|-----|------|--------|
| Таблица `schedule_slots` (day_of_week + time + time_end) | `20260622000001_v2_business_schema.sql` | ✅ Основа сетки |
| Таблица `personal_lessons` (date + time_start + time_end) | миграция v2 | ✅ Отображаем в сетке |
| Таблица `locations` | миграция v2 | ✅ Секции сетки |
| View `financial_debtors_v` | `20260702000001` | ✅ Долги (фин. контекст) |
| `useSchedule()` | `hooks/useSchedule.ts` | ✅ Рефакторить |
| `useReplaceGroupSchedule()` | `hooks/useSchedule.ts` | ⚠️ Заменить на версионирование |
| `usePersonalLessons()` | `hooks/usePersonalLessons.ts` | ✅ + `dateRange` |
| `useFinancialDebtors()` | `hooks/useFinancialDebtors.ts` | ✅ Не создавать `useDebtors()` |
| Конфликты времени | `lib/utils.ts` | ✅ `findBookingScheduleConflict`, `timesOverlap` |
| Конфликты в форме группы | `SchedulePanel.tsx` → `getSlotConflict` | ⚠️ Перенести/объединить с utils |
| Форма группы | `SchedulePanel.tsx` | ✅ Логика → попапы |
| `SellPackageModal` | `ui/SellPackageModal.tsx` | ✅ Переиспользовать |
| `ConfirmDialog`, `AppSelect`, `RequirePermission` | `components/ui/` | ✅ Переиспользуем |
| RLS `schedule_slots` / `personal_lessons` | `20260623000001` + RBAC R2–R6 | ⚠️ Согласовать с матрицей §4.4 |
| `teachers_can_view_full_schedule` | `organization_settings` | ✅ Уже в настройках org |

### 2.2. Чего нет (нужно создать)

| Что | Приоритет |
|-----|-----------|
| Папка `components/schedule/` + `WeeklyScheduleGrid` | 🔴 Критично |
| `valid_from` / `valid_to` в `schedule_slots` + правка UNIQUE-индексов | 🔴 Критично |
| Popup просмотра / добавления / редактирования | 🔴 Критично |
| Мини-календарь выбора недели (без новой зависимости) | 🟡 Важно |
| Фильтр по преподавателю | 🟡 Важно |
| Операционный блок долгов под расписанием | 🟡 Важно |
| Шаг 15 мин в time picker (`TimeSelect`) | 🟡 Важно |
| Слияние `/personal` → `/schedule` | 🟡 Важно |
| Индикатор долга (красная ячейка) | 🟢 Средне |

---

## 3. Архитектурные вопросы (решены 2026-06-22)

> Исторический контекст. Ответы зафиксированы в §11 — реализация может стартовать без повторного согласования.

### ПРОБЛЕМА 1: «История версий» расписания → ✅ `valid_from` / `valid_to`

`schedule_slots` — еженедельный шаблон без поля `date`. Версионирование через два DATE-поля (§4.1, §6.1).

### ПРОБЛЕМА 2: Красная ячейка → ✅ только `personal_lessons.paid = 'no'`

Групповые занятия не красим по абонементам клиентов.

### ПРОБЛЕМА 3: Конфликт персональных уроков → ✅ по конкретной `date`

`getSlotConflict` в `SchedulePanel.tsx` ошибочно сопоставляет `day_of_week` персонального урока с шаблоном. Использовать `findBookingScheduleConflict` из `lib/utils.ts` (уже есть в `PersonalLessonsPanel`).

### ПРОБЛЕМА 4: Шаг 15 мин vs «кривое» время в БД → ✅ показываем как есть, при edit — snap к 15 мин

### ПРОБЛЕМА 5: Упразднение `/personal` → ✅ CRUD в расписании; `SellPackageModal` — кнопка в попапе персонального урока

### ПРОБЛЕМА 6: Timezone → ✅ единый локальный TZ школы, TEXT «HH:MM» без конвертации

### ПРОБЛЕМА 7: Компоновка локаций → ✅ вертикальные секции (не табы)

---

## 4. Аудит: баги, несостыковки, уязвимости, оптимизации

> Ревизия документа и кодовой базы. Все пункты учтены в §4.5–§7 и в промптах §10/§13.

### 4.1. Критические баги в проектировании миграции

| # | Проблема | Почему ломает | Решение |
|---|----------|---------------|---------|
| B1 | UNIQUE-индексы `(org, day_of_week, time, group_name)` без учёта версий | INSERT новой версии после edit → `23505` | Добавить `AND valid_to IS NULL` во все partial UNIQUE-индексы (`20260628000003_schedule_group_name.sql`) |
| B2 | `valid_from DEFAULT CURRENT_DATE` для существующих строк | Слоты «исчезнут» при просмотре прошлых недель до даты миграции | Backfill: `valid_from = '2000-01-01'` (или `organizations.created_at::date`) для всех текущих строк |
| B3 | Противоречие в логике дат версий | §3 пример: `valid_to = 17.06`, `valid_from = 18.06`; §4.1 старое: «valid_to = вчера, valid_from = сегодня» | **Канон:** при редактировании в день **E**: `old.valid_to = E` (последний день старой версии), `new.valid_from = E + 1 day`. При удалении в день **E**: `valid_to = E` (слот активен включительно E; с E+1 не показываем) |
| B4 | Partial index `WHERE valid_to >= CURRENT_DATE` | Индекс «протухает» — строки с `valid_to` в прошлом выпадают из индекса, ломая запросы истории | Индекс только на активные: `WHERE valid_to IS NULL`; фильтр недели — в запросе |
| B5 | П.1 «табы для локаций» vs §4.2 / §11 вертикальные секции | Противоречие в ТЗ | **Только вертикальные секции** — табы убрать из П.1 |
| B6 | Время хранится как `TEXT`, а `timesOverlap` сравнивает строки | Legacy `9:00` сломает сортировку/overlap (`"9:00" > "14:00"`) | Канон `HH:MM`, нормализация при map/input, сравнение через `timeToMinutes()` |
| B7 | Файл миграции жёстко назван `20260722000001...` | В репозитории уже есть миграции до `20260709000001`; жёсткая дата может нарушить порядок или конфликтовать | При реализации выбрать **следующий timestamp после последней миграции**; в документе имя — пример |
| B8 | Конфликты времени проверяются только в UI | Два клиента/пользователя могут одновременно вставить пересекающиеся уроки | Добавить DB-trigger `prevent_schedule_overlap` / `prevent_personal_overlap` или явно зафиксировать риск как accepted; для MVP лучше trigger |
| B9 | `useAddPersonalLessons()` сейчас не пишет `location_id` / `teacher_member_id` | Персональные уроки не попадут в секции локаций и scope преподавателя будет неполным | **Промпт 1 ✅:** hook пишет поля; optional в типе (legacy `/personal`). **Промпт 4:** `requireScope: true` в schedule-формах + validation в mutation. **Промпт 7:** redirect `/personal` — новые уроки только через schedule |
| B10 | `useUpdatePersonalLesson()` обновляет только date/time | Edit popup не сможет корректно менять локацию, преподавателя, дисциплину, оплату и клиентов | Расширить mutation до полного редактирования или явно ограничить UI только переносом времени |
| B11 | В документе есть два разных deep-link формата: `?action=sell` и `?tab=sell` | Redirect `/personal/sell` может попасть не в тот режим попапа | Канон: `/schedule?action=sell`; поддержать backward redirect из `/personal/sell` |

### 4.2. Несостыковки с RBAC (`permissions.ts` + RLS)

| # | В ТЗ | В коде сейчас | Действие |
|---|------|---------------|----------|
| R1 | `accountant` — просмотр расписания (§4.4) | `canReadScopedCrm` → `false` для accountant; panel `schedule` недоступен | **MVP:** accountant **не** видит расписание (как в `tangodb_roles_rbac_TZ.md` §4). Блок долгов для accountant — только на `/finance` |
| R2 | `reception` — добавление персональных (§4.4) | `canAccessPanel('admin', 'schedule')` → **запрещён** для reception (`20260703000001`) | **MVP:** reception **не** в scope расписания. Если нужен — отдельная задача R7: `schedule.read` + `personal_lessons.write` для reception |
| R3 | `admin` — только персональные CRUD (§5.5) | RLS: `can_write_all_business()` → admin пишет `schedule_slots` | UI: скрыть групповые действия. **RLS не менять в MVP** — admin операционно может править группы (как сейчас). Зафиксировать в `decision_log.md` |
| R4 | `teacher` — только свои персональные | RLS `schedule_slots_write_teacher` — teacher может INSERT/UPDATE групповые слоты в scope | UI: teacher не видит «Групповой урок». RLS-ужесточение — **отложить** (отдельная миграция, не блокирует MVP) |
| R5 | П.2: кнопки edit/delete «только owner/director» | `SchedulePanel`: `canEditScheduleTeacher = owner \|\| director`; admin имеет `personal_lessons.write` | **Согласовано:** групповые — owner/director; персональные — по §5.5 (`RequirePermission` + `context`) |

### 4.3. Уязвимости и приватность данных

| # | Риск | Рекомендация |
|---|------|--------------|
| S1 | `financial_debtors_v` требует `can_read_financial()` и содержит PII + суммы | **Не** показывать этот view всем ролям под расписанием |
| S2 | ТЗ п.17 «все роли видят блок долгов» | Разделить: **операционный** блок (только `paid = 'no'` персональные, без сумм для teacher) + **финансовый** (полный view на `/finance`) |
| S3 | Teacher видит чужие персональные уроки в сетке | Фильтровать client names по `can_view_all_clients` / scope; в `LessonInfoPopup` маскировать клиентов вне scope |
| S4 | Hard DELETE `personal_lessons` | Сохранить; audit trigger уже пишет в `audit_log`. Для групповых — только soft через `valid_to` |
| S5 | `usePersonalLessons()` при ошибке teacher-view делает fallback на `personal_lessons` | При ошибке view/RLS можно случайно запросить больше данных, чем разрешено teacher | Для teacher **не делать fallback** на полную таблицу; падать с error state |
| S6 | Операционный debt block может раскрыть финансовые суммы через reuse старых компонентов | Teacher/admin не должны получать `price`/суммы вне финансового контура | Для ScheduleDebtorsBlock использовать отдельный shape без `price`; суммы показывать только `owner/director` при явном разрешении |

### 4.4. Оптимизации (не ломая проект)

| # | Что | Как |
|---|-----|-----|
| O1 | Дублирование conflict-check | Объединить `getSlotConflict` + utils в `lib/scheduleConflicts.ts` (re-export из utils + location filter) |
| O2 | `timeToMinutes` | Добавить в `lib/utils.ts` — используется в `computeDisplayRange`, `TimeSelect` |
| O3 | RPC `get_schedule_for_week` | **Отложить** — клиентский фильтр в `useScheduleForWeek` достаточен для 1 недели; RPC — если perf-проблемы |
| O4 | `react-day-picker` | **Не ставить** — в проекте нет зависимости; `WeekPickerPopover` на CSS + нативные `Date`/`Intl` |
| O5 | `disciplines.color` | **Поля нет** в схеме — цвет только через hash(`discipline_id`) + палитра из `design_system.md` |
| O6 | Перекрывающиеся уроки в одной колонке | Absolute positioning + `z-index`; side-by-side при 2+ overlap |
| O7 | Query keys | `useScheduleForWeek` → `withOrgId(['schedule', weekStartISO])` для точного invalidation |
| O8 | `useReplaceGroupSchedule` | Deprecate после версионирования; `useEditGroupSchedule` — единственный путь edit |
| O9 | `date-fns` | **Не использовать** — зависимости нет в `package.json`; неделя/форматирование через `Date` + `Intl` + helpers в `lib/scheduleWeek.ts` |
| O10 | `DisplayLesson` | Сделать discriminated union `{ kind: 'group' | 'personal' }`, чтобы не плодить nullable-поля и `any` |
| O11 | Загрузка персональных уроков | `usePersonalLessons({ dateRange })` вместо `yearMonth`, чтобы не грузить весь месяц ради одной недели |
| O12 | Конфликты | `scheduleConflicts.ts` должен принимать `locationId`, `excludeId`, `date`, `validity`, и работать в минутах, не строками |

### 4.5. Граничные случаи UI (добавлено в ТЗ)

- **Текущая неделя, прошедший день:** edit/delete групповых **запрещён** если `lessonDate < today` (не только `W_end < today`).
- **Сегодняшний день:** edit группового → новая версия с `valid_from = tomorrow` (старая ещё видна сегодня).
- **Пустая ячейка в прошлом:** no-op или toast «Нельзя добавить занятие в прошлом».
- **AttendancePanel** ссылка `/personal` → обновить на `/schedule` (Промпт 7).
- **Dashboard shortcuts** `personalView` → `/schedule` (Промпт 7).
- **Deep links:** `/personal/sell` → `/schedule?action=sell`; `/personal/book` → `/schedule?action=sell` для обратной совместимости.
- **Teacher view fallback:** если `personal_lessons_teacher_v` недоступен, показывать error state, не fallback на полную таблицу.
- **Персональные без `location_id` (legacy /personal, Промпты 2–6):** до redirect `/personal` → `/schedule` (Промпт 7) `PersonalLessonsPanel` может создавать уроки с `location_id = NULL`. В недельной сетке такие уроки **не терять**: показывать в отдельной секции «Без локации» (вертикальный блок, как у залов). Новые уроки из сетки (Промпт 4+) — только с локацией и преподавателем.

---

## 5. Согласованные решения (реализация)

### 5.1. Архитектура `schedule_slots` с историей версий

```sql
ALTER TABLE schedule_slots
  ADD COLUMN valid_from DATE NOT NULL DEFAULT '2000-01-01',
  ADD COLUMN valid_to   DATE CHECK (valid_to IS NULL OR valid_to >= valid_from);
```

**Каноническая логика дат (B3):**

| Действие | Старая запись | Новая запись |
|----------|---------------|--------------|
| Создание | — | `valid_from = today`, `valid_to = NULL` |
| Редактирование в день E | `valid_to = E` | `valid_from = E + 1 day`, `valid_to = NULL` |
| Удаление в день E | `valid_to = E` | — (без INSERT) |

**Фильтр недели** `[W_start, W_end]`:

```sql
valid_from <= W_end AND (valid_to IS NULL OR valid_to >= W_start)
```

**Разворот в даты:** для каждого слота — день недели `day_of_week` → конкретная дата внутри `[W_start, W_end]`.

**Прошлое:** если `lessonDate < today` — edit/delete скрыты (read-only).

### 5.2. Структура недельной сетки

**Компоновка:** вертикальные секции по локациям (как на CRM-скриншоте). **Без табов.**

```
[< Прошлая неделя]  [16–22 июня 2026]  [Следующая неделя >]  [📅]  [Преподаватель ▼]

━━━━━━━━━━━━━━━━━━ Зал "Большой зал" ━━━━━━━━━━━━━━━━━━
        Пн 16   Вт 17   Ср 18   Чт 19   Пт 20   Сб 21   Вс 22
07:00   |       |       |       |       |       |       |       |
...
19:00   |[Бальные - Нач]|       |[Бальные - Нач]|       |[Персональный]|
...
```

- Строка = 15 мин; высота блока = `(durationMin / 15) * ROW_HEIGHT_PX`
- Цвет: hash(`discipline_id`) → палитра indigo/violet/teal/amber/rose
- **Красный** = персональный с `paid = 'no'`
- **Серый** = занятие в прошлом (`lessonDate < today`)
- Перекрытия: absolute layout в `DayColumn`

### 5.3. Навигация по неделям

- State: `selectedWeekStart: Date` (ISO Monday, `jsDayToIsoDow`)
- `<` / `>` → ±1 неделя
- `📅` → `WeekPickerPopover` (кастомный, без новых npm-пакетов)

### 5.4. Попапы

| Действие | Попап |
|----------|-------|
| Клик на занятие | `LessonInfoPopup` — детали + edit/delete по ролям |
| Клик на пустую ячейку (write-роли) | `AddLessonTypePopup` — Групповой / Персональный |
| «Групповой» | `AddGroupLessonForm` — локация readonly |
| «Персональный» | `AddPersonalLessonForm` + `SellPackageModal` (кнопка «Продать пакет») |
| Edit | `EditLessonPopup` |
| Delete | `ConfirmDialog` |

### 5.5. Матрица прав (MVP, согласовано с кодом)

| Роль | Просмотр сетки | Групповой CRUD | Персональный CRUD |
|------|----------------|----------------|-------------------|
| owner | ✅ | ✅ | ✅ |
| director | ✅ | ✅ | ✅ |
| admin | ✅ | ❌ UI * | ✅ |
| teacher | ✅ † | ❌ UI | ✅ своё ‡ |
| reception | ❌ §R2 | ❌ | ❌ (вне MVP) |
| accountant | ❌ §R1 | ❌ | ❌ |

\* admin имеет RLS write на `schedule_slots`, но в MVP UI групповые действия скрыты (§R3); ужесточение RLS — отдельный эпик.  
† `teachers_can_view_full_schedule` (default `true`).  
‡ + scope по `discipline_id` / `location_id` / `teacher_member_id`.

**Проверки в UI:** `RequirePermission` с `context: { disciplineId, locationId }`.  
**Групповые кнопки:** `role === 'owner' || role === 'director'` (как `canEditScheduleTeacher` в `SchedulePanel`; admin не видит групповой CRUD в UI).

### 5.6. Блок долгов под расписанием

**Операционный блок** (`ScheduleDebtorsBlock`) — для ролей с `schedule.read`:

- Строки: персональные с `paid = 'no'` за текущую и будущие недели
- Без сумм для `teacher`; для `admin` тоже не показывать финансовые агрегаты, только статус «не оплачено»
- Абонементы с низким остатком — **не** показывать здесь (только на `/finance`)
- Не использовать `financial_debtors_v`; не прокидывать `price` в UI-shape для teacher/admin

**Финансовый блок** — существующий `useFinancialDebtors()` на странице Finance (без изменений).

### 5.7. Временной диапазон

```typescript
function normalizeTime(hhmm: string): string {
  const [rawH, rawM = "0"] = hhmm.split(":");
  const h = Number(rawH);
  const m = Number(rawM);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error("Invalid HH:MM time");
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = normalizeTime(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function timesOverlapByMinutes(start1: string, end1: string, start2: string, end2: string): boolean {
  return timeToMinutes(start1) < timeToMinutes(end2) && timeToMinutes(start2) < timeToMinutes(end1);
}

function computeDisplayRange(slots: DisplayLesson[]): { start: number; end: number } {
  const DEFAULT_START = 7 * 60;
  const DEFAULT_END = 22 * 60;
  if (slots.length === 0) return { start: DEFAULT_START, end: DEFAULT_END };
  const minStart = Math.min(...slots.map((s) => timeToMinutes(s.timeStart)));
  const maxEnd = Math.max(...slots.map((s) => timeToMinutes(s.timeEnd)));
  return {
    start: Math.min(minStart, DEFAULT_START),
    end: Math.max(maxEnd, DEFAULT_END),
  };
}
```

Шаг отображения и `TimeSelect`: 15 мин. Snap при edit; legacy `9:00` нормализовать в `09:00` на уровне mapper/input, чтобы сортировка и конфликты не зависели от строкового сравнения.

---

## 6. Техническое задание (по пунктам)

### П.1 Недельная сетка вместо карточного списка

- Удалить карточный список из `SchedulePanel.tsx` (логику форм — в попапы)
- `WeeklyScheduleGrid.tsx` — время × 7 дней
- **Вертикальные секции** `LocationScheduleSection` × N (не табы)
- Данные: `schedule_slots` (версии + разворот по неделе) + `personal_lessons`

### П.2 Клик на занятую ячейку → `LessonInfoPopup`

- Детали: название, дисциплина, время, преподаватель, клиент(ы) для personal
- **Групповые** edit/delete: owner, director; если `lessonDate < today` — read-only
- **Персональные** edit/delete: по §5.5; teacher — только `teacher_member_id === self`
- Delete: групповые → soft (`valid_to`); personal → hard DELETE

### П.3 Клик на пустую ячейку → добавление

- owner/director: выбор групповой / персональный
- admin: только персональный (UI)
- teacher: только персональный (своё)
- Локация, преподаватель и дата/время предзаполнены из ячейки; `teacher` не может выбрать другого преподавателя
- `useAddPersonalLessons` должен принимать и писать `locationId`, `teacherMemberId`
- Прошлые даты: no-op + toast

### П.4–П.18

Пункты П.4–П.18 из v1.0 сохранены с уточнениями §4–§5:

- **П.4** → см. §5.5 (accountant/reception исключены из MVP)
- **П.5** → `WeekPickerPopover` кастомный
- **П.7–П.9** → `validateTimeRange`, `TimeSelect`, автозаполнение `timeEnd` + `findBookingScheduleConflict`
- **П.10** → `teachersCanViewFullSchedule` из `usePermissions`
- **П.11** → `lib/scheduleConflicts.ts` (не дублировать utils)
- **П.14** → redirect `/personal` → `/schedule`, `/personal/sell` и `/personal/book` → `/schedule?action=sell`; обновить `App.tsx`, Dashboard, AttendancePanel, `permissions.ts`
- **П.15** → фильтр в `ScheduleToolbar`, client-side filter
- **П.17** → §5.6 операционный блок; красная ячейка = `paid = 'no'`
- **П.18** → `design_system.md`, `motion/react`, tailwind, без inline-стилей

---

## 7. Изменения в базе данных

### 7.1. Миграция: версионирование + индексы

```sql
-- Файл: tangodb/supabase/migrations/<NEXT_TIMESTAMP>_schedule_versioning.sql
-- NEXT_TIMESTAMP = следующий timestamp после последней существующей миграции
-- (на 2026-06-22 последняя: 20260709000001_v2_invite_member_names.sql).
BEGIN;

ALTER TABLE schedule_slots
  ADD COLUMN IF NOT EXISTS valid_from DATE NOT NULL DEFAULT '2000-01-01',
  ADD COLUMN IF NOT EXISTS valid_to DATE CHECK (valid_to IS NULL OR valid_to >= valid_from);

-- Backfill: все текущие слоты действуют «с начала времён»
UPDATE schedule_slots SET valid_from = '2000-01-01' WHERE valid_to IS NULL;

-- B1: partial UNIQUE только для активных версий
DROP INDEX IF EXISTS schedule_slots_with_group_unique;
DROP INDEX IF EXISTS schedule_slots_legacy_no_group_unique;
DROP INDEX IF EXISTS schedule_slots_legacy_no_discipline_unique;

CREATE UNIQUE INDEX schedule_slots_with_group_unique
  ON schedule_slots (organization_id, day_of_week, time, lower(trim(group_name)))
  WHERE trim(group_name) <> '' AND valid_to IS NULL;

CREATE UNIQUE INDEX schedule_slots_legacy_no_group_unique
  ON schedule_slots (organization_id, day_of_week, time, discipline_id)
  WHERE trim(group_name) = '' AND discipline_id IS NOT NULL AND valid_to IS NULL;

CREATE UNIQUE INDEX schedule_slots_legacy_no_discipline_unique
  ON schedule_slots (organization_id, day_of_week, time)
  WHERE trim(group_name) = '' AND discipline_id IS NULL AND valid_to IS NULL;

CREATE INDEX idx_schedule_slots_active_validity
  ON schedule_slots (organization_id, valid_from, valid_to)
  WHERE valid_to IS NULL;

-- B6: канон хранения времени. Перед включением constraints нормализовать legacy '9:00' -> '09:00'.
ALTER TABLE schedule_slots
  ADD CONSTRAINT schedule_slots_time_hhmm_chk
  CHECK (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND time_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

COMMIT;
```

> Если в данных есть legacy-время без leading zero, сначала выполнить одноразовый backfill через SQL-функцию нормализации, затем добавлять `CHECK`.

### 7.1.1. DB-защита от race conflicts

UI-conflict checks обязательны, но недостаточны. Для защиты от параллельных вставок добавить trigger-level guard:

- `schedule_slots`: не допускать пересечение `time/time_end` в одной `organization_id + location_id + day_of_week` для пересекающихся периодов `valid_from/valid_to`.
- `personal_lessons`: не допускать пересечение `time_start/time_end` в одной `organization_id + location_id + date`.
- Для personal vs group: при INSERT/UPDATE personal проверять group slot на `day_of_week(date)` и валидность на конкретную дату.
- Использовать `IS NOT DISTINCT FROM` для `location_id`, чтобы `NULL`-локации сравнивались корректно.
- Исключать текущую строку по `id` при UPDATE.

Если trigger откладывается, это должно быть явным accepted risk в `decision_log.md`.

### 7.2. RLS

**Не** фильтровать `valid_from/valid_to` в RLS — это бизнес-фильтр запроса. RLS остаётся tenant + role based.

Teacher write на `schedule_slots` — **не менять** в этой миграции (§R4).

### 7.3. Хуки

```typescript
// useSchedule.ts
export function useScheduleForWeek(weekStart: Date, weekEnd: Date) {
  // schedule_slots: validity filter + expand to DisplayLesson[]
  // personal_lessons: date in [weekStart, weekEnd]
  // queryKey: withOrgId(['schedule', 'week', weekStartISO])
}

// usePersonalLessons.ts
export function usePersonalLessons(options?: { yearMonth?: string; dateRange?: { start: string; end: string }; enabled?: boolean }) {
  // dateRange имеет приоритет над yearMonth
  // teacher: table personal_lessons_teacher_v, без fallback на personal_lessons
}

export function useEditGroupSchedule() {
  // 1. UPDATE old SET valid_to = editDate
  // 2. INSERT new row with valid_from = editDate + 1
}

export function useDeleteScheduleSlot() {
  // UPDATE valid_to = editDate (не DELETE)
}

export function useAddPersonalLessons() {
  // input включает locationId + teacherMemberId
  // Промпт 1: поля optional (legacy PersonalLessonsPanel → NULL в БД)
  // Промпт 4: requireScope: true из schedule/* → reject без locationId + teacherMemberId
  // Промпт 7: redirect /personal закрывает legacy-путь
}

export function useUpdatePersonalLesson() {
  // либо full edit payload, либо документированно только date/time
}
```

Переиспользовать `useFinancialDebtors()` — **не** создавать `useDebtors()`.

---

## 8. Архитектура компонентов

```
tangodb/src/pages/SchedulePage.tsx          ← тонкая обёртка
└── components/schedule/SchedulePageContainer.tsx
    ├── ScheduleToolbar.tsx                 ← неделя + фильтр преподавателя
    │   └── WeekPickerPopover.tsx
    ├── LocationScheduleSection.tsx × N
    │   └── WeeklyScheduleGrid.tsx
    │       ├── TimeGutter.tsx
    │       └── DayColumn.tsx × 7
    │           └── LessonBlock.tsx
    ├── LessonInfoPopup.tsx
    ├── AddLessonTypePopup.tsx
    ├── AddGroupLessonForm.tsx
    ├── AddPersonalLessonForm.tsx
    │   └── SellPackageModal (reuse)
    ├── EditLessonPopup.tsx
    └── ScheduleDebtorsBlock.tsx            ← операционный, не financial_debtors_v
```

**Deprecated после миграции:** `SchedulePanel.tsx`, `PersonalPage.tsx`, `PersonalLessonsPanel.tsx` (логика → schedule/*).

**Новые утилиты:** `lib/scheduleConflicts.ts`, `lib/scheduleWeek.ts` (`expandSlotsToWeek`, `getWeekRange`, `normalizeTime`, `timeToMinutes`).

**Типы:** `ScheduleSlot` (+ `validFrom`, `validTo`) и `DisplayLesson` — в `tangodb/src/types/index.ts`.

**DisplayLesson:** discriminated union:

```typescript
type DisplayLesson = GroupDisplayLesson | PersonalDisplayLesson;

interface GroupDisplayLesson {
  kind: "group";
  slotId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  validFrom: string;
  validTo: string | null;
}

interface PersonalDisplayLesson {
  kind: "personal";
  lessonId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  paid: "yes" | "no";
}
```

---

## 9. Хуки (итог)

| Хук | Изменение |
|-----|-----------|
| `useSchedule()` | Оставить для legacy/attendance; новый код → `useScheduleForWeek` |
| `useScheduleForWeek()` | **Новый** |
| `useAddGroupSchedule()` | + `valid_from = today`; normalizer `HH:MM` |
| `useEditGroupSchedule()` | **Новый** (замена `useReplaceGroupSchedule`) |
| `useDeleteScheduleSlot()` | soft: `valid_to` |
| `useDeleteGroupSchedule()` | soft: batch `valid_to` |
| `usePersonalLessons()` | API `{ yearMonth?, dateRange?, enabled? }`; teacher без fallback на полную таблицу |
| `useAddPersonalLessons()` | + `locationId`, `teacherMemberId` в INSERT; **П1:** optional; **П4:** `requireScope: true` из schedule UI; **П7:** только schedule |
| `useUpdatePersonalLesson()` | Full edit payload или явно ограниченный перенос date/time |
| `useFinancialDebtors()` | без изменений (Finance page) |
| Операционные долги | inline query в `ScheduleDebtorsBlock` или `useScheduleDebtors()` |

---

## 10. План реализации (промпты для агента)

| # | Промпт | Зависимости |
|---|--------|-------------|
| 0 | Зафиксировать решения §11 в `decision_log.md` | — |
| 1 | SQL-миграция §7.1 + типы + `useScheduleForWeek` | 0 |
| 2 | `WeeklyScheduleGrid` + toolbar (без CRUD) | 1 |
| 3 | `LessonInfoPopup` + delete flows | 2 |
| 4 | Add popups + forms + conflict validation | 3 |
| 5 | `EditLessonPopup` + versioning mutations | 4 |
| 6 | `ScheduleDebtorsBlock` + красные ячейки | 2 |
| 7 | `/personal` redirect + nav + AttendancePanel links | 5 |
| 8 | Teacher filter (если не сделан в 2) | 2 |
| 9 | Regression checks: TS, RBAC, DB overlap tests | 1–8 |

### 10.1. Рекомендуемая последовательность

```
Промпт 0
   ↓
Промпт 1  (БД + хуки — блокирует всё остальное)
   ↓
Промпт 2  (read-only сетка)
   ↓
┌──────────────────────┬──────────────────────┐
│ Промпт 3 → 4 → 5     │ Промпт 6             │  ← можно параллельно после Промпта 2
│ (CRUD-поток)         │ (долги + красные)    │
│                      │ Промпт 8 (фильтр)    │
└──────────────────────┴──────────────────────┘
   ↓ (после Промпта 5)
Промпт 7  (redirect /personal, навигация)
   ↓
Промпт 9  (регрессия по всему)
```

Промпты **6** и **8** не зависят от 3–5; их можно выполнять параллельно с CRUD-потоком сразу после Промпта 2. Промпт **7** — только после **5** (SellPackageModal и edit flows должны быть на месте).

---

## 11. Принятые решения (2026-06-22)

| # | Решение |
|---|---------|
| 1 | ✅ `valid_from / valid_to`; канон дат — §5.1 (B3) |
| 2 | ✅ Красная ячейка = `personal_lessons.paid = 'no'` |
| 3 | ✅ `SellPackageModal` — кнопка в попапе персонального урока |
| 4 | ✅ Единый TZ школы |
| 5 | ✅ Вертикальные секции по локациям |
| 6 | ✅ UNIQUE-индексы только для `valid_to IS NULL` (B1) |
| 7 | ✅ Backfill `valid_from = '2000-01-01'` (B2) |
| 8 | ✅ Accountant/reception вне MVP расписания (R1, R2) |
| 9 | ✅ Операционный блок долгов отдельно от `financial_debtors_v` (S1, S2) |
| 10 | ✅ Не добавлять `react-day-picker` (O4) |
| 11 | ✅ RLS teacher write на schedule_slots — отложить (R4) |
| 12 | ✅ Канон deep link: `/schedule?action=sell` |
| 13 | ✅ Время хранить/сравнивать как нормализованное `HH:MM`, в логике — минуты |
| 14 | ✅ DB-trigger от overlap-race нужен для production-ready варианта |

---

## 12. Риски и рекомендации

| Риск | Вероятность | Решение |
|------|-------------|---------|
| UNIQUE без partial → миграция падает на edit | 🔴 Высокая | §7.1 — partial indexes |
| История до миграции «обрезана» | 🔴 Высокая | Backfill `2000-01-01` |
| RBAC UI vs RLS расходятся | 🟡 Средняя | MVP = UI gates; RLS — отдельный эпик |
| PII teacher видит чужих клиентов | 🟡 Средняя | Маскировка в `LessonInfoPopup` (S3) |
| Perf сетки при 50+ уроков/нед | 🟢 Низкая | 1 неделя + memo + virtual scroll позже |
| Слияние `/personal` ломает deep links | 🟡 Средняя | Redirect + query `?action=sell` |
| `useReplaceGroupSchedule` callers | 🟡 Средняя | Grep + migrate to `useEditGroupSchedule` |
| Overlap race при параллельной записи | 🟡 Средняя | DB triggers §7.1.1 + тесты |
| Legacy `9:00` ломает сравнение времени | 🟡 Средняя | `normalizeTime` + `timeToMinutes`, SQL CHECK после backfill |
| Персональные уроки без `location_id`/`teacher_member_id` | 🔴 Высокая (П1–6), 🟢 после П7 | П1: hook пишет поля; optional для legacy. П2: секция «Без локации». П4: required в форме + mutation. П7: redirect `/personal` — новые уроки только через schedule |
| Teacher fallback на полную таблицу | 🟡 Средняя | Убрать fallback для `personal_lessons_teacher_v` |

---

## 13. Промпты для агента (готовые к копированию)

> Перед каждым промптом: прочитать `.cursor/docs/ai/AI_CONTEXT.md` и файлы из блока «Прочитай сначала».

### Промпт 0 — decision log

```
Задача: зафиксировать архитектурные решения по расписанию TangoDB.

Прочитай SCHEDULE_TZ.md §11 и добавь записи в .cursor/docs/ai/decision_log.md:
- версионирование schedule_slots (valid_from/valid_to, канон дат §5.1)
- вертикальные секции локаций
- операционный vs финансовый блок долгов
- accountant/reception вне MVP расписания
- отложенное ужесточение RLS teacher на schedule_slots

Не менять код. Только decision_log.md.
```

### Промпт 1 — SQL + хук недели

```
Задача: SQL-миграция версионирования расписания в TangoDB.

Контекст: schedule_slots — еженедельный шаблон (day_of_week).
При edit: old.valid_to = editDate, new.valid_from = editDate + 1 day.

Что сделать:
1. Создать migration file с timestamp **после последней существующей миграции**: `tangodb/supabase/migrations/<NEXT_TIMESTAMP>_schedule_versioning.sql` — строго по SCHEDULE_TZ.md §7.1:
   - valid_from, valid_to
   - backfill valid_from = '2000-01-01'
   - пересоздать partial UNIQUE с AND valid_to IS NULL
   - индекс idx_schedule_slots_active_validity WHERE valid_to IS NULL
   - normalizer/backfill legacy time, затем CHECK `HH:MM`
   - DB overlap triggers из §7.1.1 или явно записать accepted risk в decision_log.md
2. Обновить `ScheduleSlot` и добавить `DisplayLesson` в `tangodb/src/types/index.ts` — validFrom, validTo, discriminated union
3. tangodb/src/lib/scheduleWeek.ts — expandSlotsToWeek, getWeekRange, normalizeTime, timeToMinutes
4. tangodb/src/hooks/useSchedule.ts:
   - useScheduleForWeek(weekStart, weekEnd)
   - useEditGroupSchedule (soft old + insert new)
   - useDeleteScheduleSlot → UPDATE valid_to (не DELETE)
   - useDeleteGroupSchedule → batch UPDATE valid_to (не hard DELETE)
   - useAddGroupSchedule → valid_from = today
   - mapScheduleSlot читает valid_from/valid_to и нормализует time/timeEnd
5. tangodb/src/hooks/usePersonalLessons.ts:
   - API `{ yearMonth?, dateRange?, enabled? }`
   - dateRange имеет приоритет над yearMonth
   - teacher использует `personal_lessons_teacher_v` без fallback на полную `personal_lessons`
6. useAddPersonalLessons: добавить `locationId`, `teacherMemberId` в INSERT (поля **optional** в типе — совместимость с PersonalLessonsPanel до П7)
7. Пометить useReplaceGroupSchedule @deprecated

Не трогать RLS. Не создавать UI. Не делать locationId/teacherMemberId обязательными в mutation — это Промпт 4.

Прочитай сначала:
- SCHEDULE_TZ.md §4.1, §5.1, §7
- tangodb/src/hooks/useSchedule.ts
- tangodb/src/hooks/usePersonalLessons.ts
- tangodb/supabase/migrations/20260628000003_schedule_group_name.sql
- tangodb/supabase/migrations/20260622000001_v2_business_schema.sql
- tangodb/package.json (проверить, что date-fns нет)
```

### Промпт 2 — сетка (read-only)

```
Задача: недельная сетка расписания TangoDB (read-only, без CRUD).

Что сделать:
1. tangodb/src/components/schedule/ — новая папка
2. SchedulePageContainer.tsx — state selectedWeekStart, teacherFilter
3. ScheduleToolbar.tsx — < > заголовок недели, 📅 → WeekPickerPopover (кастом, без npm)
4. LocationScheduleSection.tsx — заголовок локации + WeeklyScheduleGrid; **+ секция «Без локации»** для personal с `locationId = null` (§4.5)
5. WeeklyScheduleGrid.tsx — строки 15 мин, 7 колонок, absolute LessonBlock
6. LessonBlock.tsx — цвет hash(disciplineId), красная рамка hasDebt, серый если past
7. SchedulePage.tsx — рендер SchedulePageContainer вместо SchedulePanel
8. useScheduleForWeek в контейнере
9. `DisplayLesson` — discriminated union `{ kind: 'group' | 'personal' }` в `types/index.ts`

НЕ делать: попапы, формы, delete, redirect /personal.

Стиль: design_system.md, tailwind, motion/react, без inline-стилей.
Переиспользовать dowShort, formatDateRu из lib/utils.ts. Не добавлять `date-fns` / `react-day-picker`.

Прочитай: SCHEDULE_TZ.md §5.2, SchedulePanel.tsx (данные), design_system.md
```

### Промпт 3 — просмотр и удаление

```
Задача: LessonInfoPopup + удаление занятий в расписании.

Что сделать:
1. LessonInfoPopup.tsx — детали DisplayLesson; маскировка клиентов для teacher вне scope
2. Кнопки edit/delete:
   - групповые: owner/director; hidden if lessonDate < today
   - personal: по permissions.ts + teacher_member_id для teacher
3. Delete группового → useDeleteScheduleSlot (valid_to)
4. Delete personal → useDeletePersonalLesson (hard)
5. ConfirmDialog для подтверждения
6. Подключить onClick на LessonBlock

RequirePermission с context { disciplineId, locationId }.
Teacher не должен видеть `price`/финансовые суммы и чужие client names вне scope.

Прочитай: SCHEDULE_TZ.md §5.5, RequirePermission.tsx, usePersonalLessons.ts
```

### Промпт 4 — добавление

```
Задача: попапы добавления занятий из сетки.

Что сделать:
1. AddLessonTypePopup — групповой/персональный; teacher/admin — только персональный
2. AddGroupLessonForm — owner/director; локация readonly; TimeSelect шаг 15 мин
3. AddPersonalLessonForm — reuse логику из PersonalLessonsPanel (клиенты, цена, paid), но обязательно передавать locationId + teacherMemberId
4. useAddPersonalLessons: param `requireScope?: boolean` (default `false`). `AddPersonalLessonForm` вызывает с `requireScope: true` — mutation отклоняет insert без `locationId` и `teacherMemberId`. Legacy `PersonalLessonsPanel` без флага — `NULL` в БД до П7
5. lib/scheduleConflicts.ts — wrap findBookingScheduleConflict + locationId filter + excludeId + сравнение через timeToMinutes
6. validateTimeRange, auto timeEnd (+60 мин, trim до следующего слота)
7. Клик пустой ячейки → prefilled location, date, timeStart
8. Для teacher teacherMemberId фиксирован на текущего member; select преподавателя скрыт/disabled

AppSelect для всех select. Не дублировать SellPackageModal — только форма урока.

Прочитай: PersonalLessonsPanel.tsx, lib/utils.ts, SCHEDULE_TZ.md §5.4
```

### Промпт 5 — редактирование

```
Задача: EditLessonPopup + версионирование групповых слотов.

Что сделать:
1. EditLessonPopup.tsx — режим group/personal, prefilled form
2. Group save → useEditGroupSchedule (не useReplaceGroupSchedule)
3. Personal save → useUpdatePersonalLesson; расширить mutation до full edit payload или ограничить UI только date/time и явно показать это в тексте
4. Read-only если lessonDate < today (групповые) или personal date < today
5. Conflict check через scheduleConflicts.ts
6. При group edit в сегодняшний день новая версия начинается завтра; сегодня остаётся старая

Прочитай: useSchedule.ts после Промпта 1, AddGroupLessonForm, AddPersonalLessonForm
```

### Промпт 6 — долги и индикаторы

```
Задача: операционный блок долгов + красные ячейки.

Что сделать:
1. ScheduleDebtorsBlock.tsx — personal paid='no' из данных недели + ближайшие недели
   НЕ использовать financial_debtors_v (там can_read_financial)
2. Для teacher/admin — без сумм, только «не оплачен»
3. hasDebt на DisplayLesson → LessonBlock красная рамка
4. Разместить под LocationScheduleSection
5. Не прокидывать `price` в UI-shape для teacher/admin

Прочитай: SCHEDULE_TZ.md §5.6, useFinancialDebtors.ts (для contrast, не reuse)
```

### Промпт 7 — интеграция /personal

> **Статус (2026-06-24):** выполнен 2026-06-22 (redirect `/personal` → `/schedule`). **Откат** в рамках `PERSONAL_LESSONS_TZ.md` Этап 4: `/personal` снова каноничен для списка и продажи; `/schedule?action=sell` — только быстрая продажа пакета. `PersonalLessonsPanel.tsx` и `PersonalPage.tsx` **удалены** (не deprecated).

```
Задача (исходная, 2026-06-22): слияние PersonalPage в Schedule, обновление навигации.

Что сделать:
1. /personal → redirect /schedule; /personal/sell и /personal/book → redirect /schedule?action=sell
2. App.tsx — убрать пункты меню «Персональные»; одна «Расписание»
3. AttendancePanel — ссылку /personal → /schedule
4. DashboardPage — personalView path → /schedule
5. PersonalPage.tsx, PersonalLessonsPanel.tsx — @deprecated комментарии
6. SellPackageModal — доступ из AddPersonalLessonForm / LessonInfoPopup (personal)
7. permissions.ts: обновить PANEL_FALLBACK_PATHS/panelIdFromPath или оставить backward mapping только для redirect

Не удалять файлы — только redirect + deprecate.

Обновить .cursor/docs/ai/changelog.md

Прочитай: App.tsx, permissions.ts panel paths
```

### Промпт 8 — фильтр преподавателя

```
Задача: фильтр по преподавателю в ScheduleToolbar.

Если уже реализован в Промпте 2 — только проверить edge cases.

Что сделать:
1. AppSelect «Все преподаватели» + список из team members (teacher/owner/director/admin)
2. Client-side filter DisplayLesson[] по teacherMemberId
3. Сохранять фильтр в URL searchParams ?teacher=uuid (optional, для share link)
4. Для teacher без full schedule не показывать чужих преподавателей в списке

Прочитай: ScheduleToolbar.tsx, useTeamMembers hook
```

### Промпт 9 — регрессия и проверки

```
Задача: проверить реализацию расписания после Промптов 1–8.

Что проверить:
1. npm run lint в tangodb/
2. npm run test:rbac
3. Если доступен DATABASE_URL — db tests или отдельный SQL smoke:
   - active schedule slot не конфликтует с прошлой версией
   - два активных overlap в одной location/day запрещены
   - personal lesson overlap в одной location/date запрещён
   - personal lesson vs active group slot на ту же дату запрещён
4. Ручные сценарии:
   - owner/director создаёт group и personal
   - admin видит schedule, но UI не даёт group CRUD
   - teacher видит только allowed scope, без сумм и чужих client names
   - /personal/sell ведёт на /schedule?action=sell
   - legacy time `9:00` отображается/сравнивается как `09:00`
5. Проверить grep:
   - нет активных вызовов useReplaceGroupSchedule в новом schedule UI
   - нет прямых Supabase-запросов из components/schedule/*
   - нет новых inline styles и голых <select>

После исправлений обновить .cursor/docs/ai/changelog.md и .cursor/docs/ai/architecture.md (новый модуль components/schedule/).
Если найден и исправлен баг — добавить запись в lessons.md.
```

---

*Документ v1.3 готов к реализации. Старт: Промпт 0 → Промпт 1 → … → Промпт 9 (см. §10.1).*
