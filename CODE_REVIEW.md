# TangoDB — Code Review (Amazon CRM Level)

> Reviewed: 2026-06-15  
> Stack: React 19 · TypeScript 5.8 · Vite 6 · Supabase (PostgreSQL 17 + RLS) · Vercel  
> Scope: `tangodb/src/`, `tangodb/supabase/schema.sql`, `tangodb/supabase/functions/telegram-auth/`

## Вердикт после повторной проверки

Документ в целом правильно определяет несколько реальных P0/P1-проблем, но **в исходном виде не был готов как план реализации**: часть рецептов использовала несуществующий API Supabase, часть оставляла небезопасные fallback-и, а один пункт по прайсам мог создать дубликаты seed-данных при миграциях. Ниже файл скорректирован так, чтобы найденные проблемы можно было исправлять без регрессий для текущего проекта.

---

## Оценка

| Категория | Балл | Комментарий |
|-----------|------|-------------|
| Архитектура | 6/10 | Чёткое разделение слоёв, но монолитные панели и отсутствие пагинации |
| Безопасность | 5/10 | RLS грамотный, но CORS `*` и отсутствие rate limiting |
| Производительность | 4/10 | Нет пагинации, все данные грузятся разом |
| Качество кода | 6/10 | Дублирование, компоненты-гиганты, неполные типы |
| База данных | 6/10 | Хорошие RPС с атомарностью, но есть узкие места в схеме |
| Тестирование | 1/10 | Только `tsc --noEmit`, тестов нет |

---

## 🔴 КРИТИЧЕСКИЕ БАГИ

### BUG-1: `Date.now()` как первичный ключ — риск коллизии

**Файлы:** `useClients.ts:51`, `useSubscriptions.ts:97`, `usePersonalLessons.ts:101-103`

```typescript
// useClients.ts
const id = String(Date.now());  // ← ОПАСНО

// usePersonalLessons.ts
const baseId = Date.now();
const rows = lessons.dates.map((date, i) => ({
  id: String(baseId + i),  // ← "коллизия" если два запроса в одну мс
```

**Проблема:** `Date.now()` возвращает миллисекунды. Если два преподавателя (или двойной клик) создадут запись в одну миллисекунду — будет `PRIMARY KEY CONFLICT`. PostgreSQL выбросит ошибку, но клиент получит невнятное сообщение. В `personal_lessons` при добавлении нескольких уроков сразу используется `baseId + i`, что надёжно в рамках одного вызова, но не между параллельными вызовами.

**Prompt для исправления:**
```
В файлах tangodb/src/hooks/useClients.ts (строка 51), useSubscriptions.ts (строка 97) и usePersonalLessons.ts (строки 101-103) замени генерацию ID через Date.now() на crypto.randomUUID(). 

Для useClients.ts: const id = crypto.randomUUID();
Для useSubscriptions.ts: const id = crypto.randomUUID();
Для usePersonalLessons.ts: const baseId используется для нескольких rows — замени на rows = lessons.dates.map((date) => ({ id: crypto.randomUUID(), ... })).

Убедись, что schema.sql тоже принимает UUID строки (колонки id TEXT — это уже корректно, изменений в схеме не требуется).
```

---

### BUG-2: `discipline_id` отсутствует в SELECT-запросе персональных уроков

**Файл:** `usePersonalLessons.ts:52-53`

```typescript
const personalLessonsSelect =
  "id, type, client_id1, client_id2, client_id3, date, time_start, time_end, price, paid, subscription_id, attendance_status, client1:clients!client_id1(first_name, last_name), client2:clients!client_id2(first_name, last_name), client3:clients!client_id3(first_name, last_name)";
//  ^^^^ discipline_id ОТСУТСТВУЕТ в запросе!
```

**Проблема:** `discipline_id` сохраняется при создании урока (`insert({ discipline_id: ... })`), но при чтении не запрашивается. В результате `personalLesson.disciplineId` **всегда `null`** после загрузки, даже если значение есть в БД. Это тихая потеря данных — дисциплина не отображается в карточке урока.

**Prompt для исправления:**
```
В файле tangodb/src/hooks/usePersonalLessons.ts в строке 52-53 добавь discipline_id в строку personalLessonsSelect. Текущая строка не содержит discipline_id, из-за чего PersonalLesson.disciplineId всегда null после загрузки.

Исправленная строка должна начинаться с: "id, type, client_id1, client_id2, client_id3, discipline_id, date, time_start, ..."
```

---

### BUG-3: `listUsers({ perPage: 1000 })` — потолок пагинации

