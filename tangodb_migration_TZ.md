# TangoDB — Техническое задание на миграцию
## GAS + Google Sheets → React + Supabase

**Версия:** 1.5  
**Проект:** TangoDB — CRM для учителя танго  
**Текущий стек:** Google Apps Script + Google Sheets (`from GAS/`)  
**Промежуточный UI:** React + Vite + Tailwind (`from Google Ai Studio/`)  
**Целевой стек:** React + Vite + TypeScript + Tailwind CSS v4 + Supabase + TanStack Query + Zustand + Vercel  

---

## 0. Источники в репозитории

| Папка | Содержимое | Роль в миграции |
|---|---|---|
| `from GAS/` | `code.gs` + `index.html` (117 KB) | **Эталон бизнес-логики** — текущий production |
| `from Google Ai Studio/` | React-приложение (8 компонентов-панелей incl. SyncPanel, Tailwind v4, lucide-react, motion) | **Эталон UI/UX** — целевой внешний вид |
| `tangodb/` (создаётся) | Финальный проект на Supabase | Результат миграции |

---

## 1. Обзор и цели

### Проблема
Google Apps Script отвечает с задержкой 2–8 секунд на каждый запрос. Причина — холодный старт скрипта и медленный API Google Sheets. Приложение не кэширует данные: каждое переключение секции вызывает новый цикл запрос → GAS → Sheets → ответ.

### Цель
Полностью перенести приложение на современный стек с:
- Мгновенным откликом (< 200 мс на большинство операций)
- Нормальным URL-роутингом (без `?page=` в GAS-iframe)
- Кэшированием на клиенте (TanStack Query)
- Возможностью открыть с телефона как PWA
- Автоматическим деплоем через GitHub → Vercel

### Что не меняется
- Весь бизнес-функционал (абонементы, заморозки, посещаемость, персональные уроки)
- Логика типов абонементов и тарифной сетки (см. раздел 2)
- Один администратор (один преподаватель); поле `clients.telegram` — это **ссылка на Telegram ученика** (`https://t.me/...`), не ID для входа

