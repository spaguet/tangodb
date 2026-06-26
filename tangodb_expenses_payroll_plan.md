# F5 / F6 — Expenses & Payroll — план реализации

> **Статус:** план (Промт 7, 2026-06-26). Код и миграции — **не начинать** до согласования этого документа.  
> **Источник:** `tangodb_modular_dance_crm_TZ.md` §7.3, §7.6, §5; текущий код `tangodb/`.

---

## 1. Контекст и границы

### Что уже есть

| Область | Состояние |
|---------|-----------|
| Выручка | Таблица `payments`, журнал `/finance/payments`, KPI на `FinancialDashboard` (F1–F3 ✅) |
| Module gate | `finance_basic` скрывает `/finance/*`, financial tab, financial CSV |
| RBAC | `owner`/`director`/`accountant` — `finance.read` / `finance.export`; `teacher` — **нет** доступа к finance panel |
| Заглушка payroll | `FinancePayrollPage.tsx` — «coming soon»; nav item в `getFinanceNav` |
| Атрибуция выручки преподавателю | `financeReports.buildTopTeachersByRevenue` — personal → `teacher_member_id`; subscription → teacher из `schedule_slots` / `class_teachers` |
| Экспорт | `DataExportPage` — financial CSV за месяц (payments) |

### Что **не** входит в F5/F6 (§7.5, §3.3)

- Денежный остаток / ledger касса–банк
- Налоги, счета-фактуры, амортизация, прогнозы
- Ручной CRUD operational payments (платежи только из продаж)
- Статусы paid/pending/cancelled для operational payments
- Guardians / pipeline / leads

### Зависимости

```
Этап 1 (finance_basic gate) ✅ → F5 (expenses) → F6 (payroll)
```

F6 **блокируется** продуктовым решением по ставкам (§7.3) — см. §4.

---

## 2. F5 — Expenses (расходы)

### 2.1. Цель

Учёт операционных расходов студии: аренда, коммуналка, маркетинг, зарплаты (как expense category), прочее. После F5 на `FinancialDashboard` можно показывать **прибыль = выручка − расходы** за период (без cash-balance).

### 2.2. Схема БД (черновик для согласования)

```sql
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  category        TEXT NOT NULL CHECK (category IN (
    'rent', 'utilities', 'marketing', 'salary', 'other'
  )),
  description     TEXT,
  expense_date    DATE NOT NULL,
  created_by      UUID REFERENCES organization_members (organization_id, id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE INDEX idx_expenses_org_date ON expenses (organization_id, expense_date DESC);
```

**Расширения относительно черновика ТЗ:**

| Поле | Зачем |
|------|-------|
| `created_by` | Audit: кто внёс расход (accountant/owner) |
| `updated_at` | Редактирование записи |
| CHECK `amount > 0` | Нулевые/отрицательные суммы не допускаются |

**Не добавлять в F5:** `method` (способ оплаты расхода), вложения, recurring — отложить.

### 2.3. Бизнес-правила F5

| Правило | Реализация |
|---------|------------|
| `expense_date` не в будущем | CHECK или trigger: `expense_date <= CURRENT_DATE`; UI — `DatePickerField` с `max=today` |
| Одна валюта org | Сумма в `organization_settings.currency_code`; формат через `formatCurrency` |
| Категория обязательна | Enum + `AppSelect` |
| Удаление | Soft delete **не нужен** — hard delete с confirm; audit через `audit_log` trigger (как payments) |
| `finance_basic: false` | Таблица и RLS остаются; UI `/finance/expenses` скрыт module gate |
| Demo expired / read-only | Блок через `organization_allows_writes()` (как другие business tables) |

### 2.4. RLS (черновик)

| Операция | Роли |
|----------|------|
| SELECT | `owner`, `director`, `accountant` |
| INSERT / UPDATE / DELETE | `owner`, `director`, `accountant` |
| Teacher / admin / reception | **нет доступа** |

Паттерн: `current_organization_id()` + `current_member_role() IN (...)` — как `payments` RLS в `20260630000001_v2_payments_module.sql`.

Tenant consistency trigger: `organization_id` + `created_by` member принадлежит org.

### 2.5. Permissions (клиент)