**Файл:** `supabase/functions/telegram-auth/index.ts:98`

```typescript
const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
const existing = list.users.find((u) => u.email === email);
```

**Проблема:** Если в проекте более 1000 auth-пользователей, `listUsers` вернёт только первую страницу и `existing` не найдёт пользователей из остатка. В результате для существующих юзеров будет попытка создать дубликат, `createUser` вернёт ошибку `"already"`, ошибка будет проглочена, а `app_metadata/user_metadata` старого аккаунта могут остаться неактуальными.

**Важно:** не заменять это на `admin.auth.admin.getUserByEmail(email)` — такого метода нет в `supabase-js` Admin API. Безопасная замена для текущего проекта — постраничный обход `listUsers`.

**Prompt для исправления:**
```
В файле tangodb/supabase/functions/telegram-auth/index.ts добавь helper findAuthUserByEmail, который постранично обходит listUsers:

async function findAuthUserByEmail(admin, email: string) {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const existing = data.users.find((u) => u.email === email);
    if (existing) return existing;
    if (data.users.length < perPage) return null;
  }
}

В ensureTelegramUser используй findAuthUserByEmail(email). Если пользователь найден — updateUserById с сохранением старых app_metadata/user_metadata.

Если createUser вернул "already", не проглатывай это молча: повторно вызови findAuthUserByEmail(email), обнови metadata найденного пользователя и только после этого return. Если пользователь всё равно не найден — throw createError.
```

---

### BUG-4: `ActiveSubscription` не содержит данных третьего клиента

**Файл:** `useSubscriptions.ts:42-79`, `types/index.ts:79-91`

```typescript
// Интерфейс
export interface ActiveSubscription {
  client1: string;
  client2: string;
  // ← client3 отсутствует!
}

// В useActiveSubscriptions:
const c2 = s.clientId2 ? clientMap[s.clientId2] : null;
// ← clientId3 никогда не обрабатывается
```

**Проблема:** При трио-абонементе (`type: trio`, `client_id3` заполнен) третий клиент частично теряется в UI. `useActiveSubscriptions` сейчас не используется, но сама проблема шире: `SubscriptionsPanel`, `Dashboard` и `computeSubsForDate` строят отображение только по `clientId1/clientId2`. В результате персональные trio-пакеты отображаются неполно, а Telegram-контакт третьего клиента недоступен.

**Prompt для исправления:**
```
В tangodb/src/types/index.ts добавь поля client3/client3tg в ActiveSubscription и client3 в SubForDate.

В tangodb/src/hooks/useSubscriptions.ts в useActiveSubscriptions добавь маппинг clientId3:
const c3 = s.clientId3 ? clientMap[s.clientId3] : null;
и добавь client3, client3tg в возвращаемый объект.

В tangodb/src/hooks/useAttendance.ts в computeSubsForDate добавь c3 и возвращай client3.

В tangodb/src/components/SubscriptionsPanel.tsx и tangodb/src/components/Dashboard.tsx обнови сборку clientNameStr/queryStr/Telegram-кнопок так, чтобы они учитывали clientId3 аналогично clientId2.

В tangodb/src/components/AttendancePanel.tsx (строка ~269) обнови отображение fullname для trio: учитывай st.client3 наряду с st.client1/st.client2.
```

---

## 🟠 ПРОБЛЕМЫ БЕЗОПАСНОСТИ

### SEC-1: CORS `Access-Control-Allow-Origin: *`

**Файл:** `supabase/functions/telegram-auth/index.ts:4`

```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",  // ← любой сайт может вызвать этот endpoint
```

**Проблема:** Edge Function принимает запросы с любого домена. Хотя сам Telegram HMAC защищает от поддельных данных, практика `*` нарушает принцип наименьших привилегий. Если в будущем endpoint расширится (например, обновление профиля без токена), это откроет вектор атаки с других доменов.

**Prompt для исправления:**
```
В файле tangodb/supabase/functions/telegram-auth/index.ts замени статический corsHeaders на функцию, которая проверяет Origin по allowlist. Не оставляй "*" fallback для production.

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function corsHeadersFor(req: Request): HeadersInit | null {
  const origin = req.headers.get("Origin") ?? "";
  if (!allowedOrigins.length) return null;
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

Измени jsonResponse(body, status, req) и Deno.serve: если corsHeadersFor(req) вернул null — отвечай 403 (или 500 при пустом ALLOWED_ORIGINS), не используй "*" и не подставляй allowedOrigins[0] для чужого Origin.

Добавь ALLOWED_ORIGINS в Supabase Edge Function Secrets: production Vercel URL и, при необходимости, preview URL через запятую.
```

