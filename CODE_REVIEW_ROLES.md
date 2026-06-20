# TangoDB — Regression QA: RBAC Roles (§10)

> **Дата аудита:** 2026-06-20 (ревизия сверки с кодом — 2026-06-20, pass 2)  
> **Источник ТЗ:** `tangodb_roles_rbac_TZ.md` v1.2 — §4, §5, §8, §10  
> **Метод:** статический аудит кода и SQL-миграций (без правок кода, без E2E на prod)  
> **Область:** `tangodb/src/lib/permissions.ts`, `usePermissions.ts`, `App.tsx`, `routeGuards.tsx`, `SettingsLayout.tsx`, `SettingsIndexRedirect.tsx`, `DashboardPage.tsx`, `DataExportPage.tsx`, миграции R1–R6  
> **Контекст:** по `changelog.md` фазы R1–R6 в основном реализованы (2026-06-20); отчёт фиксирует оставшиеся расхождения с ТЗ, а не отсутствие фаз целиком.

---

## Что сделано в этой сессии

| Действие | Статус |
|----------|--------|
| Прочитан `tangodb_roles_rbac_TZ.md` (промпт Regression QA §10) | ✅ |
| Сверены nav-пункты (`App.tsx` + `canAccessPanel`) для 5 ролей | ✅ |
| Сверена матрица `can()` с §8 | ✅ |
| Проверены SQL: `inviter_can_assign_role`, `can_read_operational`, `can_read_financial`, `can_export_data` | ✅ |
| Проверены route guards, settings sections, dashboard split | ✅ (ревизия: panel guards OK, settings guards — partial) |
| Выявлен RBAC-7 (spinner на `/`) | ✅ |
| Выявлен RBAC-8 (SQL export overrides расходятся с UI §9) | ✅ |
| **Этап 0: NAV-1, NAV-2, RBAC-6 — решения приняты и реализованы** | ✅ 2026-06-20 |
| Исправление кода (P1/P2 bundle) | ⬜ следующий этап |
| Деплой / коммит / пуш | ✅ коммит f09bf3f; push — вручную (main protected) |

**Допущения аудита:**
- teacher — с непустым scope (`all_disciplines`, `can_view_all_clients`);
- org-флаги §9 — значения по умолчанию (`false`, кроме `teachers_can_view_full_schedule = true`);
- миграции R2–R6 применены на целевой БД (runtime не проверялся);
- role-overrides §9 (`teachers_can_*`, `admin_can_*`) частично реализованы в UI, но не полностью синхронизированы с SQL helpers;
- флаги §9.1 (`module_finance_enabled` и др.) в коде **ещё не реализованы** — в отчёт не включены.

**Расхождение внутри ТЗ (закрыто NAV-2):** §4 и §5.4 — operational reports ❌ для teacher; §6.1 gap-table и §8 — `reports.operational` включает teacher*. **Решение:** scoped home через `dashboard.scoped_summary`, не CRM-дашборд.

---

## Общий вердикт

| Область | Pass | Fail / Partial |
|---------|------|----------------|
| Nav (5 ролей) | 4 | 1 (accountant + prices; teacher + dashboard) |
| `permissions.ts` vs §8 | ~28/31 actions | 3 (teacher reports; admin disciplines.write; accountant `/prices` panel) |
| SQL helpers (§8/§9) | 3/4 | 1 (`can_export_data` не учитывает org overrides) |
| §10.2 Security (код+RLS) | 7/10 | 3 (settings guards; dashboard fallback; export helper overrides; RLS reception — ✅) |
| §10.3 UI | 2/5 | 3 (nav partial; dashboard spinner; settings guards; export page для accountant) |

**Итог:** RBAC R1–R6 в целом внедрены, но не полностью согласованы с ТЗ на уровне связки UI guards ↔ SQL helpers. Основные security/UX-пробелы: split dashboard owner/director (RBAC-1), неполные `PermissionOptions` в **settings** guards (RBAC-2), бесконечный спиннер на `/` без dashboard (RBAC-7), рассинхрон export overrides между `permissions.ts` и SQL `can_export_data()` (RBAC-8).

---

## 1. Nav-пункты: ожидание vs код

Фильтрация: `App.tsx` → `NAV_SECTIONS` → `canAccessPanel(panelIdFromPath(path))` через `usePermissions`.