Новые `PermissionAction` (минимальный набор):

```ts
| "expenses.read"
| "expenses.write"
```

Матрица:

| Роль | expenses.read | expenses.write |
|------|---------------|----------------|
| owner, director | ✅ | ✅ |
| accountant | ✅ | ✅ |
| admin, teacher, reception | ❌ | ❌ |

`canAccessPanel("finance")` — без изменений (teacher по-прежнему не видит finance nav).

### 2.6. UI / маршруты

| Элемент | Детали |
|---------|--------|
| Route | `/finance/expenses` в `FinancePage.tsx` |
| Nav | Добавить в `getFinanceNav` + `FINANCE_NAV_ICONS` (иконка `Receipt` или `CircleDollarSign`) |
| Страница | `FinanceExpensesPage.tsx` — список + фильтры (период, категория) + «Итого» + CRUD modal |
| Паттерн UI | Переиспользовать `FinancePaymentsPage`: `AppSelect`, `DatePickerField`, `LoadingState`, `QueryErrorState` |
| Форма | amount, category, description, expense_date |
| i18n | `finance.expenses.*`, `finance.nav.expenses` в `keys.ts` / `ru.ts` / `en.ts` |

### 2.7. Hooks / lib

```
tangodb/src/hooks/useExpenses.ts     — useExpenses({ dateFrom?, dateTo?, category? }), useCreateExpense, useUpdateExpense, useDeleteExpense
tangodb/src/types/expense.ts         — Expense, ExpenseCategory
tangodb/src/lib/expenseCategories.ts — labels + i18n keys
```

TanStack Query keys: `["expenses", orgId, filterSuffix]`. Invalidation: expenses + financial dashboard aggregates.

### 2.8. FinancialDashboard (после F5)

Новая карточка «Расходы за месяц» + «Прибыль» = `stats.total - expensesTotal`.  
**Не** показывать cash-balance. Подпись: «Выручка − расходы (без учёта кассы/банка)».

### 2.9. CSV export

`DataExportPage` → новая секция «Расходы за месяц» (рядом с financial payments export).  
Доступ: `can("finance.export") && modules.finance_basic`.  
Колонки: date, category, description, amount.

### 2.10. Критерии приёмки F5

- [ ] CRUD расходов owner/accountant; teacher/admin не видят раздел
- [ ] Фильтр период + категория; «Итого» пересчитывается
- [ ] `expense_date` в будущем — ошибка (UI + DB)
- [ ] `finance_basic: false` — `/finance/expenses` недоступен
- [ ] CSV расходов в `DataExportPage` без регрессии payments CSV
- [ ] `npm run lint` в `tangodb/`

---

## 3. F6 — Payroll (зарплаты преподавателей)

### 3.1. Цель

Заменить заглушку `/finance/payroll` учётом начислений и выплат преподавателям за период (месяц). Teacher видит **только свои** начисления/выплаты.

### 3.2. Продуктовое решение по ставкам (обязательно до кода)

**Рекомендация для MVP (зафиксировать в decision_log при согласовании):**

| Вариант | Описание | Плюсы | Минусы |
|---------|----------|-------|--------|
| **A — % от атрибутированной выручки** ✅ рекомендуется | Ставка `%` на teacher в settings; accrued = sum(attributed payments) × rate | Переиспользует `resolvePaymentTeacherId`; минимум новых сущностей | Не покрывает фикс за групповое без оплат |
| B — фикс за занятие | Ставка за personal / group slot | Прост для персональных | Нужен подсчёт проведённых занятий, сложнее для абонементов |
| C — гибрид | % + минимум / фикс per lesson | Гибко | Over-engineering для MVP |

**Выбор A для F6 MVP:**

- Таблица **`teacher_pay_rates`**: `organization_id`, `member_id` (teacher), `rate_percent` (0–100), `effective_from` DATE.
- Одна активная ставка на teacher (последняя по `effective_from`).
- UI настройки ставок: `/settings/team` — поле «% от выручки» для members с role=teacher (owner/director edit).
- Accrual за месяц: для каждого payment в месяце → teacher via `resolvePaymentTeacherId` → `amount × rate_percent / 100`.

**Отложить:** фикс за групповое занятие без payment, надбавки, налоги, больничные.