---

### SEC-2: Отсутствие rate limiting на Edge Function

**Файл:** `supabase/functions/telegram-auth/index.ts`

**Проблема:** Нет ограничения на частоту запросов. Бот может спамить аутентификационными попытками. Supabase Edge Functions не гарантируют единый in-memory state между инстансами, поэтому простой `Map` в памяти — только best-effort, а не полноценный production rate limiting.

**Prompt для исправления:**
```
В tangodb/supabase/functions/telegram-auth/index.ts реализуй двухуровневую защиту:

1. До разбора JSON и HMAC-проверки — best-effort лимит по IP из x-forwarded-for/cf-connecting-ip, чтобы дешево отсекать мусорные запросы.
2. После успешной верификации Telegram payload — лимит по telegramId.

Для текущего проекта допустим in-memory Map с TTL как первый шаг:
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

Возвращай 429 при превышении лимита. В комментарии к коду явно укажи, что для полноценного production rate limiting нужен внешний shared store (например, Supabase table/RPC, Upstash Redis или gateway-level protection).
```

---

### SEC-3: `auth_date` window 24 часа для Mini App

**Файл:** `supabase/functions/telegram-auth/index.ts:51`

```typescript
if (!authDate || Date.now() / 1000 - authDate > 86_400) return null;
```

**Проблема:** Telegram рекомендует проверять `auth_date` в течение 5-10 минут для Mini App initData, а не 24 часов. 24 часа допустимы для Login Widget (статичный токен), но Mini App токены могут быть перехвачены в логах и использованы в течение суток.

**Prompt для исправления:**
```
В tangodb/supabase/functions/telegram-auth/index.ts раздели константу таймаута для Mini App (initData) и Login Widget.

В verifyInitData замени 86_400 на 300 (5 минут):
if (!authDate || Date.now() / 1000 - authDate > 300) return null;

В verifyLoginWidget оставь 86_400 (24 часа) — это стандарт для виджета.
```

---

## 🟡 ПРОИЗВОДИТЕЛЬНОСТЬ

### PERF-1: Нет пагинации — все данные загружаются сразу

**Файлы:** `useAttendance.ts:90-103`, `usePersonalLessons.ts:55-77`

```typescript
// useAttendanceRecords — ALL records, no filter
const { data, error } = await supabase
  .from("attendance")
  .select("*")
  .order("date", { ascending: false });  // ← вся таблица

// usePersonalLessons — ALL lessons
const { data, error } = await supabase
  .from("personal_lessons")
  .select(personalLessonsSelect)
  .order("date", { ascending: false });  // ← вся таблица
```

**Проблема:** При 100 студентах за год тренировок `attendance` накопит ~30 000 строк, `personal_lessons` — ~5 000. Это будут большие JSON-ответы, медленный парсинг и избыточный расход памяти браузера.

**Prompt для исправления:**
```
В tangodb/src/hooks/useAttendance.ts добавь серверную фильтрацию по месяцу в useAttendanceRecords:

export function useAttendanceRecords(yearMonth?: string) {
  return useQuery({
    queryKey: yearMonth ? [...attendanceQueryKey, yearMonth] : attendanceQueryKey,
    queryFn: async () => {
      let query = supabase
        .from("attendance")
        .select("*")
        .order("date", { ascending: false });
      
      if (yearMonth) {
        const [y, m] = yearMonth.split("-").map(Number);
        const start = `${y}-${String(m).padStart(2,"0")}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const end = `${y}-${String(m).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;
        query = query.gte("date", start).lte("date", end);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(mapAttendanceRecord);
    },
    staleTime: 30 * 1000,
  });
}

usePersonalLessons(yearMonth?) делай с опциональным параметром: если yearMonth не передан — загружай все записи (обратная совместимость). Не меняй вызовы в SchedulePanel.tsx, PersonalLessonsPanel.tsx (конфликты бронирования) и DashboardPage.tsx — им нужен полный набор. В AttendancePanel передай selectedMonth только если отдельный анализ подтвердит, что полный список не нужен для конфликтов/календаря.
```

---

### PERF-2: Дублирование вычислений `clientMap` на каждый рендер

**Файл:** `Dashboard.tsx:43-44`, `SubscriptionsPanel.tsx:180` (проблемные); `useAttendance.ts:57`, `useSubscriptions.ts:49` — внутри `useMemo`, не критично

```typescript
// Dashboard.tsx:43-44 — reduce создаёт новый объект на каждой итерации (O(N²))
const clientMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {} as Record<string, Client>);
const disciplineMap = disciplines.reduce((acc, d) => ({ ...acc, [d.id]: d }), {} as Record<number, Discipline>);
```