| Роль | Ожидаемые пункты (§4–§5) | Фактически в коде | Статус |
|------|--------------------------|-------------------|--------|
| **owner** | Все панели + все settings | Обзор, Финансы, Клиенты, Абонементы, Продажа абон., Расписание, Журнал, Персональные, Продажа перс., Тарифы, Настройки | ✅ PASS |
| **director** | Как owner, без activate license | То же | ✅ PASS |
| **admin** | CRM без Финансов и Settings | **9** пунктов: всё кроме «Финансы» и «Настройки CRM» | ✅ PASS |
| **teacher** (scope) | Scope-панели; без продажи групп. абон., тарифов, settings | Обзор (scoped home), Клиенты, Абонементы, Расписание, Журнал, Персональные, Продажа перс. | ✅ PASS *(NAV-2)* |
| **teacher** (пустой scope) | Почти ничего | Nav пуст | ✅ PASS |
| **accountant** | Dashboard (фин.), Финансы, экспорт; без CRM | Обзор, **Финансы**, **Настройки** (внутри — только «Данные») | ✅ PASS *(NAV-1: `/prices` скрыт)* |

### ⚠️ Места для решения (nav) — **Этап 0: решено**

| ID | Вопрос | Варианты | Решение | Статус |
|----|--------|----------|---------|--------|
| **NAV-1** | Показывать ли accountant пункт «Тарифы» в главном nav? | A) Оставить `/prices` · B) Скрыть nav, оставить read в `/finance` · C) Inline-справочник в finance | **B** — меньше CRM-adjacent UI | ✅ Реализовано |
| **NAV-2** | Показывать ли teacher пункт «Обзор» с operational-виджетами? | A) Скрыть nav «Обзор» · B) Пустой/минимальный home · C) Scoped summary без CRM-агрегатов | **C** — teacher нужен home, но не полный OperationalDashboard | ✅ Реализовано |

**NAV-1 — исправление:** `permissions.ts` → `canAccessPanel("prices")` возвращает `false` для `accountant`; `prices.read` сохранён для finance-хуков. Regression: `assertReceptionPermissions()` в dev.

**NAV-2 — исправление:**
- Новый action `dashboard.scoped_summary` (teacher + непустой scope).
- Teacher убран из `reports.operational` (§4/§5.4).
- Компонент `TeacherScopedDashboard.tsx`: быстрые ссылки, расписание на сегодня, ближайшие персональные уроки — **без** CRM-агрегатов (должники, counts, revenue).
- `DashboardPage.tsx`: teacher → `TeacherScopedDashboard`.

---

## 2. Матрица `permissions.ts` vs §8

| Action | owner | director | admin | teacher* | accountant | SQL helper | UI↔SQL |
|--------|:-----:|:--------:|:-----:|:--------:|:----------:|------------|--------|
| `clients.read` | ✅ | ✅ | ✅ | ✅ | ❌ | operational / scope | ✅ |
| `clients.write` | ✅ | ✅ | ✅ | ❌† | ❌ | write + policy | ✅ |
| `subscriptions.read` | ✅ | ✅ | ✅ | ✅ | ❌ | operational / scope | ✅ |
| `subscriptions.sell/write` | ✅ | ✅ | ✅ | ❌† | ❌ | `can_write_all_business()` | ⚠️ RLS‡ |
| `attendance.write` | ✅ | ✅ | ✅ | ✅ | ❌ | scope + admin | ✅ |
| `schedule.read/write` | ✅ | ✅ | ✅ | 👁/❌§ | ❌ | operational / scope | ✅ |
| `personal_lessons.sell` | ✅ | ✅ | ✅ | ✅ | ❌ | scope | ✅ |
| `payments.write` | ✅ | ✅ | ✅ | ❌¶ | ❌ | RPC для teacher | ⚠️ UI через `personal_lessons.write` |
| `payments.read.operational` | ✅ | ✅ | ✅ | ❌ | ❌ | operational | ✅ |
| `prices.read` | ✅ | ✅ | ✅ | ❌ | ✅ | `can_read_prices()` | ✅ |
| `prices.write` | ✅ | ✅ | ❌ | ❌ | ❌ | `can_manage_prices()` | ✅ |
| `finance.read/export` | ✅ | ✅ | ❌ | ❌ | ✅ | financial | ✅ |
| `reports.operational` | ✅ | ✅ | ✅ | ❌§§ | ❌ | operational / scope | ✅ vs §4 |
| `reports.financial` | ✅ | ✅ | ❌ | ❌ | ✅ | financial | ✅ |
| `dashboard.export` | ✅ | ✅ | ❌/flag | ❌† | ✅ | `can_export_data()` / `can_export_financial()` | ⚠️ SQL ignores §9 flags |
| `settings.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | `can_manage_settings()` | ✅ |
| `team.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | `can_manage_team()` | ✅ |
| `license.view` | ✅ | ✅ | ❌ | ❌ | ❌ | role check | ✅ |
| `license.activate` | ✅ | ❌ | ❌ | ❌ | ❌ | owner only | ✅ |

