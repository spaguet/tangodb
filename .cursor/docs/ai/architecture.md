# Architecture

Структура проекта, слои, модули и ключевые потоки данных.

Обновлять при изменении архитектуры.

## Приложения

- `tangodb/` — основное приложение (React + Vite, TanStack Query, Zustand, Supabase)
- `tangodb-dev-console/` — админ-консоль (React + Vite, Supabase)

## Platform payment config

- `platform_payment_methods.config` — единый публично читаемый JSON-конфиг ручных способов оплаты для страницы лицензии CRM.
- Dev Console (`/payment-methods`) обновляет конфиг через Edge Function `dev-console-payment-methods` с developer-доступом.
- Загруженные QR оплаты хранятся в конфиге как небольшие `data:image/...` строки; CRM только отображает загруженные изображения и не генерирует QR на клиенте.

## Слои (tangodb/)

- `src/hooks/` — запросы к данным (TanStack Query + Supabase)
- `src/lib/` — клиент Supabase, утилиты, edge functions
- `src/store/` — локальное UI-состояние (Zustand)
- `src/components/` — UI без прямых вызовов Supabase
- `src/components/schedule/` — недельная сетка расписания (Промпты 2–8):
  - **Контейнер:** `SchedulePageContainer` — state недели, фильтр `?teacher=`, deep link `?action=sell` (только `SellPackageModal`), CRUD-потоки
  - **Сетка:** `WeeklyScheduleGrid`, `LocationScheduleSection`, `DayColumn`, `LessonBlock`, `TimeGutter`
  - **Toolbar:** `ScheduleToolbar`, `WeekPickerPopover`
  - **CRUD UI:** `LessonInfoPopup`, `AddLessonTypePopup`, `AddGroupLessonForm`, `AddPersonalLessonForm` (обёртка над `PersonalLessonSaleForm`), `EditLessonPopup`
  - **Долги:** `ScheduleDebtorsBlock` — операционный контур (`paid=no`), без `financial_debtors_v`
  - **Данные:** только через хуки (`useScheduleForWeek`, `usePersonalLessons`, `useScheduleDebtors`, mutations в `useSchedule.ts` / `usePersonalLessons.ts`); прямых Supabase-вызовов в компонентах нет
  - **Утилиты:** `lib/scheduleWeek.ts`, `lib/scheduleConflicts.ts`, `lib/scheduleTime.ts`, `lib/scheduleLessonAccess.ts`
  - **Legacy (deprecated):** `SchedulePanel.tsx`
- `src/components/personal-lessons/` — раздел «Персональные уроки» (`PERSONAL_LESSONS_TZ`, Этап 4):
  - **Маршруты:** `/personal` (список + фильтры), `/personal/sell` (продажа); `/personal/book` → redirect `/personal/sell`
  - **Контейнер:** `PersonalLessonsPageContainer` — вкладки, фильтры, edit/pay/delete через переиспользуемые popup
  - **Форма продажи:** `PersonalLessonSaleForm` (режимы `schedule-cell` / `standalone`); `PersonalLessonSalePanel` — вкладка продажи
  - **Список:** `PersonalLessonFilters`, `PersonalLessonsList`, `PersonalLessonRow`, `PersonalLessonAttendanceActions`
  - **Переиспользование:** `PayPersonalLessonModal`, `EditLessonPopup`, `SellPackageModal`; attendance — `useMarkPersonalLessonAttendance`
  - **Nav gate:** `modules.personal_lessons`; Zustand `personalTab` синхронизирован с URL
  - **Delete/edit guard:** `date > today` — UI (`canWritePersonalLesson` + `isPersonalLessonLockedForWrite`), hooks, RPC
- **Разовые групповые посещения:** отдельная финансово-операционная сущность `single_visits`, создаётся только через RPC `record_single_visit` из popup журнала посещений. Не моделировать как абонемент на 1 урок. `payments.single_visit_id` связывает поступление с визитом; тарифы имеют `prices.category = 'single_visit'` и используют те же `location_id` / `discipline_id` binding rules, что персональные тарифы. Payroll считает разовые отдельно через `teacher_pay_rates.single_visit_rate_percent`, по умолчанию от группового процента.
- `supabase/` — миграции, RLS, edge functions