### 3.3. Схема БД F6 (черновик)

```sql
-- Ставки (настройка)
CREATE TABLE teacher_pay_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  member_id       UUID NOT NULL,
  rate_percent    NUMERIC NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);

-- Период начисления (snapshot / ledger row)
CREATE TABLE teacher_settlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  member_id       UUID NOT NULL,
  period_year     INT NOT NULL,
  period_month    INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount_accrued  NUMERIC NOT NULL DEFAULT 0 CHECK (amount_accrued >= 0),
  amount_paid     NUMERIC NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  -- balance = amount_accrued - amount_paid (computed in app or generated column)
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, member_id, period_year, period_month),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  CHECK (amount_paid <= amount_accrued)
);

-- Частичные выплаты (audit trail)
CREATE TABLE teacher_settlement_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  settlement_id   UUID NOT NULL,
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  paid_at         DATE NOT NULL,
  method          TEXT NOT NULL DEFAULT 'transfer'
    CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  note            TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, settlement_id)
    REFERENCES teacher_settlements (organization_id, id) ON DELETE CASCADE
);
```

**Пересчёт accrued:** RPC `recalculate_teacher_settlement(p_org_id, p_year, p_month)` — идемпотентный, вызывается при открытии payroll UI или по cron (решить при реализации). Пересчёт читает `payments` + `teacher_pay_rates` + attribution logic (дублировать SQL или вызывать через service function).

### 3.4. Бизнес-правила F6

| Правило | Действие |
|---------|----------|
| Частичные выплаты | `teacher_settlement_payments` + increment `amount_paid`; `amount_paid <= amount_accrued` |
| Полная выплата | `amount_paid = amount_accrued`; balance = 0 |
| Пересчёт accrued | При новых payments за месяц — invalidate + recalculate settlement |
| Teacher без ставки | `rate_percent = 0` → accrued = 0; показывать с подсказкой «ставка не задана» |
| Удаление teacher с будущими занятиями | Guard **перед F6** (§7.6): RPC/trigger block deactivate/delete if future `schedule_slots` or `personal_lessons` |
| Teacher read own | RLS: `member_id = current_member_id()` OR role IN (owner, director, accountant) |
| Платёж teacher в будущем | `paid_at <= CURRENT_DATE` |

### 3.5. RLS F6

| Таблица | SELECT | INSERT/UPDATE/DELETE |
|---------|--------|----------------------|
| `teacher_pay_rates` | owner, director, accountant | owner, director |
| `teacher_settlements` | owner, director, accountant; teacher — own row | owner, director, accountant (recalculate); teacher — **read only** |
| `teacher_settlement_payments` | owner, director, accountant; teacher — own settlement | owner, director, accountant |

### 3.6. Permissions (клиент)

```ts
| "payroll.read"        // all settlements (financial roles)
| "payroll.read.own"    // teacher — own settlements only
| "payroll.write"       // record payments, recalculate
| "payroll.rates.manage" // edit teacher_pay_rates
```

**Доступ teacher к `/finance/payroll`:**

Текущий `canAccessPanel("finance")` → false для teacher. Для F6:

1. **Не** открывать весь finance panel teacher.
2. Добавить **исключение route-level**: `/finance/payroll` доступен при `payroll.read.own` + `finance_basic`.
3. Nav для teacher: **не** показывать finance в sidebar; опционально ссылка «Мои выплаты» в `TeacherScopedDashboard` → `/finance/payroll`.
4. `FinanceLayout`: для teacher скрыть sub-nav payments/revenue/debtors; показывать только payroll content.

Альтернатива (отклонена для MVP): отдельный route `/my-payroll` вне finance — дублирует layout.

### 3.7. UI — замена заглушки

| Роль | UI `/finance/payroll` |
|------|----------------------|
| owner / director / accountant | Таблица teachers × месяц: accrued, paid, balance; drill-down → partial payments; кнопка «Записать выплату»; фильтр период |
| teacher | Карточки своих settlements за последние 12 мес.; balance; **без** кнопок write |

Settings: в `TeamSettingsPage` / `MemberProfileModal` — поле `rate_percent` для teacher.