\* teacher с валидным scope  
† override §9: `teachers_can_edit_clients`, `teachers_can_sell_subscriptions`, `teachers_can_export`  
§ `schedule.read` = true при `teachers_can_view_full_schedule` (default `true`)  
§§ teacher: `reports.operational` = false; home через `dashboard.scoped_summary` (NAV-2)
¶ teacher: `can("payments.write")` = false; кнопка оплаты в `PersonalLessonsPanel` открыта через `can("personal_lessons.write")`, запись — RPC `record_personal_lesson_payment`  
‡ RLS: политики `subscriptions_insert/update/delete_teacher` не проверяют `teachers_can_sell_subscriptions` — REST может обойти UI при override §9

### Settings-секции (`canAccessSettingsSection`)

| Секция | owner | director | admin | teacher† | accountant |
|--------|:-----:|:--------:|:-----:|:--------:|:----------:|
| general, organization, subscriptions, locations | ✅ | ✅ | ❌ | ❌ | ❌ |
| disciplines | ✅ | ✅ | ❌ | ⚠️ flag | ❌ |
| data (export) | ✅ | ✅ | ❌ | ❌ | ✅ |
| team | ✅ | ✅ | ❌ | ❌ | ❌ |
| license | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 3. SQL: ключевые функции

### `inviter_can_assign_role` — `20260629000001_v2_rbac_roles_refinement.sql`

```sql
WHEN p_target_role IN ('owner', 'director') THEN false
WHEN p_inviter_role IN ('owner', 'director') THEN p_target_role IN ('admin', 'teacher', 'accountant')
ELSE false
```

| Сценарий | Ожидание §10.2 | Статус |
|----------|----------------|--------|
| admin → invite | ❌ | ✅ PASS |
| admin → self-promote to director | ❌ | ✅ PASS |
| owner/director → invite admin/teacher/accountant | ✅ | ✅ PASS |

Edge Function `invite-member`: `ASSIGNABLE_ROLES = {admin, teacher, accountant}` + RPC — согласовано.

### `can_read_operational()` → owner, director, admin

Accountant: SELECT на CRM-таблицы → 0 rows. **✅ PASS**

### `can_read_financial()` → owner, director, accountant

Admin не видит `/finance`. **✅ PASS**

### `can_export_data()` → owner, director, accountant (+ overrides)

UI: `permissions.ts` включает export для owner/director/accountant, admin только при `admin_can_export=true`, teacher только при `teachers_can_export=true` и scope.  
SQL: `20260629000001_v2_rbac_roles_refinement.sql` оставляет teacher export при любом непустом scope и не учитывает `admin_can_export`. **⚠️ PARTIAL / mismatch с §9.**

### Прочие проверки §10.2

| Проверка | Статус | Где |
|----------|--------|-----|
| `mark_attendance` для accountant → error | ✅ PASS | `20260628000004_mark_attendance_discipline_guard.sql:70–72` |
| JWT `member_role` ≠ Postgres `role` | ✅ PASS | `20260627000002_v2_jwt_member_role_claim.sql` |
| Смена org → `refreshSession()` | ✅ PASS | `OrganizationProvider.setActiveOrganization` |
| Teacher чужой subscription по UUID | ✅ PASS | `teacher_can_access_subscription()` |
| Teacher без `price_id`/`paid` | ✅ PASS* | R4 views + hooks |
| Restricted admin: panel URL `/clients`, `/schedule` | ✅ PASS | `PanelAccessRoute` → `usePermissions().canAccessPanel` (полные options + `restrictedAdmin`) |
| Restricted admin: settings guards + org overrides | ⚠️ PARTIAL | `routeGuards.tsx`, `SettingsIndexRedirect.tsx` — см. RBAC-2 |
| Роли без dashboard → URL `/` | ❌ FAIL | `routeGuards.tsx:117–119` — бесконечный спиннер; см. RBAC-7 |
| Export override §9: `teachers_can_export=false` / `admin_can_export=true` | ⚠️ PARTIAL | UI учитывает flags; SQL `can_export_data()` — нет; см. RBAC-8 |

\* при применённой миграции R4 на целевой БД

---

## 4. Чеклист §10 — pass/fail

### §10.1 Роли

| # | Критерий | Статус |
|---|----------|--------|
| 1 | owner: полный доступ, activate license | ✅ PASS |
| 2 | director: без activate, с team + settings | ✅ PASS |
| 3 | admin: CRM write, prices.read, без settings/team/prices.write/export | ✅ PASS |
| 4 | teacher: scope; masking; attendance OK; personal_lessons.sell OK | ⚠️ PARTIAL |
| 5 | accountant: finance routes; REST clients → 0 rows | ✅ PASS |