**Проблема:** В `Dashboard.tsx` строки 43-44 пересоздают `clientMap`/`disciplineMap` при каждом рендере, т.к. это не в `useMemo`. `computeSubsForDate` и `useActiveSubscriptions` вызывают `Object.fromEntries` внутри `useMemo` — там проблемы нет. Тот же антипаттерн `reduce((acc) => ({ ...acc }))` есть в `SubscriptionsPanel.tsx:180`.

**Prompt для исправления:**
```
В tangodb/src/components/Dashboard.tsx замени создание clientMap и disciplineMap (строки 43-44) на useMemo:

const clientMap = useMemo(
  () => Object.fromEntries(clients.map((c) => [c.id, c])) as Record<string, Client>,
  [clients]
);
const disciplineMap = useMemo(
  () => Object.fromEntries(disciplines.map((d) => [d.id, d])) as Record<number, Discipline>,
  [disciplines]
);

Добавь импорт useMemo из 'react' если его нет.
```

---

### PERF-3: `useSubsForDate` — нестабильная ссылка на `options`

**Файл:** `useAttendance.ts:125-163`

```typescript
export function useSubsForDate(
  dateStr?: string,
  options?: { category?: "group" | "private"; subscriptionIds?: string[] }
) {
  // ...
  const getSubsForDate = useCallback(
    (date, opts) => computeSubsForDate(..., opts ?? options),
    [subscriptionsQuery.data, clientsQuery.data, attendanceQuery.data, options]  // ← options в deps
  );
```

**Проблема:** Если вызывающий код передаёт `options` как inline-объект `useSubsForDate(date, { category: "group" })`, то при каждом рендере создаётся новый объект, `options` меняется — `useCallback` пересоздаётся — вызывает каскадный ререндер. В текущем `AttendancePanel` объект уже мемоизирован через `useMemo`, поэтому это не срочный баг, а хрупкость API для будущих вызовов.

**Prompt для исправления:**
```
Не ломай API хука без необходимости. В tangodb/src/hooks/useAttendance.ts нормализуй options внутри useSubsForDate и используй стабильный dependency key:

const optionsKey = `${options?.category ?? ""}|${(options?.subscriptionIds ?? []).join(",")}`;
const stableOptions = useMemo(
  () =>
    options
      ? { category: options.category, subscriptionIds: options.subscriptionIds }
      : undefined,
  [optionsKey]
);

Затем в computeSubsForDate передавай stableOptions, а в dependency arrays используй stableOptions/optionsKey вместо сырого options.

Если позже будет крупный refactor, можно заменить API на:
export function useSubsForDate(
  dateStr?: string,
  category?: "group" | "private",
  subscriptionIds?: string[]
) { ... }
```

---

## 🔵 КАЧЕСТВО КОДА

### CODE-1: Дублирование функции `currentYearMonth`

**Файлы:** `lib/utils.ts:188`, `PersonalLessonsPanel.tsx:57-60`, `store/ui.ts:20-24`

```typescript
// lib/utils.ts
export function currentYearMonth(): string { ... }

// PersonalLessonsPanel.tsx — ДУБЛИКАТ
function currentYearMonth(): string { ... }

// store/ui.ts — ещё один ДУБЛИКАТ
const currentMonth = () => { ... }
```

**Prompt для исправления:**
```
В tangodb/src/components/PersonalLessonsPanel.tsx удали локальную функцию currentYearMonth (строки 57-60) и добавь импорт из "../lib/utils": import { currentYearMonth } from "../lib/utils";

В tangodb/src/store/ui.ts замени локальную функцию currentMonth на импорт currentYearMonth из "../lib/utils":
import { currentYearMonth } from "../lib/utils";
и измени initialState: selectedMonth: currentYearMonth().
```

---

### CODE-2: Двойной импорт `ChevronRight` с алиасом

**Файл:** `AttendancePanel.tsx:17-18`

```typescript
import {
  ChevronRight,
  ChevronRight as ChevronRightIcon,  // ← один и тот же компонент дважды
} from "lucide-react";
```

**Prompt для исправления:**
```
В tangodb/src/components/AttendancePanel.tsx удали дублирующий импорт ChevronRight as ChevronRightIcon. Найди все использования ChevronRightIcon в файле и замени на ChevronRight.
```

---

### CODE-3: Отсутствие React Error Boundaries

**Проблема:** Если любой компонент выбросит исключение в render (например, из-за неожиданных данных от Supabase), весь UI рухнет в белый экран. Для production CRM это критично.

