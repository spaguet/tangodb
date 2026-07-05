# TangoDB

CRM для учителя танго: React + Vite + Supabase.

## Локальная разработка

```bash
cd tangodb
npm install
cp .env.example .env.local
# заполните VITE_* переменные
npm run dev
```

## Переменные окружения

Скопируйте `.env.example` → `.env.local` (локально) или добавьте в **Vercel → Project → Settings → Environment Variables**:

| Переменная | Назначение |
|---|---|
| `VITE_SUPABASE_URL` | URL проекта Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon (public) key Supabase |

> Секреты Supabase Edge Functions (`SUPABASE_SERVICE_ROLE_KEY` и др.) задаются только в Supabase Dashboard, не во фронтенде.

Для одноразовой миграции данных из Google Sheets см. `npm run migrate` — нужны `SUPABASE_URL` и `SUPABASE_SERVICE_KEY` (см. `.env.example`).

## Деплой на Vercel

1. Подключите репозиторий GitHub к [Vercel](https://vercel.com).
2. **Root Directory:** `tangodb`
3. **Build Command:** `npm run build` (по умолчанию для Vite)
4. **Output Directory:** `dist`
5. Добавьте `VITE_*` переменные из таблицы выше для Production (и Preview при необходимости).
6. После первого деплоя скопируйте production URL (например `https://tangodb.vercel.app`).

Файл `vercel.json` настроен на SPA-роутинг: прямые переходы на `/clients`, `/attendance` и т.д. отдают `index.html`.

## Скрипты

| Команда | Описание |
|---|---|
| `npm run dev` | Dev-сервер (порт 3000) |
| `npm run build` | Production-сборка |
| `npm run lint` | `tsc --noEmit` |
| `npm run migrate` | Импорт `tangodb_export.json` в Supabase |