### §10.2 Безопасность

| # | Критерий | Статус |
|---|----------|--------|
| 1 | JWT member_role regression | ✅ PASS (код) |
| 2 | Смена org → refresh → права | ✅ PASS (код) |
| 3 | admin не повышает себя до director | ✅ PASS |
| 4 | admin не invite через RPC | ✅ PASS |
| 5 | teacher не читает чужой subscription | ✅ PASS |
| 6 | teacher не получает price_id/paid | ✅ PASS* |
| 7 | accountant не mark_attendance | ✅ PASS |
| 8 | restricted admin не обходит panel guards по URL | ✅ PASS (hook) |
| 9 | settings guards учитывают org overrides и те же options, что nav | ⚠️ PARTIAL |
| 10 | роли без dashboard не зависают на `/` | ❌ FAIL |
| 11 | `can_export_data()` синхронизирован с §9 overrides | ⚠️ PARTIAL |

### §10.3 UI

| # | Критерий | Статус |
|---|----------|--------|
| 1 | Nav скрывает запрещённое | ⚠️ PARTIAL (accountant `/prices`; teacher `/` с CRM-виджетами) |
| 2 | admin `/settings/team` → redirect | ✅ PASS |
| 3 | accountant: `/settings/data` ✅, `/settings/general` ❌ | ✅ PASS |
| 4 | ReadOnlyBanner + RBAC | ✅ PASS |
| 5 | Прямой URL `/` для teacher (пустой scope) / reception admin — не спиннер | ❌ FAIL |
| 6 | Accountant `/settings/data` показывает финансовый экспорт, а не operational CSV | ⚠️ PARTIAL |

---

## 5. Баги и места для изменений

---

### 🔴 RBAC-1 [P1] — Owner/director видят только Financial Dashboard

**Файл:** `tangodb/src/pages/DashboardPage.tsx`

```typescript
const showFinancial = can("reports.financial");
const showOperational = can("reports.operational") && !showFinancial;
// ...
if (showFinancial) {
  return <FinancialDashboard />;
}
return <OperationalDashboard ... />;
```

**Проблема (два уровня):**
1. У owner/director оба флага `true` → `showOperational = false` → operational-виджеты (§5.3) не загружаются.
2. Даже при исправлении п.1 рендер **if/else**: при `showFinancial === true` operational-компонент **никогда** не показывается — нужен tabs/stack или role-based split (R5 в changelog заявлен, но логика split не завершена).

**Место для решения:**

| Вариант | Описание | Плюсы | Минусы |
|---------|----------|-------|--------|
| **A** | Tabs «Операционный» / «Финансовый» для owner/director | Явное разделение | Доп. UI |
| **B** | Stack: OperationalDashboard сверху, FinancialDashboard снизу | Всё на одном экране | Длинная страница |
| **C** | Role-based split; убрать `&& !showFinancial`; заменить exclusive if/else | Минимальный diff | Нужен комбинированный layout |

**Рекомендация:** вариант **C** + tabs или stack для owner/director (не оставлять exclusive if/else).

**Prompt для исправления:**

```
Задача: исправить RBAC-1 из CODE_REVIEW_ROLES.md.

Файл: tangodb/src/pages/DashboardPage.tsx

Сейчас owner/director не видят OperationalDashboard: (1) showOperational = reports.operational && !showFinancial; (2) exclusive if (showFinancial) return FinancialDashboard.

Целевое поведение (tangodb_roles_rbac_TZ.md §5.1, §5.3, R5):
- owner, director: OperationalDashboard + FinancialDashboard (tabs или stack — на выбор, см. вариант C в CODE_REVIEW_ROLES.md)
- admin: только OperationalDashboard
- accountant: только FinancialDashboard
- teacher: scoped summary или пустой home (согласовать с NAV-2)

Не ломай lazy-loading запросов (enabled только для нужного dashboard).
Обнови changelog.md.
```

---

### 🔴 RBAC-2 [P1] — Неполные `PermissionOptions` в settings guards

**Файлы:**
- `tangodb/src/auth/routeGuards.tsx` (`PanelAccessRoute` — только блок settings)
- `tangodb/src/settings/SettingsIndexRedirect.tsx`