**Prompt для исправления:**
```
Создай файл tangodb/src/components/ui/ErrorBoundary.tsx с классовым компонентом React ErrorBoundary:

import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info);
  }
  
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-6 text-center text-rose-600">
          <p className="font-semibold">Произошла ошибка</p>
          <p className="text-xs text-slate-500 mt-1">{this.state.error?.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

Оберни каждый <section> с <Outlet /> в App.tsx в <ErrorBoundary>, а также каждую Page-компоненту.
```

---

### CODE-4: `ToastContext` — молчащий дефолт вместо явной ошибки

**Файл:** `App.tsx:36`

```typescript
const ToastContext = createContext<(msg: string, type?: ToastType) => void>(() => {});
//                                                                           ^^^^ no-op, не выбросит ошибку
```

**Сравни с AuthContext (правильный паттерн):**
```typescript
const AuthContext = createContext<AuthContextValue | null>(null);
// useAuth выбросит: if (!ctx) throw new Error("useAuth must be used within AuthProvider");
```

**Проблема:** Если `useToast()` вызван вне `AppLayout`, тосты молча игнорируются. Ошибка остаётся незамеченной в разработке.

**Prompt для исправления:**
```
В tangodb/src/App.tsx измени создание ToastContext:
const ToastContext = createContext<((msg: string, type?: ToastType) => void) | null>(null);

И измени useToast() для явной проверки:
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within AppLayout");
  return ctx;
}

Обнови ToastContext.Provider value чтобы передавать showToast напрямую.
```

---

### CODE-5: Нет обработки ошибок запросов в компонентах

**Проблема:** Большинство компонентов проверяют только `isLoading`, но не `isError`. При сетевой ошибке пользователь видит пустой список без объяснения.

**Prompt для исправления:**
```
Во всех основных хуках-компонентах добавь проверку isError и отображение сообщения об ошибке.

Пример паттерна для ClientsPanel, SubscriptionsPanel, PersonalLessonsPanel, AttendancePanel:

const { data: clients = [], isLoading, isError, error } = useClients();

// В JSX:
if (isError) {
  return (
    <div className="p-6 text-center text-rose-600">
      <AlertCircle className="w-8 h-8 mx-auto mb-2" />
      <p className="font-semibold">Не удалось загрузить данные</p>
      <p className="text-xs text-slate-500 mt-1">{error?.message}</p>
    </div>
  );
}
```

---

### CODE-6: Компонент `PersonalLessonsPanel.tsx` — 1078 строк

**Файл:** `PersonalLessonsPanel.tsx`

**Проблема:** 1077-строчный файл — это антипаттерн для масштабируемого CRM. Содержит смешение: вкладку просмотра уроков, форму бронирования, форму редактирования, логику пакетов. Поддержка и тестирование крайне затруднены.

**Prompt для рефакторинга:**
```
Разбей tangodb/src/components/PersonalLessonsPanel.tsx на 4 подкомпонента:

1. PersonalLessonsView.tsx (~300 строк) — вкладка "Журнал": фильтры, список уроков, карточка урока с кнопками оплаты/удаления/редактирования

2. PersonalLessonBookingForm.tsx (~350 строк) — форма бронирования нового урока: выбор клиентов, дат, времени, тарифа, привязки к пакету

3. PersonalLessonEditModal.tsx (~100 строк) — модальное окно редактирования даты/времени существующего урока

4. PersonalLessonsPanel.tsx (~150 строк) — корневой компонент: управляет вкладками, пробрасывает общие данные (clients, disciplines, prices, subscriptions) в подкомпоненты через props

Используй существующую компоненту PageTabs для переключения вкладок.
```

---

### CODE-7: `@license SPDX-License-Identifier: Apache-2.0` в компонентах

**Файлы:** `PersonalLessonsPanel.tsx:1`, `AttendancePanel.tsx:1`, `Dashboard.tsx:1`

**Проблема:** Эти шапки лицензий — артефакт из `from Google AI Studio/`. Они некорректны для закрытого проекта и вводят в заблуждение: Apache-2.0 — это open-source лицензия.

**Prompt для исправления:**
```
Удали строки /** @license SPDX-License-Identifier: Apache-2.0 */ из начала файлов:
- tangodb/src/components/PersonalLessonsPanel.tsx
- tangodb/src/components/AttendancePanel.tsx
- tangodb/src/components/Dashboard.tsx

Это артефакты от Google AI Studio и не соответствуют закрытому проекту.
```

---

