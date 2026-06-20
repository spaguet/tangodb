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
- **Org overrides (§9):** boolean-флаги в `organization_settings` (`teachers_can_*`, `admin_can_*`); читаются в `permissions.ts` через `permissionOptionsFromSettings()`.

## Записи