**Уже корректно (не дублировать баг):**
- `PanelAccessRoute` для **панелей** вызывает `canAccessPanel(panel)` из `usePermissions()` — полный набор options, включая `restrictedAdmin` из `membership.meta`. Restricted reception admin **не** открывает `/clients` и `/schedule` по URL.
- `SettingsLayout.tsx` уже использует `permissionOptionsFromSettings()` — эталон.
- RLS R6: `can_read_operational()` / `can_write_all_business()` исключают `is_restricted_admin()` — REST-слой согласован.

```typescript
// routeGuards.tsx — локальный options только для canAccessSettingsSection
const options = {
  scope,
  teachersCanManageDisciplines: settings?.teachers_can_manage_disciplines ?? false,
  isReadOnly,
};
// PanelAccessRoute: canAccessPanel(panel) — из hook, полные options ✅
```

**Проблема:** `canAccessSettingsSection` в guards и redirect получает **неполный** `PermissionOptions` — нет `restrictedAdmin`, `adminCanExport`, `adminCanManageTeam`, `teachersCanSellSubscriptions`, `teachersCanEditClients`, `teachersCanViewFullSchedule`. Эффекты:
- admin с `admin_can_export=true` / `admin_can_manage_team=true`: пункт есть в `SettingsLayout`, но прямой URL `/settings/data` или `/settings/team` может редиректить (guard видит default `false`);
- teacher/reception flags в settings-guards расходятся с nav.

**Место для решения:**

| Вариант | Описание |
|---------|----------|
| **A** | Переиспользовать `permissionOptionsFromSettings(settings, scope, { restrictedAdmin, isReadOnly })` — helper **уже есть** в `permissions.ts` |
| **B** | Дублировать логику `usePermissions` в guards (не рекомендуется) |

**Рекомендация:** вариант **A** — один источник правды; подключить `membership?.meta?.restricted_admin` как в `usePermissions.ts`.

**Prompt для исправления:**

```
Задача: исправить RBAC-2 из CODE_REVIEW_ROLES.md.

1. В routeGuards.tsx и SettingsIndexRedirect.tsx замени ручную сборку options на permissionOptionsFromSettings(settings, scope, { restrictedAdmin: membership?.meta?.restricted_admin ?? false, isReadOnly }) — как в usePermissions.ts / SettingsLayout.tsx.
2. Не меняй panel guard: canAccessPanel из hook уже корректен.
3. Regression: admin + admin_can_export=true → /settings/data открывается; restricted admin → /clients redirect; full admin → /clients OK.
4. Подключи assertReceptionPermissions() при старте dev (сейчас функция есть, но нигде не вызывается).

Обнови changelog.md и lessons.md (причина: settings guards не синхронизированы с SettingsLayout).
```

---

### 🟠 RBAC-3 [P2] — Teacher: RLS write на subscriptions при запрете UI

**Файл:** `tangodb/supabase/migrations/20260623000001_v2_business_rls.sql`

Политики `subscriptions_insert_teacher`, `subscriptions_update_teacher`, `subscriptions_delete_teacher` **не сняты** в R2/R4. UI блокирует `subscriptions.sell`, REST может обойти (особенно при `teachers_can_sell_subscriptions=true`).

**Место для решения:**

| Вариант | Описание |
|---------|----------|
| **A** | Новая миграция: DROP teacher write policies; write только через `can_write_all_business()` |
| **B** | SQL helper `teacher_can_write_subscriptions()` читает `organization_settings.teachers_can_sell_subscriptions` |
| **C** | Оставить policies, но UI-only (не рекомендуется — нарушает §10.2) |

**Рекомендация:** вариант **B** — defense in depth + org override §9.

**Prompt для исправления:**

```
Задача: исправить RBAC-3 из CODE_REVIEW_ROLES.md — teacher REST write subscriptions.

Новая migration (дата YYYYMMDD_v2_teacher_subscriptions_write_guard.sql):

1. CREATE FUNCTION teacher_can_write_subscriptions() — true только если teachers_can_sell_subscriptions из organization_settings AND teacher scope.
2. Перепиши subscriptions_insert/update/delete_teacher policies: добавь teacher_can_write_subscriptions().
3. По умолчанию (flag false) teacher INSERT/UPDATE/DELETE subscriptions → denied.
4. При teachers_can_sell_subscriptions=true — разрешить в scope (как сейчас).

Не трогай owner/director/admin policies. RLS-only, без изменения permissions.ts (UI уже согласован).

Обнови changelog.md. Regression §10.2: teacher REST POST subscriptions → 403 без override.
```

---

### 🟠 RBAC-4 [P2] — Teacher видит Operational Dashboard — **частично закрыто NAV-2 ✅**

**Файл:** `tangodb/src/lib/permissions.ts` + `DashboardPage.tsx`