## 🗄 БАЗА ДАННЫХ

### DB-1: `UNIQUE (day_of_week, time, discipline_id)` — NULL-дубликаты

**Файл:** `schema.sql:37`

```sql
UNIQUE (day_of_week, time, discipline_id)
```

**Проблема:** В PostgreSQL `NULL != NULL` в контексте UNIQUE-ограничений. Это означает, что можно создать сколько угодно строк `(1, '10:00', NULL)` — уникальность нарушается для слотов без дисциплины. Пользователь может случайно создать дублирующиеся "undisciplined" слоты в расписании.

**Важно:** в уже развёрнутой БД миграция `20260614120000_disciplines.sql` создала индекс `schedule_day_time_discipline_unique` (не table-constraint из schema.sql). NULL-дубликаты возможны в обоих вариантах.

**Prompt для исправления:**
```
В tangodb/supabase/schema.sql убери UNIQUE (day_of_week, time, discipline_id) из CREATE TABLE schedule и добавь два частичных индекса (см. ниже).

Создай миграцию tangodb/supabase/migrations/20260616000001_fix_schedule_unique.sql:

-- Снять все варианты старого ограничения/индекса (зависит от истории деплоя)
ALTER TABLE schedule DROP CONSTRAINT IF EXISTS schedule_day_of_week_time_key;
ALTER TABLE schedule DROP CONSTRAINT IF EXISTS schedule_day_of_week_time_discipline_id_key;
DROP INDEX IF EXISTS schedule_day_time_discipline_unique;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_no_discipline_unique
  ON schedule (day_of_week, time)
  WHERE discipline_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_with_discipline_unique
  ON schedule (day_of_week, time, discipline_id)
  WHERE discipline_id IS NOT NULL;
```

---

### DB-2: `UNIQUE (type, lessons)` в `prices` — ограничивает гибкость прайса

**Файл:** `schema.sql:47-48`

```sql
CREATE TABLE IF NOT EXISTS prices (
  ...
  UNIQUE (type, lessons)  -- ← нельзя иметь два тарифа solo/4 по разным ценам
);
```

**Проблема:** Формально `UNIQUE (type, lessons)` запрещает два тарифа с одинаковым техническим `type` и количеством уроков. Но в текущей реализации пользовательские тарифы создаются через `generateTariffTypeKey()` с уникальным technical `type`, поэтому UI уже позволяет иметь несколько тарифов с одинаковым количеством уроков и разными labels/prices. Удалять unique-constraint сейчас опасно: seed использует `ON CONFLICT (type, lessons) DO NOTHING`, и без аккуратной миграции можно получить дубли при повторном применении schema/seed.

**Prompt для исправления:**
```
Не делать это как срочную миграцию.

Если появится бизнес-требование иметь несколько тарифов с одним и тем же technical type:
1. Сначала обнови seed в schema.sql так, чтобы повторный запуск не создавал дубликаты без UNIQUE (например, явные stable keys или отдельный seed-upsert по id).
2. Обнови findSubscriptionPrice в tangodb/src/lib/utils.ts: при отсутствии priceId выбирать предсказуемый legacy tariff, а для новых продаж всегда сохранять price_id.
3. Только после этого удаляй UNIQUE (type, lessons) отдельной миграцией и добавляй обычный индекс prices_type_lessons_idx.

До такого требования оставь constraint как защиту seed/legacy-данных.
```

---

### DB-3: Отсутствие индексов на часто запрашиваемых колонках

**Проблема:** Производительность запросов деградирует по мере роста данных. Особенно критично для:
- `attendance.date` — поиск по дате для журнала
- `attendance.subscription_id` — JOIN в mark_attendance
- `subscriptions.status` — фильтрация активных
- `subscriptions.client_id1/2/3` — проверка клиентов
- `personal_lessons.date` — фильтрация по месяцу

**Prompt для исправления:**
```
Создай файл tangodb/supabase/migrations/20260616000003_add_performance_indexes.sql со следующими индексами:

-- Attendance: поиск по дате и по абонементу
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_subscription_id ON attendance (subscription_id);

-- Subscriptions: фильтрация активных, поиск по клиентам
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_client_id1 ON subscriptions (client_id1);
CREATE INDEX IF NOT EXISTS idx_subscriptions_activation_date ON subscriptions (activation_date DESC);

-- Personal lessons: поиск по дате и по клиенту
CREATE INDEX IF NOT EXISTS idx_personal_lessons_date ON personal_lessons (date DESC);
CREATE INDEX IF NOT EXISTS idx_personal_lessons_client_id1 ON personal_lessons (client_id1);
CREATE INDEX IF NOT EXISTS idx_personal_lessons_subscription_id ON personal_lessons (subscription_id) WHERE subscription_id IS NOT NULL;
```

