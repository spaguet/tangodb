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

## Записи