`reports.operational` = true для teacher с scope → полный OperationalDashboard на `/`. **Продуктовое ТЗ §4/§5.4:** operational reports ❌ для teacher. **§8/§6.1 gap-table** допускает teacher* — трактовать как scoped queries, не CRM-дашборд.

**Этап 0 (NAV-2):** teacher убран из `reports.operational`; добавлен `dashboard.scoped_summary` + `TeacherScopedDashboard`. Полный RBAC-4 prompt ниже — для финальной полировки layout (design_system).

**Место для решения:**

| Вариант | Описание |
|---------|----------|
| **A** | Убрать `reports.operational` для teacher → `dashboard.read` = false |
| **B** | Новый action `dashboard.scoped_summary` — минимальный home без CRM-агрегатов |
| **C** | Следовать §8 буквально (teacher в operational) | — | Противоречит §4/§5.4 и NAV-2 |

**Решение:** **B** — реализовано в Этапе 0.

**Prompt для исправления:**

```
Задача: RBAC-4 из CODE_REVIEW_ROLES.md — teacher dashboard.

1. Решение NAV-2 / RBAC-4: убери teacher из reports.operational (или ограничь canAccessPanel dashboard для teacher).
2. Создай TeacherHomePage / ScopedDashboard: ближайшие занятия, быстрые ссылки на attendance/personal — без агрегатов CRM (clients count, debtors, revenue).
3. DashboardPage: teacher → ScopedDashboard; admin → Operational; accountant → Financial; owner/director → оба (после RBAC-1).

Согласуй с tangodb_roles_rbac_TZ.md §5.4. Обнови design_system.md если новый layout-паттерн.
```

---

### 🟠 RBAC-7 [P2] — Бесконечный спиннер на `/` без dashboard

**Файл:** `tangodb/src/auth/routeGuards.tsx`

```typescript
if (!canAccessPanel(panel)) {
  if (panel === "dashboard") {
    return <LoadingScreen label="Загрузка доступа..." />;
  }
  return <Navigate to="/" replace />;
}
```

**Проблема:** teacher с пустым scope и reception admin (`restricted_admin`) не имеют `dashboard.read`, но редирект с других панелей ведёт на `/`, где guard показывает **бесконечный** `LoadingScreen` вместо redirect на первую доступную панель или empty state.

**Рекомендация:** если `panel === "dashboard"` и нет доступа — `Navigate` на первую доступную панель (attendance/subscriptions для reception) или страницу «Нет доступа»; не использовать loading как заглушку.

**Prompt:**

```
Задача: RBAC-7 из CODE_REVIEW_ROLES.md.

В PanelAccessRoute: при !canAccessPanel("dashboard") редирект на первую доступную панель по canAccessPanel (или /attendance для reception admin), не LoadingScreen.

Regression: teacher empty scope, reception admin — нет зависания на /.
Обнови changelog.md.
```

---

### 🟠 RBAC-8 [P2] — Export overrides §9 не синхронизированы между UI и SQL

**Файлы:**
- `tangodb/src/lib/permissions.ts`
- `tangodb/src/settings/pages/DataExportPage.tsx`
- `tangodb/supabase/migrations/20260629000001_v2_rbac_roles_refinement.sql`
- `tangodb/supabase/migrations/20260704000001_v2_rbac_org_setting_overrides.sql`

**Факт в UI:** `dashboard.export` зависит от `admin_can_export` и `teachers_can_export`; `finance.export` доступен owner/director/accountant.

**Факт в SQL:** `can_export_data()` в R2:
- разрешает teacher export при любом непустом scope, даже если `teachers_can_export=false` (default);
- не даёт admin export при `admin_can_export=true`;
- не читает `organization_settings` после добавления колонок §9.

**Доп. UX-проблема:** `DataExportPage` доступна accountant через `finance.export`, но грузит operational hooks (`useClientDirectory`, `useSubscriptions`, `useAttendanceRecords`) и готовит старую dashboard CSV-выгрузку. По RLS accountant получит пустые CRM-наборы, а не полноценный финансовый экспорт.

**Место для решения:**

| Вариант | Описание |
|---------|----------|
| **A** | Переписать `can_export_data()` так, чтобы он читал `organization_settings` и повторял `permissions.ts` для `dashboard.export` |
| **B** | Разделить SQL helpers: `can_export_dashboard_data()` и `can_export_financial()`; accountant export вести через financial views/hooks |

**Рекомендация:** вариант **B** — не смешивать operational dashboard export и financial export.

**Prompt:**