---

### DB-4: `mark_attendance` принимает `p_date TEXT` без валидации формата

**Файл:** `schema.sql:178`

```sql
CREATE OR REPLACE FUNCTION mark_attendance(
  p_date TEXT,  ...
) RETURNS JSONB AS $$
BEGIN
  IF p_date::DATE > v_today THEN  -- ← бросит PostgreSQL exception если формат неверный
```

**Проблема:** Если передать `p_date = "invalid"`, PostgreSQL выбросит необработанное исключение `invalid input syntax for type date`, которое попадёт к клиенту как `500`-ошибка с техническим сообщением.

**Prompt для исправления:**
```
В tangodb/supabase/schema.sql в функции mark_attendance добавь валидацию даты в начало тела функции:

BEGIN
  -- Валидация формата даты
  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
  END IF;
  
  IF p_date::DATE > v_today THEN
  ...

Аналогично добавь валидацию в mark_personal_lesson_attendance для проверки что p_lesson_id не пустой.
Создай новую миграцию с обновлёнными версиями обеих функций.
```

---

### DB-5: Отсутствие таблицы аудита (audit log)

**Проблема:** Для CRM уровня production критично знать: кто и когда изменил статус абонемента, удалил клиента, поставил отметку. Сейчас нет никакой истории изменений.

**Prompt для исправления:**
```
Создай миграцию tangodb/supabase/migrations/20260616000004_audit_log.sql:

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id      TEXT NOT NULL,
  old_data    JSONB,
  new_data    JSONB,
  changed_by  BIGINT,  -- telegram_id из auth
  changed_at  TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id::TEXT ELSE NEW.id::TEXT END,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    auth_telegram_id()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Включить аудит для ключевых таблиц
CREATE TRIGGER audit_subscriptions AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_personal_lessons AFTER INSERT OR UPDATE OR DELETE ON personal_lessons
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_attendance AFTER INSERT OR UPDATE OR DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teacher_select" ON audit_log FOR SELECT USING (is_allowed_teacher());
```

---

## 🟢 ЧТО СДЕЛАНО ХОРОШО

Следующие решения заслуживают отдельного признания:

1. **Атомарные RPC-функции** (`mark_attendance`, `mark_personal_lesson_attendance`) — логика дебита уроков и заморозки инкапсулирована в PostgreSQL, не раздроблена по клиенту. Это правильно.

2. **Оптимистичные обновления** в `useMarkAttendance` с зеркалированием дельт — реверс при ошибке реализован корректно через `onError`.

3. **Whitelist-based RLS** — только разрешённые Telegram-пользователи имеют доступ к данным. Правильно применён паттерн `SECURITY DEFINER` для `is_allowed_teacher()`.

4. **TanStack Query** с разными `staleTime` (5 мин для справочников, 30 с для транзакционных данных) — умный выбор.

5. **Конфликт-детекция** расписания на стороне клиента (`findBookingScheduleConflict`) — быстрая и не требует round-trip к серверу.

6. **Graceful fallback** в `usePersonalLessons` при падении JOIN-запроса — откат на `select("*")` сохраняет работоспособность.

7. **safe-area-inset-bottom** в мобильном таб-баре — правильная поддержка iPhone notch.

8. **Клиент-автоматизация для устройств Telegram** — `isTelegramWebApp()` → автоматический логин без UI.

9. **`pluralizeRu`** — корректная русская плюрализация с учётом чисел 11-19.

10. **`validate_personal_lesson_subscription` TRIGGER** — проверка соответствия клиентов между уроком и пакетом на уровне БД — правильное место для этой логики.

---

## 📊 Сводная таблица приоритетов