Удалить тексты `finance.payroll.comingSoon`; заменить рабочим UI.

### 3.8. Hooks / lib

```
tangodb/src/hooks/usePayroll.ts
tangodb/src/lib/payrollAccrual.ts   — client-side preview OR wrapper for RPC
tangodb/src/types/payroll.ts
```

Переиспользовать `buildTopTeachersByRevenue` / `resolvePaymentTeacherId` для client-side preview; authoritative accrued — RPC.

### 3.9. Критерии приёмки F6

- [ ] Owner/accountant видят все settlements; записывают частичные/полные выплаты
- [ ] Teacher видит только свои строки на `/finance/payroll`
- [ ] Accrued пересчитывается при изменении payments / rate
- [ ] `amount_paid > amount_accrued` — ошибка
- [ ] Guard: нельзя удалить/deactivate teacher с future lessons
- [ ] Заглушка `comingSoon` удалена
- [ ] i18n ru/en для payroll UI
- [ ] `npm run lint`

---

## 4. Порядок реализации (после согласования плана)

| Шаг | Scope | Промт (будущий) |
|-----|-------|-----------------|
| 1 | Migration F5: `expenses` + RLS + audit trigger | новый промт «F5 implement» |
| 2 | `useExpenses` + `FinanceExpensesPage` + nav + i18n | |
| 3 | FinancialDashboard profit card + DataExportPage CSV | |
| 4 | Migration F6: rates + settlements + payments + RLS + recalculate RPC | новый промт «F6 implement» |
| 5 | Teacher rate UI in team settings | |
| 6 | Replace `FinancePayrollPage` + teacher route exception + guard teacher delete | |
| 7 | Permissions tests in `permissions.ts` self-check block | |

**Один промт на подэтап** — не смешивать F5 и F6 в одном запросе.

---

## 5. Файлы для изменения (чеклист)

### F5

- `tangodb/supabase/migrations/YYYYMMDD_v2_expenses.sql`
- `tangodb/src/hooks/useExpenses.ts`
- `tangodb/src/pages/FinanceExpensesPage.tsx`
- `tangodb/src/pages/FinancePage.tsx`
- `tangodb/src/pages/FinanceLayout.tsx`
- `tangodb/src/lib/i18n/navHelpers.ts`, `keys.ts`, `ru.ts`, `en.ts`
- `tangodb/src/lib/permissions.ts`
- `tangodb/src/components/FinancialDashboard.tsx`
- `tangodb/src/settings/pages/DataExportPage.tsx`

### F6

- `tangodb/supabase/migrations/YYYYMMDD_v2_teacher_payroll.sql`
- `tangodb/src/hooks/usePayroll.ts`
- `tangodb/src/pages/FinancePayrollPage.tsx` (replace stub)
- `tangodb/src/settings/TeamSettingsPage.tsx` or `MemberProfileModal.tsx`
- `tangodb/src/lib/permissions.ts`, `routeGuards.tsx` (payroll route for teacher)
- `tangodb/src/components/TeacherScopedDashboard.tsx` (optional link)
- `tangodb/src/lib/financeReports.ts` (shared attribution)

---

## 6. Открытые вопросы (решить перед F6 migration)

1. **Подтвердить вариант A** (% от атрибутированной выручки) или выбрать B/C.
2. **Recalculate trigger:** on-demand при открытии UI vs nightly job — для MVP достаточно on-demand + invalidation after payment.
3. **Категория `salary` в expenses vs payroll:** расход «salary» в F5 — для non-teacher costs; выплаты teacher — только через F6 settlements (не дублировать в expenses автоматически).
4. **Subscription attribution:** при нескольких teachers в группе — делить выручку поровну или 100% primary teacher? **Рекомендация:** как сейчас в F3 — первый teacher из schedule; документировать.

---

## 7. Связь с §7.3 ТЗ

| # | Scope | Миграция | Статус плана |
|---|-------|----------|--------------|
| F5 | `expenses` + `/finance/expenses` | Да | ✅ описано §2 |
| F6 | `teacher_settlements` + `/finance/payroll` | Да | ✅ описано §3 |

Прибыль и payroll CSV для accountant — после F5/F6 respectively, согласно §5 (accountant = чтение + экспорт).