```
Задача: RBAC-8 из CODE_REVIEW_ROLES.md — синхронизировать export permissions.

1. Новая migration:
   - обнови can_export_data(): owner/director всегда; admin только при organization_settings.admin_can_export=true; teacher только при teachers_can_export=true и scope.
   - can_export_financial() оставить owner/director/accountant.
2. DataExportPage:
   - если role=accountant, не грузить operational hooks и не показывать CRM-наборы;
   - добавить financial export или redirect на /finance/* export-кнопки.
3. Regression:
   - teacher + teachers_can_export=false → no export;
   - teacher + true + scope → scoped export;
   - admin + admin_can_export=true → /settings/data доступен и SQL helper true;
   - accountant → financial export без CRM CSV.

Обнови changelog.md и architecture.md (export split).
```

---

### 🟡 RBAC-5 [P2] — Accountant: пункт «Тарифы» в главном nav — **объединено с NAV-1 ✅**

**Файл:** `tangodb/src/App.tsx` + `permissions.ts` (`canAccessPanel` для `prices`)

`prices.read` = true для accountant → nav показывает `/prices`. §5.5 допускает read для расшифровки сумм, но отдельная CRM-панель может быть избыточной.

**Место для решения:** см. **NAV-1** — скрыть panel `prices` для accountant в `canAccessPanel`, оставить `prices.read` для finance-хуков.

**Статус:** ✅ реализовано в Этапе 0 (NAV-1).

---

### 🟡 RBAC-6 [P3] — `disciplines.write` для admin — **Этап 0: решено**

**Файл:** `tangodb/src/lib/permissions.ts:352–354`

Admin может `disciplines.write` вне settings. §5.3 не запрещает явно, но может расходиться с «только операционка без стратегии».

**Решение (Этап 0):** **убрать** `disciplines.write` у admin.

**Обоснование:** §4 строка 156 — «Локации / направления» только через `/settings/*` (owner/director). `DisciplinesPanel` доступен только в `DisciplinesSettingsPage` (закрыт `settings.manage`). Admin сохраняет `disciplines.read` для контекста продаж.

**Исправление:** удалена ветка `if (role === "admin") return true` в `case "disciplines.write"`. Regression: `assertReceptionPermissions()` в dev.

**Prompt (если решено убрать):** — выполнено.

---

## 6. Рекомендуемый порядок исправлений

```
Этап 0 — Согласование (30 мин)
  └─ NAV-1, NAV-2, RBAC-6 (disciplines.write для admin)

Этап 1 — P1 Security + UX (1–2 дня)
  ├─ RBAC-2: permissionOptionsFromSettings в settings guards
  ├─ RBAC-1: dashboard split owner/director (убрать if/else)
  └─ RBAC-7: redirect вместо spinner на /

Этап 2 — P2 RLS + Teacher (1–2 дня)
  ├─ RBAC-8: export helpers + accountant financial export
  ├─ RBAC-3: teacher subscriptions write guard (migration)
  ├─ RBAC-4: teacher scoped home
  └─ RBAC-5: accountant prices nav

Этап 3 — Regression re-run (0.5 дня)
  └─ Промпт §10 повторно + E2E smoke на staging
```

---

## 7. Промпты по фазам RBAC (для следующих спринтов)

### Промпт — Regression QA re-run (§10)

```
Задача: повторный Regression QA после исправлений RBAC-1..RBAC-5 и RBAC-8.

Пройди чеклист tangodb_roles_rbac_TZ.md §10.
Сверь с CODE_REVIEW_ROLES.md — все P1/P2 должны стать PASS.
Для каждой роли: nav expected vs actual, can() vs §8, SQL helpers.
E2E на staging: RBAC-1 dashboard split, RBAC-2 admin_can_export /settings/data, RBAC-7 no spinner on /, RBAC-8 teacher/admin export flags, accountant financial export без CRM CSV, accountant clients REST=0, reception /clients redirect.
Язык: русский. Результат — обновление секции «Статус исправлений» в CODE_REVIEW_ROLES.md.
```

### Промпт — RBAC-1 + RBAC-2 (bundle P1)

```
Задача: исправить P1 из CODE_REVIEW_ROLES.md (RBAC-1, RBAC-2, RBAC-7).

RBAC-1: DashboardPage — owner/director видят operational + financial; admin — operational; accountant — financial; убрать exclusive if/else.
RBAC-2: permissionOptionsFromSettings в routeGuards (settings) и SettingsIndexRedirect; panel guard через hook не трогать.
RBAC-7: PanelAccessRoute — нет бесконечного LoadingScreen на / без dashboard.read.

Файлы: DashboardPage.tsx, routeGuards.tsx, SettingsIndexRedirect.tsx, permissions.ts (assertReceptionPermissions в dev).
Обнови changelog.md, lessons.md.
```