### Что меняется
- **Backend:** Google Sheets → Supabase PostgreSQL
- **Дизайн:** тёмный sidebar (#1e1e1e / #c8a96e) из `from GAS/` → светлый high-density UI (slate/indigo, Tailwind) из `from Google Ai Studio/`
- **Навигация:** 8 плоских панелей GAS → **7 секций** (`dashboard` + 6 CRM; `SyncPanel` только на переходный период) и **10 URL-маршрутов** (вкладки `subscriptions` и `personal` — отдельные sub-route)
- **State:** per-request GAS → TanStack Query (server) + Zustand (UI)
- **Доступ:** открытое GAS Web App → **вход только через Telegram** с проверкой numeric `telegram_id` (раздел 4)

---

## 2. Анализ текущего приложения

### Таблицы Google Sheets (источник данных)

| Таблица | Поля |
|---|---|
| `Clients` | ID, FirstName, LastName, Telegram |
| `Schedule` | DayOfWeek (1=пн…7=вс), Time (HH:MM) |
| `Prices` | Type, Lessons, Price |
| `Subscriptions` | ID, Type, ClientID1, ClientID2, LessonsTotal, LessonsLeft, FreezeUsed, ActivationDate, Status, PairMonth |
| `Attendance` | Date, SubscriptionID, ClientDisplay, AttendanceStatus |
| `PersonalLessons` | ID, Type, Client1, Client2, Client3, Date, Price, Paid |

### Типы абонементов и цен (важно — не упрощать)

**Таблица `Prices`** — отдельные строки для каждого тарифа:

| Type | Lessons | Назначение |
|---|---|---|
| `solo` | 4, 8 | Групповой соло |
| `pair_m1` | 8 | Парный, 1-й месяц |
| `pair_m2` | 8 | Парный, 2-й месяц |
| `pair_m3` | 8 | Парный, 3-й месяц |
| `pair_hm` | 4 | Парный «полмесяца» |
| `personal_solo` | 1 | Персональный соло |
| `personal_pair` | 1 | Персональный парный |
| `personal_trio` | 1 | Персональный трио |

**Таблица `Subscriptions`** — в поле `Type` хранятся только три значения:

| Type в БД | Когда | pairMonth |
|---|---|---|
| `solo` | Соло, 4 или 8 уроков | пусто |
| `pair_hm` | Парный на 4 урока | пусто |
| `pair` | Парный на 8 уроков | `1`, `2` или `3` (номер месяца для lookup цены `pair_m{N}`) |

> Цена при продаже ищется по `Prices.Type` + `Prices.Lessons`, а не по `Subscriptions.Type` напрямую.

**Персональные уроки** — в `PersonalLessons.Type`: `solo`, `pair`, `trio` (маппинг на `personal_solo` / `personal_pair` / `personal_trio` в ценах).

### Секции интерфейса

#### Текущий GAS (`from GAS/index.html`) — 8 панелей

| ID панели | Назначение |
|---|---|
| `newClient` | Добавление/редактирование/удаление клиентов |
| `sellSub` | Продажа абонемента |
| `activeSubs` | Список действующих абонементов |
| `attendance` | Журнал посещений (по дате) |
| `schedule` | Редактирование расписания |
| `personalSell` | Добавление персональных уроков |
| `personalView` | Просмотр персональных уроков |
| `prices` | Редактирование цен |

#### Целевой UI (`from Google Ai Studio/src/App.tsx`) — 8 секций

| ID / компонент | URL (целевой) | Назначение | Заменяет |
|---|---|---|---|
| `dashboard` / `Dashboard` | `/` | Обзор: статистика, расписание на сегодня, предупреждения | *(новое)* |
| `newClient` / `ClientsPanel` | `/clients` | Реестр клиентов | `newClient` *(legacy ID в AI Studio `App.tsx`)* |
| `subscriptions` / `SubscriptionsPanel` | `/subscriptions`, `/subscriptions/sell` | Вкладки: активные + продажа | `activeSubs` + `sellSub` |
| `schedule` / `SchedulePanel` | `/schedule` | Редактор расписания | `schedule` |
| `attendance` / `AttendancePanel` | `/attendance` | Журнал посещений | `attendance` |
| `personal` / `PersonalLessonsPanel` | `/personal`, `/personal/book` | Вкладки: просмотр + бронь | `personalView` + `personalSell` |
| `prices` / `PricesPanel` | `/prices` | Тарифная сетка | `prices` |
| `sync` / `SyncPanel` | — | Инструкция по GAS-бэкенду | *(только переходный период — удалить после Supabase)* |

> **Legacy ID в навигации:** `App.tsx` принимает старые GAS-ID (`sellSub`, `activeSubs`, `personalSell`, `personalView`) через `handleNavigate()` и маппит их на новые секции. **Баги прототипа:**
> 1. `subPanelTab` / `persPanelTab` хранятся в `App.tsx`, но **не передаются** в `SubscriptionsPanel` / `PersonalLessonsPanel` (у панелей свой внутренний `useState`). Клик «Оформить билет» открывает секцию, но вкладка остаётся «active».
> 2. Mobile bottom nav «Приваты» всегда вызывает `personalView`, не `personalSell` (бронь — только через sidebar/drawer).
> 3. В финальном проекте — React Router + prop `initialTab` / Zustand sync с URL.

### API-вызовы с фронтенда (21 уникальный вызов → Supabase)

> В `from GAS/code.gs` **31 функция** (4 утилиты + `doGet` + **26** бизнес-функций, из них 2 пары дубликатов: `updatePersonalPaid`≡`updatePersonalLessonPaid`, `deletePersonalLesson`≡`deletePersonalLessonRow`). **Фронтенд GAS (`index.html`) вызывает ровно 21** — см. список ниже. AI Studio в режиме GAS дополнительно грузит `getSubscriptions` и `getAttendanceRecords` пакетом (см. паттерн bulk-load).

```
getClients()
addClient(firstName, lastName, telegram)
deleteClient(clientId)
updateClient(clientId, firstName, lastName, telegram)
getSchedule()
addScheduleSlot(dayOfWeek, time)
deleteScheduleSlot(dayOfWeek, time)          ← по day+time, не по id
getPrices()
updatePrice(rowIndex, newPrice)            ← rowIndex листа; в Supabase → id
getSellSubData()                           → getClients() + getPrices()
addSubscription(subData)
getScheduleDatesForMonth(yearMonth)        ← вычисляется на клиенте в AI Studio
getSubsForDate(dateStr)                    ← вычисляется на клиенте в AI Studio
markAttendance(dateStr, subId, newStatus)
getActiveSubscriptions()
finishSubscription(subId)
getPersonalSellData()                      → getClients() + getPrices()
addPersonalLessons(lessonsData)
getPersonalLessonsForView(filterPaid)
updatePersonalLessonPaid(rowIndex, paid)   ← rowIndex; в Supabase → id
deletePersonalLessonRow(rowIndex)          ← rowIndex; в Supabase → id
```

**Паттерн AI Studio (`useTangoStore.ts`):** при старте — параллельный bulk-load 6 сущностей:

| Запрос | GAS-функция | Не вызывается из GAS `index.html` |
|---|---|---|
| clients | `getClients` | — |
| schedule | `getSchedule` | — |
| prices | `getPrices` | — |
| subscriptions | `getSubscriptions` | ✅ (только bulk-load) |
| attendance | `getAttendanceRecords` | ✅ (только bulk-load) |
| personalLessons | `getPersonalLessons` | — (view использует `getPersonalLessonsForView`) |

Далее `getScheduleDatesForMonth`, `getSubsForDate`, список активных абонементов и фильтр персональных уроков считаются **на клиенте** из кэша. В Supabase-версии — TanStack Query с теми же `queryKey` и client-side join.

> **Разница загрузки данных:** GAS `index.html` грузит данные **лениво при входе в секцию** (21 вызов по требованию). AI Studio — **eager bulk-load** 6 сущностей при старте. Supabase-версия следует паттерну AI Studio (быстрые переключения вкладок), с `staleTime` 5–10 мин для справочников (`clients`, `prices`, `schedule`).

**Маппинг типа при продаже** (`SubscriptionsPanel`, как в GAS): `solo` → `solo`; парный 4 урока → `pair_hm`; парный 8 уроков → `pair` + `pairMonth` (1/2/3). Lookup цены: `solo`+lessons, `pair_hm`+4, `pair_m{N}`+8.

### Ключевая бизнес-логика (сохраняется без изменений)

- Абонемент: solo / pair (8 уроков + pairMonth) / pair_hm (4 урока)
- Уроков: 4 или 8 — в зависимости от выбора при продаже
- Заморозка: только для абонементов на 8 уроков (`lessonsTotal === 8`), не более 1 раза
- Статусы посещения: `present` / `absent` / `freeze`
- При `present` или `absent` → списывается 1 урок
- При `freeze` → увеличивается FreezeUsed (урок не списывается)
- При LessonsLeft = 0 → статус абонемента = `finished` (ручное «Завершить» через `finishSubscription` только меняет status, не обнуляет lessonsLeft)
- Персональные уроки: до 3 клиентов, флаг `paid`: `yes` / `no`
- Формат валюты: VND (₫), `Intl.NumberFormat('ru-RU', { currency: 'VND' })`
- Формат имён: `Фамилия Имя`, для пары: `Фамилия1 Имя1 & Фамилия2 Имя2`
- GAS `markAttendance`: при **обновлении** существующей записи меняется только `AttendanceStatus`, `ClientDisplay` не пересчитывается (Supabase RPC всегда обновляет display — улучшение)

---

## 3. Целевая архитектура

```
┌─────────────────────────────────────────────────────────┐
│                     TELEGRAM                             │
│   Mini App (основной вход с телефона)                   │
│   Login Widget (fallback в браузере)                    │
│   initData / auth payload → numeric telegram_id         │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────┐
│                        КЛИЕНТ                              │
│   React 19 + Vite + TypeScript                            │
│   Tailwind CSS v4 + lucide-react (из AI Studio)           │
│   TanStack Query v5 (server state / кэш)                  │
│   Zustand (UI state — вкладки, даты, модалки)             │
│   React Router v6 (URL ↔ секции)                          │
│   AuthProvider + ProtectedRoute (сессия после Telegram)     │
│   Компоненты-панели из AI Studio (Dashboard, Panels…)     │
└────────────────────────┬────────────────────────────────┘
                         │ Supabase JS SDK (JWT с telegram_id)
┌────────────────────────▼────────────────────────────────┐
│                     SUPABASE                               │
│   Edge Function telegram-auth  ←  verify initData + whitelist │
│   PostgreSQL  ←  6 CRM-таблиц + allowed_users             │
│   RPC mark_attendance  ←  транзакционная логика           │
│   Row Level Security  ←  только authenticated telegram_id │
│   PostgREST  ←  REST API                                  │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                      VERCEL                                │
│   GitHub → auto deploy (main branch = production)         │
│   Preview deploys на PR                                   │
│   Bot Menu Button / Web App URL → Vercel production       │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Аутентификация через Telegram (обязательно)

> **Не путать:** `clients.telegram` в CRM — ссылка на профиль ученика. **Вход в панель** — по numeric `telegram_id` преподавателя из Telegram API.

### Требования

- Без авторизации CRM недоступна (все маршруты кроме `/login` за `ProtectedRoute`)
- Доступ только у `telegram_id` из whitelist (`allowed_users`)
- Сессия переживает перезагрузку страницы (Supabase session / JWT)
- Основной сценарий — **Telegram Mini App** (открытие из бота на телефоне, PWA-friendly)
- Fallback — **Telegram Login Widget** для desktop-браузера

### Поток входа

```
1. Пользователь открывает Web App из Telegram-бота (или /login в браузере)
2. Frontend получает initData (Mini App) или callback Login Widget
3. POST → Supabase Edge Function `telegram-auth` { initData?, widgetPayload? }
4. Edge Function:
   a. Mini App: проверяет HMAC initData ([WebApp validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app))
   b. Login Widget: проверяет hash полей callback ([Login Widget validation](https://core.telegram.org/widgets/login#checking-authorization))
   c. Извлекает user.id (telegram_id)
   d. Проверяет allowed_users.is_active = true
   e. Выдаёт Supabase session (custom JWT с claim telegram_id)
5. Frontend сохраняет session → redirect на /
6. Все запросы к PostgREST/RPC — только с валидным JWT
```

### Таблица `allowed_users`

```sql
CREATE TABLE allowed_users (
  telegram_id   BIGINT PRIMARY KEY,  -- numeric ID из Telegram (не @username)
  display_name  TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Пример: один преподаватель (ID узнать через @userinfobot или getUpdates бота)
INSERT INTO allowed_users (telegram_id, display_name) VALUES
  (123456789, 'Преподаватель');
```

### Edge Function `telegram-auth` (скелет)

```typescript
// supabase/functions/telegram-auth/index.ts
// Секреты: TELEGRAM_BOT_TOKEN (Supabase Secrets, не VITE_)
// Алгоритм проверки initData: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const { initData, widgetPayload } = await req.json();
  const telegramId = initData
    ? verifyTelegramInitData(initData)           // Mini App
    : widgetPayload
      ? verifyTelegramLoginWidget(widgetPayload) // Desktop fallback
      : null;
  if (!telegramId) return new Response('Unauthorized', { status: 401 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: user } = await admin.from('allowed_users').select('telegram_id').eq('telegram_id', telegramId).eq('is_active', true).maybeSingle();
  if (!user) return new Response('Forbidden', { status: 403 });

  // Выдать session: signInWithOtp / generateLink / custom access token hook — на выбор при реализации
  const session = await issueSessionForTelegramId(telegramId);
  return Response.json(session);
});
```

### RLS-политики (вместо DISABLE RLS)

```sql
-- JWT custom claim: telegram_id (bigint) — выставляется Edge Function при выдаче session
CREATE OR REPLACE FUNCTION auth_telegram_id() RETURNS BIGINT AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'telegram_id', '')::BIGINT;
$$ LANGUAGE sql STABLE;

-- allowed_users: anon/authenticated не читают whitelist (только service role в Edge Function)
ALTER TABLE allowed_users ENABLE ROW LEVEL SECURITY;
-- явных политик для anon/authenticated нет → доступ запрещён

-- CRM-таблицы: один преподаватель из whitelist
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','schedule','prices','subscriptions','attendance','personal_lessons']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY "teacher_select" ON %I FOR SELECT
        USING (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY "teacher_insert" ON %I FOR INSERT
        WITH CHECK (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY "teacher_update" ON %I FOR UPDATE
        USING (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
        WITH CHECK (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY "teacher_delete" ON %I FOR DELETE
        USING (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
    $p$, t);
  END LOOP;
END $$;
```

> Для MVP с одним преподавателем достаточно одной строки в `allowed_users`. RLS защищает данные при утечке `anon` key. Политики `FOR ALL` без `WITH CHECK` не защищают INSERT — поэтому отдельные политики на SELECT/INSERT/UPDATE/DELETE.

### Frontend-компоненты (новые)

```
src/
├── auth/
│   ├── AuthProvider.tsx      # Supabase session + Telegram WebApp SDK
│   ├── ProtectedRoute.tsx    # redirect → /login
│   └── LoginPage.tsx         # Mini App auto-auth + Login Widget fallback
├── lib/
│   └── telegram.ts           # parse initData, isTelegramWebApp()
```

### Переменные окружения

| Переменная | Где | Назначение |
|---|---|---|
| `VITE_TELEGRAM_BOT_USERNAME` | Vercel / `.env.local` | Login Widget (`data-telegram-login`) |
| `VITE_SUPABASE_URL` | frontend | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | frontend | Anon key (RLS ограничивает доступ) |
| `TELEGRAM_BOT_TOKEN` | Supabase Secrets | Проверка подписи initData |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function only | Whitelist lookup + выдача session |

### Настройка Telegram-бота

1. Создать бота через [@BotFather](https://t.me/BotFather)
2. `/setmenubutton` → Web App URL = production Vercel URL
3. Опционально: `/setdomain` для Login Widget
4. Добавить свой `telegram_id` в `allowed_users`

---

## 5. Стек технологий

| Слой | Технология | Причина выбора |
|---|---|---|
| Frontend framework | React 19 + Vite + TypeScript | Как в AI Studio-прототипе |
| Стили | **Tailwind CSS v4** + `@tailwindcss/vite` | Готовый дизайн в `from Google Ai Studio/` |
| Иконки | lucide-react | Уже используется в прототипе |
| Роутинг | React Router v6 | URL-навигация вместо `useState('panel')` |
| Server state | TanStack Query v5 | Кэш, инвалидация, loading states |
| UI state | Zustand | Вкладки subscriptions/personal, выбранные даты, модалки |
| База данных | Supabase (PostgreSQL) | Бесплатный tier, JS SDK |
| Аутентификация | **Telegram Mini App + Login Widget** → Edge Function → Supabase JWT | Вход по numeric `telegram_id`; whitelist в `allowed_users` |
| Деплой | Vercel | GitHub push → автодеплой |
| Миграция данных | GAS-скрипт экспорта + Node import | Одноразовый перенос |

> **Примечание по стилям:** Прототип AI Studio уже на Tailwind (slate/indigo). **Не** переносить CSS Modules и **не** возвращаться к тёмной теме GAS (#1e1e1e / #c8a96e). Исходный GAS-CSS хранить только для сверки UX-потоков.

---

## 6. Структура проекта

Базируется на `from Google Ai Studio/`, с заменой `useTangoStore` → TanStack Query + Supabase:

```
tangodb/
├── public/
│   └── favicon.ico
├── supabase/
│   └── functions/
│       └── telegram-auth/        # verify initData + whitelist
├── src/
│   ├── main.tsx                    # Entry + Tailwind import
│   ├── index.css                   # @import "tailwindcss" + @theme (из AI Studio)
│   ├── App.tsx                     # Router + Layout + QueryClient + AuthProvider
│   ├── auth/
│   │   ├── AuthProvider.tsx
│   │   ├── ProtectedRoute.tsx
│   │   └── LoginPage.tsx
│   ├── lib/
│   │   ├── supabase.ts             # createClient
│   │   ├── telegram.ts             # WebApp SDK helpers
│   │   └── utils.ts                # formatDateRu, formatCurrency (₫), dow helpers
│   ├── types/
│   │   └── index.ts                # camelCase интерфейсы (как в AI Studio)
│   ├── store/
│   │   └── ui.ts                   # Zustand: activeTab, selectedDate, modals
│   ├── hooks/                      # TanStack Query (= бывшие GAS-функции)
│   │   ├── useClients.ts
│   │   ├── useSchedule.ts
│   │   ├── usePrices.ts
│   │   ├── useSubscriptions.ts
│   │   ├── useAttendance.ts
│   │   └── usePersonalLessons.ts
│   ├── components/                 # ← перенести из AI Studio, адаптировать props
│   │   ├── Dashboard.tsx
│   │   ├── ClientsPanel.tsx
│   │   ├── SubscriptionsPanel.tsx
│   │   ├── AttendancePanel.tsx
│   │   ├── SchedulePanel.tsx
│   │   ├── PersonalLessonsPanel.tsx
│   │   ├── PricesPanel.tsx
│   │   └── Layout/
│   │       ├── Sidebar.tsx
│   │       ├── Topbar.tsx
│   │       └── MobileDrawer.tsx
│   └── pages/                      # thin wrappers для React Router
│       ├── DashboardPage.tsx
│       ├── ClientsPage.tsx
│       └── …
├── .env.local                      # VITE_SUPABASE_* + VITE_TELEGRAM_BOT_USERNAME
├── .env.example
├── index.html
├── vite.config.ts                  # @tailwindcss/vite plugin
├── tsconfig.json
└── package.json
```

**Не переносить в финальный проект:** `SyncPanel.tsx`, `code.gs`, sandbox/localStorage-логику из `useTangoStore`, зависимости AI Studio-шаблона (`@google/genai`, `express`, `dotenv` для Gemini).

**Оставить из AI Studio:** `motion` (анимации в `Dashboard.tsx`, `ClientsPanel.tsx`), `lucide-react`, Tailwind v4, `src/index.css` (в т.ч. `@theme`: классы `wine-*` → slate, `gold-*` → indigo), все `src/components/*.tsx` кроме `SyncPanel`.

**Удалить из Layout (App.tsx):** кнопка «Sync Now», бейджи Sandbox/G-Sheets — заменить на индикатор сессии Telegram или убрать.

---

## 7. Схема базы данных Supabase

### Соглашение об именовании
- **PostgreSQL:** snake_case (`first_name`, `client_id1`)
- **TypeScript (frontend):** camelCase (`firstName`, `clientId1`) — маппинг в хуках или через Supabase select aliases

### Таблица `allowed_users` (доступ к панели)

```sql
-- Полное описание и RLS — раздел 4
CREATE TABLE allowed_users (
  telegram_id   BIGINT PRIMARY KEY,
  display_name  TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Таблица `clients`

```sql
CREATE TABLE clients (
  id          TEXT PRIMARY KEY,  -- сохраняем существующие ID из Sheets
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  telegram    TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Таблица `schedule`

```sql
CREATE TABLE schedule (
  id          SERIAL PRIMARY KEY,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  time        TEXT NOT NULL,  -- формат HH:MM
  UNIQUE (day_of_week, time)
);
```

### Таблица `prices`

```sql
CREATE TABLE prices (
  id       SERIAL PRIMARY KEY,
  type     TEXT NOT NULL,
  lessons  INTEGER NOT NULL,
  price    NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (type, lessons)
);

-- Начальные данные (соответствуют DEFAULT_PRICES из AI Studio)
INSERT INTO prices (type, lessons, price) VALUES
  ('solo', 4, 1200000),
  ('solo', 8, 2100000),
  ('pair_m1', 8, 3400000),
  ('pair_m2', 8, 3100000),
  ('pair_m3', 8, 2800000),
  ('pair_hm', 4, 1800000),
  ('personal_solo', 1, 900000),
  ('personal_pair', 1, 1300000),
  ('personal_trio', 1, 1600000);
```

### Таблица `subscriptions`

```sql
CREATE TABLE subscriptions (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('solo', 'pair', 'pair_hm')),
  client_id1       TEXT NOT NULL REFERENCES clients(id),
  client_id2       TEXT REFERENCES clients(id),
  lessons_total    INTEGER NOT NULL CHECK (lessons_total IN (4, 8)),
  lessons_left     INTEGER NOT NULL,
  freeze_used      INTEGER NOT NULL DEFAULT 0 CHECK (freeze_used BETWEEN 0 AND 1),
  activation_date  DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  pair_month       TEXT DEFAULT '',  -- '1', '2', '3' или пусто
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

### Таблица `attendance`

```sql
CREATE TABLE attendance (
  id                  SERIAL PRIMARY KEY,
  date                DATE NOT NULL,
  subscription_id     TEXT NOT NULL REFERENCES subscriptions(id),
  client_display      TEXT NOT NULL,
  attendance_status   TEXT NOT NULL CHECK (attendance_status IN ('present', 'absent', 'freeze')),
  UNIQUE (date, subscription_id)
);
```

### Таблица `personal_lessons`

```sql
CREATE TABLE personal_lessons (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('solo', 'pair', 'trio')),
  client_id1  TEXT REFERENCES clients(id),
  client_id2  TEXT REFERENCES clients(id),
  client_id3  TEXT REFERENCES clients(id),
  date        DATE NOT NULL,
  price       NUMERIC NOT NULL DEFAULT 0,
  paid        TEXT NOT NULL DEFAULT 'no' CHECK (paid IN ('yes', 'no')),
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### RLS + RPC — порядок выполнения в Supabase SQL Editor

1. Таблицы `allowed_users` + 6 CRM (DDL выше)
2. `INSERT` начальных `prices` + placeholder в `allowed_users`
3. RLS: `auth_telegram_id()` + политики (полный блок — **раздел 4**)
4. RPC `mark_attendance` (полный текст — **раздел 9**)
5. Права на RPC:

```sql
REVOKE ALL ON FUNCTION mark_attendance(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_attendance(TEXT, TEXT, TEXT) TO authenticated;
```

> **deleteClient и FK:** `subscriptions.client_id1/2` и `personal_lessons.client_id*` ссылаются на `clients(id)` без `ON DELETE CASCADE`. Удаление клиента с активными абонементами/уроками вернёт ошибку PostgreSQL — как и в GAS, нужно показывать понятное сообщение пользователю (или запретить удаление на UI при наличии ссылок).

---

## 8. TypeScript-типы (`src/types/index.ts`)

Frontend-типы в **camelCase** (как в AI Studio). Supabase snake_case маппится в хуках.

```typescript
export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  telegram: string;
  createdAt?: string;
}

export interface ScheduleSlot {
  id?: number;       // Supabase SERIAL; в GAS отсутствует
  dayOfWeek: number; // 1=пн … 7=вс
  time: string;      // HH:MM
}

export interface Price {
  id?: number;       // Supabase; в GAS — поле row (номер строки листа)
  row?: number;      // только для обратной совместимости при миграции
  type: string;
  lessons: number;
  price: number;
}

export interface Subscription {
  id: string;
  type: 'solo' | 'pair' | 'pair_hm' | string;
  clientId1: string;
  clientId2: string;
  lessonsTotal: number;
  lessonsLeft: number;
  freezeUsed: number;
  activationDate: string; // YYYY-MM-DD
  status: 'active' | 'finished';
  pairMonth: string; // '1' | '2' | '3' | '' — в Sheets хранится как текст/число
}

export interface AttendanceRecord {
  id?: number;
  date: string;
  subscriptionId: string;
  clientDisplay: string;
  attendanceStatus: 'present' | 'absent' | 'freeze';
}

export interface PersonalLesson {
  id: string;
  type: 'solo' | 'pair' | 'trio' | string;
  clientId1: string;
  clientId2: string;
  clientId3: string;
  date: string;
  price: number;
  paid: 'yes' | 'no';
}

/** Ответ getActiveSubscriptions / useActiveSubscriptions */
export interface ActiveSubscription {
  subId: string;
  type: string;
  pairMonth: string;
  client1: string;
  client2: string;
  client1tg: string;
  client2tg: string;
  lessonsTotal: number;
  lessonsLeft: number;
  freezeUsed: number;
  activationDate: string;
}

/** Журнал посещений — абонемент на конкретную дату */
export interface SubForDate {
  subId: string;
  type: string;
  client1: string;
  client2: string;
  lessonsLeft: number;
  lessonsTotal: number;
  freezeUsed: number;
  activationDate: string;
  currentStatus: 'present' | 'absent' | 'freeze' | null;
  canFreeze: boolean;
}
```

---

## 9. Хуки TanStack Query (`src/hooks/`)

### Паттерн

```typescript
// useClients.ts — пример
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Client } from '../types';

const mapClient = (row: Record<string, unknown>): Client => ({
  id: row.id as string,
  firstName: row.first_name as string,
  lastName: row.last_name as string,
  telegram: (row.telegram as string) || '',
});

export const useClients = () =>
  useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('last_name');
      if (error) throw error;
      return (data ?? []).map(mapClient);
    },
  });
```

### Список хуков

| Хук | GAS-аналог | Примечание |
|---|---|---|
| `useClients` | `getClients` | |
| `useAddClient` | `addClient` | дубликат firstName+lastName на клиенте |
| `useDeleteClient` | `deleteClient` | обработать FK violation (23503) → «Клиент используется в абонементах/уроках» |
| `useUpdateClient` | `updateClient` | |
| `useSchedule` | `getSchedule` | |
| `useAddScheduleSlot` | `addScheduleSlot` | UNIQUE(day, time) |
| `useDeleteScheduleSlot` | `deleteScheduleSlot` | **по id** (GAS — по day+time) |
| `usePrices` | `getPrices` | |
| `useUpdatePrice` | `updatePrice` | **по id** (GAS/AI Studio — по `row`) |
| `useSubscriptions` | `getSubscriptions` | полный список; bulk-load как в AI Studio |
| `useAddSubscription` | `addSubscription` | |
| `useActiveSubscriptions` | `getActiveSubscriptions` | *опционально*: AI Studio фильтрует `status=active` из `useSubscriptions` + join `useClients` |
| `useFinishSubscription` | `finishSubscription` | |
| `useAttendanceRecords` | `getAttendanceRecords` | bulk-load для client-side join |
| `useScheduleDates` | `getScheduleDatesForMonth` | **вычислять на клиенте** из `useSchedule` |
| `useSubsForDate` | `getSubsForDate` | join subscriptions + clients + attendance на клиенте |
| `useMarkAttendance` | `markAttendance` | RPC `mark_attendance` |
| `usePersonalLessons` | `getPersonalLessons` / `getPersonalLessonsForView` | filter paid: all / yes / no на клиенте |
| `useAddPersonalLessons` | `addPersonalLessons` | одна запись на каждую дату |
| `useUpdatePersonalPaid` | `updatePersonalLessonPaid` | **по id** (GAS — по rowIndex) |
| `useDeletePersonalLesson` | `deletePersonalLessonRow` | **по id** (GAS — по rowIndex) |

> **Инвалидация:** после мутаций инвалидировать связанные ключи (`['subscriptions']`, `['attendance']` при `markAttendance` и т.д.).

> **staleTime (рекомендация):** `clients` / `prices` / `schedule` — 5–10 мин; `subscriptions` / `attendance` / `personalLessons` — 30 с или инвалидация после мутаций.

### RPC `mark_attendance` — исправленная версия

> **Баг v1.0:** RPC записывала `client_display = ''`. GAS сохраняет `Фамилия Имя [& Фамилия2 Имя2]`.

```sql
CREATE OR REPLACE FUNCTION mark_attendance(
  p_date TEXT,
  p_sub_id TEXT,
  p_new_status TEXT
) RETURNS JSONB AS $$
DECLARE
  v_sub RECORD;
  v_old_status TEXT;
  v_lesson_delta INT := 0;
  v_freeze_delta INT := 0;
  v_new_lessons_left INT;
  v_new_freeze_used INT;
  v_display TEXT := '';
  v_c1 RECORD;
  v_c2 RECORD;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_sub_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  SELECT attendance_status INTO v_old_status
  FROM attendance WHERE date = p_date::DATE AND subscription_id = p_sub_id;

  IF v_old_status IS NOT DISTINCT FROM p_new_status THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Откат старого статуса
  IF v_old_status IN ('present','absent') THEN v_lesson_delta := 1; END IF;
  IF v_old_status = 'freeze' THEN v_freeze_delta := -1; END IF;

  -- Применение нового статуса
  IF p_new_status IN ('present','absent') THEN v_lesson_delta := v_lesson_delta - 1; END IF;
  IF p_new_status = 'freeze' THEN v_freeze_delta := v_freeze_delta + 1; END IF;

  -- present ↔ absent — дельта уроков = 0
  IF v_old_status IN ('present','absent') AND p_new_status IN ('present','absent') THEN
    v_lesson_delta := 0;
  END IF;

  IF p_new_status = 'freeze' THEN
    IF v_sub.lessons_total != 8 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Заморозка только для абонементов на 8 уроков');
    END IF;
    IF v_sub.freeze_used + v_freeze_delta > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Заморозка уже использована');
    END IF;
  END IF;

  v_new_lessons_left := v_sub.lessons_left + v_lesson_delta;
  IF v_new_lessons_left < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно уроков');
  END IF;
  v_new_freeze_used := v_sub.freeze_used + v_freeze_delta;

  -- Сформировать client_display (как в GAS markAttendance)
  SELECT last_name, first_name INTO v_c1 FROM clients WHERE id = v_sub.client_id1;
  IF FOUND THEN
    v_display := v_c1.last_name || ' ' || v_c1.first_name;
  ELSE
    v_display := v_sub.client_id1;
  END IF;
  IF v_sub.client_id2 IS NOT NULL AND v_sub.client_id2 <> '' THEN
    SELECT last_name, first_name INTO v_c2 FROM clients WHERE id = v_sub.client_id2;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c2.last_name || ' ' || v_c2.first_name;
    END IF;
  END IF;

  INSERT INTO attendance (date, subscription_id, client_display, attendance_status)
  VALUES (p_date::DATE, p_sub_id, v_display, p_new_status)
  ON CONFLICT (date, subscription_id)
  DO UPDATE SET attendance_status = p_new_status, client_display = v_display;

  UPDATE subscriptions SET
    lessons_left = v_new_lessons_left,
    freeze_used  = v_new_freeze_used,
    status = CASE WHEN v_new_lessons_left = 0 THEN 'finished' ELSE status END
  WHERE id = p_sub_id;

  RETURN jsonb_build_object('success', true, 'newLessonsLeft', v_new_lessons_left);
END;
$$ LANGUAGE plpgsql;
```

---

## 10. Маршрутизация

React Router v6 — URL соответствуют секциям AI Studio:

```
/login                 → LoginPage (Telegram Mini App / Login Widget)
/                      → Dashboard          (ProtectedRoute)
/clients               → ClientsPanel        (legacy ID: newClient)
/subscriptions         → SubscriptionsPanel  (tab: active; legacy: activeSubs)
/subscriptions/sell    → SubscriptionsPanel  (tab: sell; legacy: sellSub)
/attendance            → AttendancePanel
/schedule              → SchedulePanel
/personal              → PersonalLessonsPanel (tab: view; legacy: personalView)
/personal/book         → PersonalLessonsPanel (tab: book; legacy: personalSell)
/prices                → PricesPanel
```

Zustand (`ui.ts`) хранит `subscriptionsTab` и `personalTab`, синхронизируя их с URL (раздел 11). **При миграции:** передать `initialTab` в `SubscriptionsPanel` и `PersonalLessonsPanel` (сейчас вкладки внутренние и не синхронизированы с `subPanelTab`/`persPanelTab` в `App.tsx`).

---

## 11. Zustand-стор (`src/store/ui.ts`)

```typescript
interface UIState {
  // Журнал посещений
  selectedMonth: string;        // 'YYYY-MM'
  selectedDate: string | null;  // 'YYYY-MM-DD'

  // Вкладки объединённых панелей
  subscriptionsTab: 'active' | 'sell';
  personalTab: 'view' | 'book';

  // Модальные окна
  editClientModal: { open: boolean; clientId: string | null };

  // Персональные уроки
  personalFilter: 'all' | 'yes' | 'no';

  // Actions
  setSelectedMonth: (m: string) => void;
  setSelectedDate: (d: string | null) => void;
  setSubscriptionsTab: (t: 'active' | 'sell') => void;
  setPersonalTab: (t: 'view' | 'book') => void;
  openEditClient: (id: string) => void;
  closeEditClient: () => void;
  setPersonalFilter: (f: 'all' | 'yes' | 'no') => void;
}
```

---

## 12. Интеграция UI из Google AI Studio

### Что уже готово (`from Google Ai Studio/`)

- `src/App.tsx` — Layout: sidebar, mobile bottom nav, drawer, toast
- `src/components/*.tsx` — все панели кроме Supabase-подключения
- `src/index.css` — Tailwind v4 + кастомная палитра (slate/indigo)
- `src/hooks/useTangoStore.ts` — **заменить** на TanStack Query + Supabase
- `src/types.ts` — перенести в `src/types/index.ts`

### Порядок интеграции

1. Скопировать `from Google Ai Studio/` → `tangodb/`
2. Удалить: `SyncPanel`, GAS-bridge (`isGAS`, `runGASPromise`), sandbox localStorage
3. Добавить Supabase client + TanStack Query хуки
4. Заменить props `store.*` в панелях на соответствующие хуки
5. Добавить React Router (заменить `useState('activePanel')` в App.tsx)
6. Подключить `@tanstack/react-query`, `@supabase/supabase-js`, `zustand`, `react-router-dom`

### Известные расхождения AI Studio ↔ GAS (исправить при миграции)

| Место | Проблема | Решение |
|---|---|---|
| `code.gs` (AI Studio) | `markAttendance` пишет `client_id1` в `client_display` (стр. 378) | Исправлено в Supabase RPC; GAS production — корректно |
| `code.gs` (AI Studio) | Нет `getActiveSubscriptions`, `getScheduleDatesForMonth`, `getSubsForDate`, `getSellSubData`, `getPersonalSellData`, `getPersonalLessonsForView` | Логика в `useTangoStore` — перенести в TanStack Query хуки |
| `code.gs` (AI Studio) | `addSubscription` пишет `activationDate` строкой, не `Date` | Только для GAS-bridge; Supabase — тип `DATE` |
| `getPersonalLessons` (GAS production) | Возвращает **display names** в `Client1/2/3` | Supabase хранит `client_id1/2/3`; AI Studio `code.gs` уже отдаёт ID |
| `App.tsx` | `subPanelTab` / `persPanelTab` не передаются в дочерние панели | Prop `initialTab` + `useEffect` sync; default `'active'` ломает навигацию на «Оформить билет» |
| `App.tsx` | Mobile bottom nav «Приваты» → только `personalView` | `/personal/book` из drawer; синхронизировать highlight с `personalTab` |
| `App.tsx` | «Sync Now», Sandbox/G-Sheets badges | Удалить в Supabase-версии |
| `PersonalLessonsPanel` | `persPanelTab` в `App.tsx` не передаётся в панель | Prop `initialTab` + URL sync через Zustand |
| `PersonalLessonsPanel` | `onAddPersonalLessons` принимает `paid: boolean` | Хук маппит `true` → `'yes'`, `false` → `'no'` |
| `PricesPanel` | Обновление по `row` (номер строки Sheets) | В Supabase — по `id`; ключ `solo_8` в UI = `type:solo, lessons:8` |
| `AttendancePanel` | Импортирует `useTangoStore`, но не использует | Удалить лишний import |
| `useTangoStore` mock | `pairMonth: 1` (number) в DEFAULT_SUBS; имена в attendance mock — `Silva Alejandro` (не `Фамилия Имя`) | В Supabase — `pairMonth` как `string`; нормализовать в хуках |
| `deleteClient` | GAS удаляет без проверки ссылок | Supabase FK RESTRICT — обработать в `useDeleteClient` |
| GAS `markAttendance` | Не обновляет `ClientDisplay` при смене статуса существующей записи | RPC `mark_attendance` пересчитывает всегда |
| `SubscriptionsPanel` | `type: 'pair'` + `pairMonth` при продаже | Сохранить — соответствует GAS |

---

## 13. Миграция данных из Google Sheets

### Шаг 1: Экспорт из GAS (`from GAS/code.gs`)

```javascript
// Добавить в from GAS/code.gs и запустить один раз в редакторе скриптов
function exportAllData() {
  const output = {
    clients:          sheetToObjects('Clients'),
    schedule:         getSchedule(),
    prices:           getPrices(),
    subscriptions:    getSubscriptions(),
    attendance:       getAttendanceRecords(),
    // ВАЖНО: sheetToObjects, не getPersonalLessons() — нужны сырые ID в Client1/2/3
    personalLessons:  sheetToObjects('PersonalLessons')
  };
  const json = JSON.stringify(output, null, 2);
  const file = DriveApp.createFile('tangodb_export.json', json, MimeType.PLAIN_TEXT);
  Logger.log('Файл создан: ' + file.getUrl());
}
```

> Экспорт clients/subscriptions использует **PascalCase** (`FirstName`, `ClientID1`). `personalLessons` из листа: поля `ID`, `Type`, `Client1`, `Client2`, `Client3`, `Date`, `Price`, `Paid` — здесь `Client1/2/3` это **ID**, не display names.

### Шаг 2: Импорт в Supabase

```javascript
// scripts/migrate.mjs — node scripts/migrate.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

/** Sheets Date / ISO / YYYY-MM-DD → 'YYYY-MM-DD' */
function formatDate(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const data = JSON.parse(readFileSync('./tangodb_export.json', 'utf8'));
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role, не anon
);

// Порядок важен: clients → subscriptions → attendance / personal
const clients = data.clients.map(c => ({
  id:         String(c.ID),
  first_name: c.FirstName,
  last_name:  c.LastName,
  telegram:   c.Telegram || ''
}));
await supabase.from('clients').insert(clients);

const schedule = data.schedule.map(s => ({
  day_of_week: parseInt(s.DayOfWeek),
  time:        s.Time
}));
await supabase.from('schedule').insert(schedule);

// prices: пропустить если уже засеяны через INSERT в схеме;
// либо upsert по (type, lessons)

const subs = data.subscriptions.map(s => ({
  id:              String(s.ID),
  type:            s.Type,
  client_id1:      String(s.ClientID1),
  client_id2:      s.ClientID2 ? String(s.ClientID2) : null,
  lessons_total:   parseInt(s.LessonsTotal),
  lessons_left:    parseInt(s.LessonsLeft),
  freeze_used:     parseInt(s.FreezeUsed) || 0,
  activation_date: formatDate(s.ActivationDate),
  status:          s.Status,
  pair_month:      s.PairMonth != null && s.PairMonth !== '' ? String(s.PairMonth) : ''
}));
await supabase.from('subscriptions').insert(subs);

const att = data.attendance.map(a => ({
  date:               formatDate(a.Date),
  subscription_id:    String(a.SubscriptionID),
  client_display:     a.ClientDisplay,
  attendance_status:  a.AttendanceStatus
}));
await supabase.from('attendance').insert(att);

// personalLessons — из sheetToObjects (сырые ID)
const personal = data.personalLessons.map(l => ({
  id:         String(l.ID),
  type:       l.Type,
  client_id1: l.Client1 ? String(l.Client1) : null,
  client_id2: l.Client2 ? String(l.Client2) : null,
  client_id3: l.Client3 ? String(l.Client3) : null,
  date:       formatDate(l.Date),  // helper: Date → 'YYYY-MM-DD'
  price:      parseFloat(l.Price) || 0,
  paid:       l.Paid || 'no'
}));
await supabase.from('personal_lessons').insert(personal);
```

> **Не использовать** `getPersonalLessons()` для экспорта — эта функция подменяет ID на display names для UI.

---

## 14. Промты для Cursor

**Рекомендуемый порядок:** 0 → 1 → 0A → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12  
(SQL и auth — до подключения хуков; utils — до адаптации панелей)

### ПРОМТ 0 — Инициализация проекта

```
Создай проект tangodb на базе папки "from Google Ai Studio":

1. Скопируй src/components (кроме SyncPanel), src/index.css, vite.config.ts, index.html
2. Установи: @supabase/supabase-js, @tanstack/react-query, zustand, react-router-dom
3. Удали: SyncPanel, useTangoStore, code.gs, sandbox localStorage, @google/genai, express
4. Создай src/lib/supabase.ts, src/lib/utils.ts, src/lib/telegram.ts
5. Создай src/auth/ (AuthProvider, ProtectedRoute, LoginPage) — раздел 4
6. Создай src/types/index.ts — типы camelCase (раздел 8)
7. Создай src/store/ui.ts — Zustand (раздел 11)
8. React Router (раздел 10) + QueryClientProvider; /login публичный, остальное ProtectedRoute
9. SubscriptionsPanel и PersonalLessonsPanel: prop initialTab, синхронизация с URL
10. Layout: sidebar + mobile nav из App.tsx — сохранить Tailwind slate/indigo
```

### ПРОМТ 0A — Telegram Auth

```
Реализуй вход через Telegram (раздел 4):
1. Supabase: таблица allowed_users + RLS-политики для CRM-таблиц
2. Edge Function telegram-auth: verify initData ИЛИ widgetPayload (TELEGRAM_BOT_TOKEN), whitelist check
3. LoginPage: auto-auth в Mini App + Telegram Login Widget fallback
4. AuthProvider + ProtectedRoute; session в Supabase client
5. .env.example: VITE_TELEGRAM_BOT_USERNAME, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

### ПРОМТ 1 — Supabase SQL-схема

```
Сгенерируй SQL для Supabase SQL Editor:
- allowed_users + 6 CRM-таблиц по схеме из ТЗ v1.4
- INSERT начальных prices + allowed_users (telegram_id placeholder)
- ENABLE ROW LEVEL SECURITY + политики teacher_only (раздел 4)
- RPC mark_attendance с заполнением client_display (полная версия из раздела 9)
```

### ПРОМТ 2 — Хуки справочников + SchedulePanel, PricesPanel

```
Создай useClients, useSchedule, usePrices (+ мутации).
Маппинг snake_case → camelCase. deleteScheduleSlot и updatePrice — по id (не row).
Адаптируй SchedulePanel и PricesPanel: props store → хуки; PricesPanel — ключ p.id вместо p.row.
```

### ПРОМТ 3 — Хуки абонементов + SubscriptionsPanel

```
Создай useSubscriptions, useAddSubscription, useFinishSubscription.
Активные абонементы: фильтр status=active + join clients (имена, telegram) — как SubscriptionsPanel.
Адаптируй SubscriptionsPanel: initialTab из URL, pairMonth как string, onAddSubscription через хук.
```

### ПРОМТ 4 — Хуки посещаемости

```
Создай useAttendanceRecords, useMarkAttendance (RPC), useScheduleDates (клиент), useSubsForDate (клиентский join).
canFreeze: lessonsTotal === 8 && freezeUsed === 0.
```

### ПРОМТ 5 — Хуки персональных + PersonalLessonsPanel

```
Создай usePersonalLessons, useAddPersonalLessons, useUpdatePersonalPaid, useDeletePersonalLesson.
Фильтр paid на клиенте. update/delete — по id, не row.
Адаптируй PersonalLessonsPanel: initialTab из URL, paid boolean → 'yes'/'no' в хуке.
```

### ПРОМТ 6 — lib/utils

```
formatCurrency (Intl VND ₫), formatClientName (Фамилия Имя), dow helpers (1=пн…7=вс).
```

### ПРОМТ 7 — Адаптация ClientsPanel

```
Адаптируй ClientsPanel из AI Studio:
- Замени props store на useClients / useAddClient / useDeleteClient / useUpdateClient
- Сохрани Tailwind-стили без изменений
- Toast через существующий механизм App.tsx
```

### ПРОМТ 8 — AttendancePanel

```
Адаптируй AttendancePanel:
- useScheduleDates (клиент), useSubsForDate, useMarkAttendance (RPC)
- Оптимистичный UI при markAttendance
- canFreeze: lessonsTotal === 8 && freezeUsed === 0
```

### ПРОМТ 9 — Dashboard

```
Создай DashboardPage на базе Dashboard.tsx из AI Studio:
- Данные из TanStack Query хуков
- Карточки: active subs, warning (lessonsLeft <= 2), revenue персональных
- Расписание на сегодня, quick actions → router.navigate
```

### ПРОМТ 10 — Миграция данных

```
1. Добавь exportAllData() в from GAS/code.gs (раздел 13), экспорт JSON
2. Создай scripts/migrate.mjs с formatDate() для всех DATE-полей
3. npm script "migrate": node scripts/migrate.mjs
4. .env для migrate: SUPABASE_URL, SUPABASE_SERVICE_KEY (не anon)
```

### ПРОМТ 11 — Деплой

```
Подготовь Vercel deploy:
- .env.example: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TELEGRAM_BOT_USERNAME
- vercel.json rewrites для SPA
- README: BotFather Web App URL, добавление telegram_id в allowed_users
```

### ПРОМТ 12 — Финальная зачистка

```
1. Удали SyncPanel, sandbox/G-Sheets badges, «Sync Now»
2. Проверь mobile bottom nav: highlight personalTab; drawer → /personal/book
3. Убери неиспользуемый import useTangoStore из AttendancePanel
4. Прогон tsc --noEmit, vite build
```

---

## 15. Этапы разработки

### Этап 0 — Telegram + Auth (1 день)
- [ ] Бот BotFather + Web App URL
- [ ] `allowed_users` + Edge Function `telegram-auth`
- [ ] LoginPage + ProtectedRoute + RLS-политики

### Этап 1 — Фундамент (1–2 дня)
- [ ] Supabase проект + SQL-схема + RPC
- [ ] Скопировать AI Studio → tangodb, установить зависимости (ПРОМТ 0)
- [ ] React Router + Layout + QueryClient
- [ ] TypeScript-типы (camelCase)

### Этап 2 — Справочники (1 день)
- [ ] Хуки clients, schedule, prices
- [ ] Адаптировать ClientsPanel, SchedulePanel, PricesPanel

### Этап 3 — Абонементы (1–2 дня)
- [ ] Хуки `useSubscriptions`, `useAddSubscription`, `useFinishSubscription`
- [ ] SubscriptionsPanel: вкладки active + sell, prop `initialTab`, join clients для telegram

### Этап 4 — Посещаемость (1–2 дня)
- [ ] Хуки attendance + RPC mark_attendance
- [ ] AttendancePanel

### Этап 5 — Персональные + Dashboard (1–2 дня)
- [ ] Хуки personal_lessons
- [ ] PersonalLessonsPanel
- [ ] Dashboard

### Этап 6 — Миграция данных (1 день)
- [ ] exportAllData в GAS → JSON
- [ ] migrate.mjs → Supabase (проверить personal_lessons IDs)
- [ ] Сверка counts с Sheets

### Этап 7 — Деплой
- [ ] GitHub + Vercel + env vars
- [ ] Удалить SyncPanel, «Sync Now», sandbox-бейджи; проверить mobile drawer и вкладки по URL

---

## 16. Ключевые технические риски

| Риск | Решение |
|---|---|
| Неверная проверка initData | Строго следовать [Telegram WebApp validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app); тест в Mini App |
| Утечка `anon` key без RLS | RLS на всех CRM-таблицах + claim `telegram_id` в JWT |
| Медленный join в `useSubsForDate` | Кэшировать clients/subscriptions отдельными queryKey, join на клиенте |
| `mark_attendance` race condition | PostgreSQL RPC с `FOR UPDATE` |
| personal_lessons import — имена вместо ID | Экспорт через `sheetToObjects('PersonalLessons')`, не `getPersonalLessons()` |
| Вкладки subscriptions/personal не синхронизированы | `initialTab` prop + Zustand + URL |
| GAS rowIndex → Supabase id | Миграция prices/personal: map row→id; UI перевести на id |
| AI Studio `code.gs` неполный | Не использовать — только Supabase backend |
| Vercel 404 на прямых URL | `vercel.json` rewrites → index.html |

---

## 17. Чеклист готовности к продакшену

- [ ] Telegram Mini App открывается из бота; Login Widget работает в браузере
- [ ] Только whitelist `telegram_id` получает доступ; остальные — 403
- [ ] RLS включён на всех CRM-таблицах
- [ ] Все 21 GAS-вызова из `index.html` покрыты Supabase-хуками; eager bulk-load 6 сущностей (как AI Studio)
- [ ] RPC `mark_attendance` протестирована (freeze, present↔absent, 0 lessons, client_display)
- [ ] Dashboard отображает актуальные данные
- [ ] Toast-уведомления для всех ошибок
- [ ] Mobile bottom nav + drawer (из AI Studio)
- [ ] Данные из Google Sheets перенесены и проверены
- [ ] SyncPanel удалён, sandbox mode удалён
- [ ] `.env.local` в `.gitignore`, секреты в Vercel Dashboard
- [ ] HTTPS + PWA manifest (опционально)

---

## Changelog

### v1.5 (2026-06-10)
- Исправлено: 9 → **8** компонентов-панелей в AI Studio
- Навигация: 7 секций + 10 URL-маршрутов (было «8 маршрутов + 7 CRM»)
- RLS: полные политики SELECT/INSERT/UPDATE/DELETE + `WITH CHECK`; `allowed_users` без политик для anon
- SQL: явный порядок выполнения (таблицы → RLS → RPC → GRANT)
- migrate.mjs: `formatDate()` для `activation_date` и `attendance.date`
- Промты: порядок 0→1→0A; панели встроены в промты 2/3/5; добавлены ПРОМТ 10 (миграция), 11 (деploy), 12 (зачистка) — **всего 14 промтов**
- Таблица расхождений: `paid boolean` → `'yes'/'no'`

### v1.4 (2026-06-10)
- Повторная сверка с `from GAS/` и `from Google Ai Studio/` (код, компоненты, `index.css`)
- Уточнена навигация: 8 маршрутов (dashboard + 7 CRM), не «7 секций»
- Добавлены баги прототипа: вкладки не передаются; mobile nav «Приваты» → только view
- Telegram Auth: валидация Login Widget (`widgetPayload`) + Mini App (`initData`)
- `index.css`: `wine-*`/`gold-*` — алиасы slate/indigo; удалить Sync UI из Layout
- RPC: `GRANT EXECUTE` для `authenticated`; предупреждение FK при `deleteClient`
- GAS: `markAttendance` не обновляет `ClientDisplay` при edit
- migrate.mjs: добавлен `formatDate()`; `staleTime` для TanStack Query
- Таблица расхождений: deleteClient FK, mock-данные, App.tsx Sync badges

### v1.3 (2026-06-10)
- **Обязательная аутентификация через Telegram** по numeric `telegram_id` (раздел 4)
- Добавлены: `allowed_users`, Edge Function `telegram-auth`, RLS вместо DISABLE RLS
- Маршрут `/login`, `AuthProvider`, `ProtectedRoute`, env для бота
- Исправлено: «5 утилит» → 4 утилиты; 26 бизнес-функций в GAS
- Уточнён баг вкладок: `subPanelTab`/`persPanelTab` не передаются в дочерние панели
- ПРОМТ 0A (Telegram Auth), Этап 0 в roadmap, обновлён чеклист

### v1.2 (2026-06-10)
- Сверка с актуальным кодом `from GAS/` и `from Google Ai Studio/`
- Исправлено: 9 → 8 UI-секций; 31 функция в GAS (21 вызов с фронта)
- Добавлены хуки `useSubscriptions`, `useAttendanceRecords`; уточнён bulk-load паттерн
- Исправлен экспорт `personal_lessons` — `sheetToObjects`, не `getPersonalLessons()`
- Расширена таблица расхождений AI Studio ↔ GAS (вкладки, PricesPanel row→id, GAS display names)
- `pairMonth` унифицирован как `string` в БД; в AI Studio mock — `number | ""` (нормализовать в хуках)
- Промты 2–6 детализированы; ПРОМТ 0 — удаление лишних зависимостей AI Studio

### v1.1 (2026-06-10)
- Сверка с `from GAS/` и `from Google Ai Studio/`
- Дизайн: CSS Modules → Tailwind v4 (AI Studio)
- Структура: pages-only → components-панели AI Studio + Router
- Добавлены: Dashboard, типы цен/абонементов, ActiveSubscription, camelCase types
- Исправлен баг RPC `mark_attendance` (пустой client_display)
- Уточнено: 21 frontend API call; rowIndex → id при миграции
- SyncPanel помечен как временный; добавлено предупреждение про import personal_lessons

### v1.0
- Первоначальная версия ТЗ

---

*Документ составлен на основе анализа `from GAS/code.gs`, `from GAS/index.html` (8 панелей, 21 вызов GAS) и `from Google Ai Studio/` (React-прототип, 8 компонентов-панелей, Tailwind v4).*