## RBAC / RLS (v2)

- **UI guards:** `tangodb/src/lib/permissions.ts` — удобство и навигация.
- **RLS — источник истины:** SQL-хелперы в `supabase/migrations/`.
- **Operational read** (`can_read_operational`): owner, director, admin — CRM-таблицы (clients, subscriptions, schedule и т.д.).
- **Financial read** (`can_read_financial`): owner, director, accountant — финансовый контур (таблица `payments` в R3).
- **Accountant** не получает SELECT на operational-таблицы; teacher — через scope-policies.
- **Settings/team:** `can_manage_settings()` / `can_manage_team()` — только owner, director.
- **Prices:** read `can_read_prices()` (owner, director, admin, accountant); write `can_manage_prices()` (owner, director).
- **Data migration R2:** существующие `admin` → `owner`, чтобы не потерять доступ к settings/team.
- **Org overrides (§9):** boolean-флаги в `organization_settings` (`teachers_can_*`, `admin_can_*`); читаются в `permissions.ts` через `permissionOptionsFromSettings()` и в SQL через `can_export_data()`.
- **Export split (RBAC-8):** `can_export_data()` — operational dashboard CSV (owner/director; admin при `admin_can_export`; teacher при `teachers_can_export` + scope). `can_export_financial()` — owner/director/accountant. UI: `DataExportPage` — отдельные секции; accountant не грузит CRM-хуки.
- **Team payroll:** таблицы с legacy-префиксом `teacher_*` используются как контур зарплат команды. `teacher_pay_rates` хранит `pay_mode` (`percent` / `fixed` / `fixed_plus_percent`), `fixed_amount`, отдельные проценты для групповых и персональных уроков; `teacher_settlements` — начислено/выплачено по участнику за месяц; `teacher_settlement_payments` — выплаты и авансы. Начисления считаются через RPC `recalculate_teacher_settlement`, выплаты — только через `record_teacher_settlement_payment`; UI — `/finance/payroll` и блок настроек зарплаты в `MemberProfileModal`.

## Org modules (module gate, Этап 1)

- **Хранение:** `organization_settings.modules` (JSONB), тип `OrgModules` в `types/organization.ts`.
- **Нормализация:** `normalizeOrgModules()` в `lib/orgModules.ts` — merge с defaults; `finance_basic` для старых org → `true`.
- **Ключи с UI-gate:** `group_subscriptions`, `personal_lessons`, `finance_basic`, `multi_discipline`, `locations`; `pair_subscriptions` / `trio_lessons` — только фильтр тарифов.
- **Точки gate:** desktop nav + mobile tabs (`App.tsx`), `PanelAccessRoute` (`routeGuards.tsx`), settings nav/redirect, financial tab на `/`, financial export в `DataExportPage`.
- **Не gate:** операционная оплата при продаже; RBAC и RLS не заменяются.

## i18n (S10)

- **Default locale:** `ru-RU`; переключатель в `GeneralSettingsPage` → `organization_settings.locale`.
- **Guest locale:** `localStorage` key `tangodb-locale-pref` (`setGuestLocale`) — auth/onboarding до выбора org; синхронизируется при сохранении общих настроек.
- **Структура:** `tangodb/src/lib/i18n/` — typed keys (`I18nKey`), словари `ru`/`en`/`vi`, `t(locale, key, params?)`, `pluralize`, `formatDateLocale`.
- **Хуки:** `useI18n()` (org locale), `useGuestI18n()` (auth flows); nav helpers: `getNavSections`, `getPanelTitle`, `getSettingsNav`, …
- **Правило:** UI-строки только через `t()`; данные пользователя (имена, названия дисциплин) не переводятся; CSV export headers — RU (отдельный этап при необходимости).

## Записи