### Промпт — RBAC-3 migration (RLS teacher subscriptions)

```
Задача: RBAC-3 из CODE_REVIEW_ROLES.md.

Миграция: teacher_can_write_subscriptions() + переписать subscriptions_*_teacher policies.
Default deny write; allow только при teachers_can_sell_subscriptions=true и scope.

Не меняй UI. Regression §10.2 item 6.
Обнови changelog.md.
```

### Промпт — RBAC-8 export sync

```
Задача: RBAC-8 из CODE_REVIEW_ROLES.md.

Синхронизируй export permissions:
- SQL can_export_data(): owner/director; admin только при admin_can_export=true; teacher только при teachers_can_export=true и scope.
- can_export_financial(): owner/director/accountant.
- DataExportPage: accountant не должен грузить operational CRM hooks; нужен financial export flow или redirect на finance exports.

Regression: teacher default no export; admin_can_export=true открывает /settings/data и SQL helper true; accountant получает финансовую выгрузку без CRM CSV.
Обнови changelog.md и architecture.md.
```

### Промпт — RBAC-4 + RBAC-5 (teacher home + accountant nav)

```
Задача: RBAC-4 и RBAC-5 из CODE_REVIEW_ROLES.md.

RBAC-4: ScopedDashboard для teacher без CRM-агрегатов.
RBAC-5: скрыть /prices nav для accountant, prices.read сохранить.

Обнови design_system.md если новый teacher home layout.
Обнови changelog.md.
```

---

## 8. Статус исправлений (обновлять после каждого спринта)

| ID | Приоритет | Описание | Статус | PR / commit |
|----|-----------|----------|--------|-------------|
| RBAC-1 | P1 | Dashboard owner/director operational+financial | ⬜ TODO | — |
| RBAC-2 | P1 | permissionOptionsFromSettings в settings guards | ⬜ TODO | — |
| RBAC-7 | P2 | Redirect вместо spinner на `/` без dashboard | ⬜ TODO | — |
| RBAC-8 | P2 | Export helpers §9 + accountant financial export | ⬜ TODO | — |
| RBAC-3 | P2 | RLS teacher subscriptions + `teachers_can_sell_subscriptions` | ⬜ TODO | — |
| RBAC-4 | P2 | Teacher scoped home (не OperationalDashboard) | ✅ Этап 0 (NAV-2) | f09bf3f |
| RBAC-5 | P2 | Accountant: скрыть /prices nav | ✅ Этап 0 (NAV-1) | f09bf3f |
| RBAC-6 | P3 | admin disciplines.write — решение стейкхолдера | ✅ убрано у admin | f09bf3f |
| NAV-1 | — | Accountant prices nav policy | ✅ вариант B | f09bf3f |
| NAV-2 | — | Teacher home screen policy | ✅ вариант C | f09bf3f |

---

## 9. Связанные файлы

| Область | Путь |
|---------|------|
| ТЗ RBAC | `tangodb_roles_rbac_TZ.md` |
| Permissions | `tangodb/src/lib/permissions.ts` |
| Hook | `tangodb/src/hooks/usePermissions.ts` |
| Route guards | `tangodb/src/auth/routeGuards.tsx` |
| Nav | `tangodb/src/App.tsx` |
| Dashboard split | `tangodb/src/pages/DashboardPage.tsx` |
| Settings nav | `tangodb/src/settings/SettingsLayout.tsx` |
| Settings redirect | `tangodb/src/settings/SettingsIndexRedirect.tsx` |
| Export UI | `tangodb/src/settings/pages/DataExportPage.tsx` |
| R2 migration | `tangodb/supabase/migrations/20260629000001_v2_rbac_roles_refinement.sql` |
| R3 payments | `tangodb/supabase/migrations/20260630000001_v2_payments_module.sql` |
| R4 masking | `tangodb/supabase/migrations/20260701000001_v2_client_notes_and_teacher_field_masking.sql` |
| R6 reception | `tangodb/supabase/migrations/20260703000001_v2_reception_restricted_admin.sql` |
| Org overrides | `tangodb/supabase/migrations/20260704000001_v2_rbac_org_setting_overrides.sql` |
| Invite EF | `tangodb/supabase/functions/invite-member/index.ts` |

---

*Документ: Regression QA §10 + ревизия сверки с кодом (2026-06-20). **Этап 0 выполнен** (NAV-1, NAV-2, RBAC-6). Следующий шаг — bundle P1 (RBAC-1 + RBAC-2 + RBAC-7), затем RBAC-8.*
