# Architecture

Структура проекта, слои, модули и ключевые потоки данных.

Обновлять при изменении архитектуры.

## Приложения

- `tangodb/` — основное приложение (React + Vite, TanStack Query, Zustand, Supabase)
- `tangodb-dev-console/` — админ-консоль (React + Vite, Supabase)

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

## Записи
