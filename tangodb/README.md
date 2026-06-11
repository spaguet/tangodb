# TangoDB

CRM для учителя танго: React + Vite + Supabase + Telegram Auth.

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
| `VITE_TELEGRAM_BOT_USERNAME` | Username бота без `@` (Login Widget) |

> Секреты Supabase Edge Function (`TELEGRAM_BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`) задаются только в Supabase Dashboard, не во фронтенде.

Для одноразовой миграции данных из Google Sheets см. `npm run migrate` — нужны `SUPABASE_URL` и `SUPABASE_SERVICE_KEY` (см. `.env.example`).

## Деплой на Vercel

1. Подключите репозиторий GitHub к [Vercel](https://vercel.com).
2. **Root Directory:** `tangodb`
3. **Build Command:** `npm run build` (по умолчанию для Vite)
4. **Output Directory:** `dist`
5. Добавьте три `VITE_*` переменные из таблицы выше для Production (и Preview при необходимости).
6. После первого деплоя скопируйте production URL (например `https://tangodb.vercel.app`).

Файл `vercel.json` настроен на SPA-роутинг: прямые переходы на `/clients`, `/attendance` и т.д. отдают `index.html`.

## Telegram-бот (BotFather)

1. Создайте бота через [@BotFather](https://t.me/BotFather): `/newbot`
2. Узнайте свой numeric `telegram_id` (например через [@userinfobot](https://t.me/userinfobot))
3. В Supabase SQL Editor добавьте себя в whitelist:

```sql
INSERT INTO allowed_users (telegram_id, display_name)
VALUES (YOUR_TELEGRAM_ID, 'Ваше имя')
ON CONFLICT (telegram_id) DO UPDATE SET is_active = true;
```

4. В BotFather привяжите Mini App к production URL:
   - `/setmenubutton` → выберите бота → **Web App** → URL = ваш Vercel production URL
   - Опционально для входа в обычном браузере: `/setdomain` → домен Vercel (без `https://`)
5. Откройте бота в Telegram → кнопка меню запустит Web App с автоматическим входом.

## Скрипты

| Команда | Описание |
|---|---|
| `npm run dev` | Dev-сервер (порт 3000) |
| `npm run build` | Production-сборка |
| `npm run lint` | `tsc --noEmit` |
| `npm run migrate` | Импорт `tangodb_export.json` в Supabase |