| ID | Приоритет | Тип | Описание | Сложность |
|----|-----------|-----|----------|-----------|
| BUG-1 | 🔴 P0 | Баг | `Date.now()` как PK — риск коллизии | Низкая |
| BUG-2 | 🔴 P0 | Баг | `discipline_id` не в SELECT — всегда null | Низкая |
| BUG-3 | 🔴 P0 | Баг | `listUsers` потолок 1000; нужен постраничный поиск | Средняя |
| SEC-3 | 🔴 P0 | Безопасность | 24ч auth_date для Mini App | Низкая |
| BUG-4 | 🟠 P1 | Баг | `client3` потеря данных трио | Средняя |
| SEC-1 | 🟠 P1 | Безопасность | CORS `*` в Edge Function | Низкая |
| SEC-2 | 🟠 P1 | Безопасность | Нет rate limiting | Средняя |
| PERF-1 | 🟠 P1 | Производительность | Нет пагинации | Высокая |
| DB-1 | 🟠 P1 | БД | NULL в UNIQUE index для schedule | Низкая |
| DB-3 | 🟠 P1 | БД | Нет performance-индексов | Низкая |
| DB-4 | 🟡 P2 | БД | p_date без валидации в RPC | Низкая |
| CODE-1 | 🟡 P2 | Качество | Дублирование `currentYearMonth` | Низкая |
| CODE-2 | 🟡 P2 | Качество | Двойной import ChevronRight | Низкая |
| CODE-3 | 🟡 P2 | Качество | Нет ErrorBoundary | Средняя |
| CODE-4 | 🟡 P2 | Качество | Toast no-op вместо throw | Низкая |
| CODE-5 | 🟡 P2 | Качество | Нет isError в компонентах | Средняя |
| CODE-6 | 🟡 P2 | Качество | PersonalLessonsPanel 1077 строк | Высокая |
| CODE-7 | 🟢 P3 | Качество | Apache-2.0 лицензии-артефакты | Низкая |
| PERF-2 | 🟢 P3 | Производительность | clientMap без useMemo в Dashboard | Низкая |
| PERF-3 | 🟢 P3 | Производительность | options-ловушка в useSubsForDate; текущий вызов уже memoized | Низкая |
| DB-2 | 🟢 P3 | БД | prices UNIQUE не срочно трогать; сначала нужен seed-safe дизайн | Средняя |
| DB-5 | 🟢 P3 | БД | Нет таблицы аудита | Средняя |

---

## 🚀 Предложения по улучшению (архитектурный уровень)

### 1. Мягкое удаление (Soft Delete) для клиентов

Текущее поведение: `DELETE` клиента падает с FK-ошибкой `23503` если есть абонементы. Вместо этого — добавить `archived_at TIMESTAMPTZ` и фильтровать `WHERE archived_at IS NULL` в RLS.

### 2. Виртуализированные списки для журнала посещений

`AttendancePanel` рендерит ВСЕ строки для выбранного дня. При 20+ активных абонементах стоит подключить `@tanstack/react-virtual` для виртуализации.

### 3. Offline-режим и статус соединения

Supabase Realtime может давать уведомления о разрывах. Добавить небольшой баннер "Нет соединения" при `supabase.realtime.isConnected() === false`.

### 4. Push-уведомления через Telegram Bot API

Бот уже настроен для авторизации. Можно добавить отправку напоминаний студентам об истечении абонемента (≤ 2 уроков) через `sendMessage` в Bot API из Edge Function — нулевые расходы на инфраструктуру.

### 5. Экспорт данных (CSV/Excel)

CRM без экспорта — неполный инструмент. Добавить кнопку "Экспорт в CSV" для журнала посещений и списка клиентов. На стороне клиента через `Blob` + `URL.createObjectURL`.

---

## 📋 Порядок выполнения промтов

**Всего промтов: 22** (BUG-1…4, SEC-1…3, PERF-1…3, CODE-1…7, DB-1…5).

**Начинаем с BUG-1** — самый безопасный P0-фикс (локальная замена `Date.now()` → `crypto.randomUUID()`, без изменений схемы и API).

Рекомендуемая очередь по фазам (после каждого промта — `npm run lint` и ручная проверка затронутого экрана):

| Фаза | Промты | Зачем так |
|------|--------|-----------|
| P0 — быстрые баги/безопасность | BUG-1 → BUG-2 → BUG-3 → SEC-3 | Минимальный diff, не ломают существующие потоки |
| P1 — функциональность и инфра | BUG-4 → SEC-1 → SEC-2 → DB-1 → DB-3 | Шире по scope; SEC-1 требует секрет ALLOWED_ORIGINS в Supabase |
| P1 — производительность | PERF-1 | Высокий риск регрессии: не фильтровать `usePersonalLessons` там, где нужен полный список |
| P2 — качество и БД | CODE-1…5, DB-4, CODE-3 | Улучшения UX/DX без смены бизнес-логики |
| P3 — по желанию | CODE-6, CODE-7, PERF-2, PERF-3, DB-2, DB-5 | Рефакторинг и архитектурные улучшения |

**Не трогать без явной необходимости:** DB-2 (UNIQUE prices), CODE-6 (большой рефакторинг PersonalLessonsPanel).

---

*Конец ревью. Все промты готовы к прямому использованию в Cursor Chat.*
