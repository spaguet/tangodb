# TangoDB — RBAC: анализ рекомендаций и план реализации

> Документ для согласования и поэтапного внедрения ролей.  
> Версия: **1.2** (ревизия после аудита на предмет ошибок и сценарного анализа, 2026-06-20).  
> Базовый контекст: `tangodb_saas_platform_TZ.md` §5, текущий код `tangodb/src/lib/permissions.ts`, RLS `20260623000001_v2_business_rls.sql`, хелперы tenant `20260620000002_v2_tenant_auth_helpers.sql`.

---

## 1. Цель

Привести модель ролей TangoDB к операционной логике танцевальной CRM:

- **бухгалтер** — read-only только на финансы;
- **преподаватель** — read-write только в своей зоне (scope);
- **администратор** — полный операционный доступ без стратегии и системных настроек;
- **владелец / руководитель** — стратегия, команда, тарифы, аналитика.

Рекомендации внешнего ИИ (4 роли + опциональный кассир) проанализированы ниже и адаптированы под уже реализованную архитектуру TangoDB v2 (5 ролей, Supabase RLS, `TeacherScope`).

> **Важно:** этот документ **сужает** права `admin` и `accountant` относительно `tangodb_saas_platform_TZ.md` §5.2 (где admin ещё имеет настройки, команду, управление тарифами и экспорт). После принятия R0 нужно синхронизировать базовое ТЗ §5 и §6.1.

---

## 2. Анализ рекомендаций внешнего ИИ

### 2.1. Что согласуется с TangoDB

| Рекомендация | Оценка |
|--------------|--------|
| 4 базовые роли покрывают 95% сценариев | ✅ Согласовано; в TangoDB добавлен `director` как промежуточная роль между owner и admin |
| Принцип «accountant = read-only на финансы» | ✅ Совпадает с задумкой v2, но **ещё не доведено до UI и RLS** |
| Принцип «teacher = scoped read-write» | ✅ Уже есть `organization_members.scope` + SQL-хелперы `teacher_can_access_*` |
| Admin без P&L и зарплат | ✅ Логично; модулей P&L/зарплат пока нет — закладываем в целевую матрицу |
| Teacher видит статус абонемента, но не суммы/историю платежей | ✅ Важный нюанс для двери зала; **сейчас не enforced** |
| Owner — единственный с управлением ролями и системными настройками | ⚠️ Частично: owner + director + admin имеют `settings.manage` и `team.manage` |
| Опциональный кассир/ресепшен | ✅ Отложить до v2.2; можно смоделировать как preset scope для `admin` |

### 2.2. Что расходится с текущей реализацией

| Рекомендация ИИ | Сейчас в TangoDB | Критичность |
|-----------------|------------------|-------------|
| Admin **не** управляет пользователями | `team.manage` → owner, director, **admin**; RLS `can_manage_team()` тоже включает admin | 🔴 Высокая |
| Admin **не** имеет доступа к настройкам системы | `settings.manage` → owner, director, **admin**; RLS `can_manage_settings()` тоже включает admin | 🔴 Высокая |
| Admin **не** экспортирует данные | `dashboard.export` сейчас включает admin — нужно убрать | 🟡 Средняя |
| Admin — базовые отчёты, без P&L | `dashboard.read` сейчас `true` для всех ролей без разделения operational/financial | 🟡 Средняя |
| Accountant **не** видит CRM (клиенты, расписание, посещаемость) | `can_read_all_business()` включает accountant; `disciplines.read` тоже | 🔴 Высокая |
| Accountant — только финансы + экспорт | Accountant видит `clients` и `subscriptions`; `prices.read` допустим как справочник для финансов | 🔴 Высокая |
| Teacher **не** продаёт групповые абонементы | `subscriptions.sell` / `subscriptions.write` для teacher в scope; в RLS есть отдельные teacher insert/update/delete policies | 🟡 Средняя |
| Teacher **не** продаёт инд. уроки чужим клиентам | `personal_lessons.sell` для teacher в scope — **оставляем** для своих уроков | 🟢 Уточнение |
| Teacher — только свои заметки | Сущности `client_notes` нет | 🟢 Низкая (новая фича) |
| Платежи (нал/перевод) как отдельный журнал | Есть `personal_lessons.paid`, нет таблицы `payments` | 🟢 Новая фича |
| Зарплаты преподавателей | Не реализовано | 🟢 Новая фича |
| Уведомления ученикам | Не реализовано | 🟢 Новая фича |

### 2.3. Роль `director` — решение для TangoDB

Внешний ИИ не знает про `director`. **Оставляем** — типичный сценарий школы:

- **owner** — учредитель: лицензия, смена owner, удаление org, полная финансовая аналитика;
- **director** — управляющий: всё как owner, **кроме** `license.activate`, смены owner и удаления org.

`admin` в целевой модели **ниже** director и **не** получает стратегические права.

### 2.4. Расхождение с `tangodb_saas_platform_TZ.md` §5

| Тема | Базовое ТЗ §5.2 | Целевая модель (этот документ) | Действие |
|------|-----------------|--------------------------------|----------|
| Admin → настройки org | ✓ | ❌ | Обновить §5.2 и §6.1 базового ТЗ после R0 |
| Admin → управление командой | ✓ (teacher/accountant) | ❌ | То же |
| Admin → управление тарифами | ✓ | ❌, но read-only справочник для продаж сохраняется | То же |
| Admin → экспорт CSV | ✓ | ❌ | То же |
| Accountant → read CRM | ✓ (R) | ❌ CRM, только финансы | То же |
| `can_manage_settings()` в SQL | owner, director, **admin** | owner, director | Миграция R2 |

---

## 3. Целевая модель ролей

### 3.1. Состав ролей

| Код | UI-название | Назначение |
|-----|-------------|------------|
| `owner` | Владелец | Полный доступ + лицензия + lifecycle org |
| `director` | Руководитель | Стратегия и команда без лицензии/delete org |
| `admin` | Администратор | Операционка: клиенты, абонементы, расписание, посещаемость, фиксация оплат |
| `teacher` | Преподаватель | Scoped: свои занятия, посещаемость, свои ученики, инд. уроки |
| `accountant` | Бухгалтер | Read-only финансы, отчёты, экспорт |
| `reception` *(v2.2)* | Кассир / ресепшен | Опционально: subset прав admin без настроек и отчётов |

### 3.2. Иерархия (только для admin-ветки)

```
owner > director > admin
```

`teacher` и `accountant` — **отдельные ветки**, не сравнивать числовым «уровнем».

### 3.3. Scope преподавателя (без изменений)

```typescript
interface TeacherScope {
  discipline_ids: string[];
  location_ids: string[];
  all_disciplines: boolean;
  all_locations: boolean;
  can_view_all_clients: boolean;
}
```

Default deny: пустой scope = нет доступа (уже в RLS).

---

## 4. Целевая матрица доступа

Легенда: ✅ read+write · 👁 read · 🔒 read (ограничено полями) · ❌ нет доступа · 📊 агрегаты в отчётах

| Функция | owner | director | admin | teacher | accountant |
|---------|:-----:|:--------:|:-----:|:-------:|:----------:|
| Управление учениками (CRUD) | ✅ | ✅ | ✅ | 👁🔒 свои* | ❌ |
| Абонементы (CRUD, тариф, история) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Статус абонемента (active/freeze/finished) | ✅ | ✅ | ✅ | 🔒 в scope | ❌ |
| Расписание групп | ✅ | ✅ | ✅ | 👁 своё / 👁 всё†† | ❌ |
| Посещаемость (mark + история своих занятий) | ✅ | ✅ | ✅ | ✅ своё | ❌ |
| Инд. уроки | ✅ | ✅ | ✅ | ✅ свои | ❌ |
| Платежи — фиксация write (нал/перевод) | ✅ | ✅ | ✅ | ✅ свои уроки† | ❌ |
| Платежи — оперативный журнал read | ✅ | ✅ | ✅ | ❌ | ❌ |
| Справочник тарифов для продаж | ✅ | ✅ | 👁 | ❌ | 👁 |
| Управление тарифами / ценообразованием | ✅ | ✅ | ❌ | ❌ | ❌ |
| Операционные отчёты (активные абон., должники, посещ.) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Фин. отчёты (выручка, LTV, дебиторка) | ✅ | ✅ | ❌ | ❌ | 👁 |
| P&L / расходы | ✅ | ✅ | ❌ | ❌ | 👁 |
| Зарплаты преподавателей | ✅ | ✅ | ❌ | ❌ | 👁 |
| Экспорт CSV/Excel | ✅ | ✅ | ❌ | ❌** | ✅ фин. |
| Заметки по ученикам | ✅ | ✅ | ✅ | ✅ свои | ❌ |
| Уведомления ученикам | ✅ | ✅ | ✅ | ❌ | ❌ |
| Настройки org (язык, freeze, модули) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Локации / направления (страницы `/settings/*`) | ✅ | ✅ | ❌ | ❌*** | ❌ |
| Управление командой / ролями | ✅ | ✅ | ❌**** | ❌ | ❌ |
| Audit log | ✅ | ✅ | ❌ | ❌ | ❌ |
| Лицензия / ключи | ✅ | 👁 | ❌ | ❌ | ❌ |

\* teacher — read профиля ученика в scope; write клиентов только при `teachers_can_edit_clients=true` (§9).  
\** teacher — scoped export только при `teachers_can_export=true` (§9); по умолчанию ❌.  
\*** teacher видит дисциплины/локации **в контексте своих панелей** (расписание, абонементы), но не страницы настроек.  
\*\*\*\* admin не управляет командой и ролями вообще; приглашение teacher/accountant — только owner/director (ужесточение относительно текущего кода).  
\† teacher записывает оплату только за **свои инд. уроки** через RPC с проверкой `teacher_member_id = self`; прямой INSERT в `payments` через REST — закрыт RLS.  
\†† при `teachers_can_view_full_schedule=true` (§9, default `true`) teacher читает всё расписание org в read-only режиме без клиентских данных; по умолчанию включено.

---

## 5. Детализация по ролям

### 5.1. Владелец (`owner`)

- Всё из матрицы.
- Эксклюзивно: `license.activate`, смена owner, удаление org, полная фин. аналитика с P&L (когда появится модуль).

### 5.2. Руководитель (`director`)

- Как owner, кроме: активация лицензии, смена owner, purge/delete org.
- Может приглашать admin/teacher/accountant, менять их роли и scope.
- `license.view` — да; `license.activate` — нет.

### 5.3. Администратор (`admin`) — **основное изменение относительно текущего кода**

**Разрешено:**

- CRUD учеников, история в рамках CRM.
- Абонементы: продажа, продление, заморозка, завершение.
- Расписание, посещаемость, инд. уроки, фиксация оплаты (`paid` / будущий `payments`); **просмотр оперативного журнала платежей** (записи текущего дня/сессии — без финансовой аналитики, агрегатов и P&L).
- Базовые виджеты dashboard: активные абонементы, должники (`lessons_left` / `paid=no`), посещаемость за период.
- Заметки по ученикам (когда появятся).
- Отправка операционных уведомлений (когда появятся).

**Запрещено:**

- `/settings/*` кроме редиректа «нет доступа» (или скрыть пункт меню).
- `/settings/team` — управление командой.
- Управление тарифами (`prices.write`, страницы редактирования `/prices`) — только owner/director; read-only справочник тарифов для продажи абонементов admin сохраняет.
- Экспорт CSV.
- Audit log, P&L, зарплаты, полная фин. аналитика.
- Финансовый журнал платежей других пользователей (видит только оперативный — то, что сам записал).

### 5.4. Преподаватель (`teacher`)

**Разрешено (в scope):**

- Просмотр своего расписания; при `teachers_can_view_full_schedule=true` (§9, default `true`) — read-only всего расписания организации без клиентских данных (имена учеников, контакты не раскрываются).
- Отметка посещаемости на своих занятиях (`mark_attendance`), включая просмотр истории посещаемости по своим занятиям.
- Просмотр профиля ученика: имя, контакт, **статус абонемента** (active/finished/freeze), **без** `price_id`, сумм, `paid`, истории платежей.
- CRUD своих инд. уроков (где `teacher_member_id = self`), включая `personal_lessons.sell` **только для своих** уроков.
- Фиксация оплаты за свои инд. уроки (`payments.write`) — **только через RPC** `record_personal_lesson_payment` с проверкой `teacher_member_id = self`; прямой INSERT в `payments` закрыт RLS.
- Свои заметки по ученику.

**Запрещено:**

- Продажа/редактирование **групповых** абонементов (убрать `subscriptions.sell` / `subscriptions.write` для teacher, кроме org-setting override — см. §9).
- CRUD клиентов по умолчанию (оставить только если `teachers_can_edit_clients` + политика owner).
- Тарифы, настройки, экспорт (кроме scoped export по решению owner).
- Любые финансовые поля в API-ответах.

### 5.5. Бухгалтер (`accountant`) — **основное изменение относительно текущего кода**

**Разрешено (только read):**

- Модуль «Финансы» (`/finance/*`): платежи, выручка, дебиторка, статистика абонементов, зарплаты (когда появятся).
- Dashboard — **только финансовый subset** (агрегаты, без CRM-виджетов).
- Экспорт фин. отчётов (`/settings/data` или отдельная кнопка в `/finance`).
- Чтение тарифов (`prices`) для расшифровки сумм.

**Запрещено:**

- Любые INSERT/UPDATE/DELETE (уже блокируется в RPC; усилить RLS).
- Панели: клиенты, расписание, посещаемость, инд. уроки, абонементы — **не показывать в nav**.
- PII учеников: бухгалтер видит **имя клиента и контактный телефон только в финансовом контексте** — журнал платежей, дебиторский отчёт. Имя обязательно: дебиторская статья без идентификации должника не принимается в бухгалтерских документах (ФНС). Доступ к полному CRM-профилю клиента (карточка, история посещений, заметки) закрыт.

---

## 6. Gap analysis — текущий код

### 6.1. Frontend (`tangodb/src/lib/permissions.ts`)

| PermissionAction | Сейчас | Целевое |
|------------------|--------|---------|
| `reports.operational` (замена `dashboard.read` operational) | все роли без различия | owner, director, admin, teacher* |
| `reports.financial` (замена `dashboard.read` financial) | все роли без различия | owner, director, accountant |
| `settings.manage` | owner, director, **admin** | owner, director |
| `team.manage` | owner, director, **admin** | owner, director (+ override `admin_can_manage_team`) |
| `prices.read` | admin + accountant | owner, director, admin, accountant |
| `prices.write` | owner, director, admin | owner, director |
| `disciplines.read` | admin + accountant + teacher* | owner, director, admin, teacher*; **без** accountant |
| `dashboard.export` | owner, director, admin, accountant, scoped teacher | owner, director, accountant (+ optional scoped teacher) |
| `subscriptions.sell/write` | admin + scoped **teacher** | admin + owner/director; teacher — **нет** (override §9) |
| `clients.write` | admin + scoped teacher | admin + owner/director; teacher — только при `teachers_can_edit_clients` |
| `license.view` | owner, director, **admin** | owner, director |
| `personal_lessons.sell` | admin + scoped teacher | без изменений (teacher — свои уроки) |
| `payments.read.operational` | — (новый) | owner, director, admin |

Новые actions (R1): `finance.read`, `finance.export`, `reports.operational`, `reports.financial`, `payments.write`, `payments.read.operational`.

> **Унификация naming:** везде в коде и документации использовать `reports.operational` / `reports.financial` вместо `dashboard.read (operational/financial)`. `dashboard.read` как legacy-alias оставить на переходный период; привести к единому виду в R1.

Новый `PanelId`: `finance` + маршрут `/finance/*`.

### 6.2. RLS и SQL-хелперы

| Функция | Файл / сейчас | Целевое |
|---------|---------------|---------|
| `can_manage_settings()` | `20260620000002_…` → owner, director, **admin** | owner, director |
| `can_manage_team()` | `20260620000002_…` → owner, director, **admin** | owner, director (+ override позже) |
| `can_read_all_business()` | `20260623000001_…` → + accountant | **deprecated** → split |
| `can_write_all_business()` | owner, director, admin | без изменений |
| `can_export_data()` | + admin, accountant, scoped teacher | owner, director, accountant (+ teacher scoped) |
| `can_read_financial()` *(новая)* | — | owner, director, accountant |
| `can_read_operational()` *(новая)* | — | owner, director, admin; teacher проверяется отдельными row-level scope policies |
| `can_read_prices()` *(новая)* | accountant через `can_read_all_business`; teacher через отдельную `prices_select` | owner, director, admin, accountant |
| `can_manage_prices()` *(новая)* | через `can_write_all_business` | owner, director |
| `can_export_financial()` *(новая)* | — | owner, director, accountant |
| `can_read_own_payments()` *(новая, RPC)* | — | teacher — только записи, где `created_by = auth_member_id()` AND `personal_lesson_id` в scope; вызывается через `record_personal_lesson_payment` RPC |
| `inviter_can_assign_role()` | admin → teacher/accountant | owner/director → все кроме owner/director; **admin — никого** |

Новая RPC функция: `record_personal_lesson_payment(lesson_id, amount, method)` — создаёт запись в `payments` от имени teacher только для своего урока; прямой INSERT в `payments` для teacher запрещён RLS-политикой.

Policies на `clients`, `subscriptions`, `attendance`, `schedule_slots`, `personal_lessons`, `classes`, `class_teachers`, `prices`, `disciplines`, `locations` — убрать accountant из operational SELECT; teacher оставить через существующие scope policies. `can_read_all_business()` переписать как legacy alias для owner/director/admin, чтобы случайное старое использование не возвращало CRM бухгалтеру.

`payments` SELECT policy: `can_read_operational()` → owner, director, admin (полный оперативный журнал); `can_read_financial()` → owner, director, accountant (финансовый журнал); teacher — только через RPC, прямой SELECT закрыт.

`audit_log` — уже owner/director only ✅ (менять не нужно).

### 6.3. UI / маршруты

| Место | Изменение |
|-------|-----------|
| `App.tsx` / sidebar nav | Скрыть пункты по роли; добавить `/finance` для accountant/owner/director |
| `permissions.ts` → `panelIdFromPath` | Добавить `/finance` → `finance` |
| `routeGuards.tsx` | Без изменений архитектуры — опирается на `canAccessPanel` |
| `SettingsLayout` | Accountant: только секция `data` (export), не весь settings |
| `TeamSettingsPage.tsx` | `INVITE_ROLES` — убрать возможность admin приглашать |
| `invite-member` Edge Function + RPC | Синхронизировать `inviter_can_assign_role` |
| Dashboard | Split: `OperationalDashboard` vs `FinancialDashboard` |

### 6.4. Отсутствующие доменные сущности (вне scope RBAC-фазы 1)

| Сущность | Нужна для рекомендаций ИИ | Приоритет | Зависимость фазы |
|----------|---------------------------|-----------|------------------|
| `payments` | Журнал оплат, история для бухгалтера | P1 | R3 |
| `client_notes` | Заметки teacher/admin | P2 | R4 |
| `teacher_payroll` / `payroll_entries` | Зарплаты | P3 | R5 |
| `expenses` | P&L | P3 | R5 |
| `notifications` | SMS/TG/email ученикам | P3 | после R5 |

### 6.5. Уже согласовано с целевой моделью (менять не нужно)

- `audit_log` SELECT — только owner/director.
- `license.activate` — только owner (UI + RLS `access_keys`).
- Teacher scope helpers — архитектура корректна.
- `business_row_writable()` блокирует accountant на write.

---

## 7. План реализации

### Фаза R0 — Согласование (1 сессия)

- [x] Подтвердить: admin **теряет** settings/team/prices.write/export, но сохраняет `prices.read` для продаж.
- [x] Подтвердить: accountant **теряет** доступ к CRM-панелям.
- [x] Подтвердить: teacher **теряет** продажу **групповых** абонементов по умолчанию.
- [x] Подтвердить: teacher **сохраняет** `personal_lessons.sell` для своих уроков.
- [x] Решить: оставлять ли `director` или схлопнуть в owner (рекомендация: **оставить**).
- [x] Зафиксировать: обновить `tangodb_saas_platform_TZ.md` §5 после R0.

**Критерий:** стейкхолдер подписал матрицу §4; создана запись в `decision_log.md`.

---

### Фаза R1 — Permissions + UI guards (без миграций)

**Файлы:** `permissions.ts`, `usePermissions.ts`, nav в `App.tsx`, `SettingsLayout`, `TeamSettingsPage`, `routeGuards.tsx`.

1. Добавить actions: `finance.read`, `finance.export`, `reports.operational`, `reports.financial`, `payments.write`.
2. Сузить `settings.manage`, `team.manage`, `prices.write`, `dashboard.export`, `license.view`, `disciplines.read` (accountant).
3. Разделить `dashboard.read` на operational / financial subset.
4. Добавить panel `finance` + route `/finance/*` (заглушка «Скоро» до R3).
5. Teacher: redact фин. поля в hooks/select (не отдавать `price_id`, `price`, `paid`, суммы в query для teacher).
6. Обновить `canAccessPanel` — accountant: `dashboard` (financial) + `finance` + `settings/data` только export.
7. Скрыть nav-пункты для accountant и урезанного admin.

**⚠️ Ограничение:** R1 — только UX. Прямой Supabase REST до R2 всё ещё обходит UI. R2 обязателен перед продакшеном с ролью accountant.

**Критерий готовности:** UI не показывает запрещённое; прямой URL → redirect; TypeScript без ошибок.

---

### Фаза R2 — RLS, SQL-хелперы и Edge Functions

**Новая migration:** `<дата_запуска_YYYYMMDD>_v2_rbac_roles_refinement.sql` (использовать реальную дату создания файла)

> **Порядок в миграции:** всё выполнять в одной транзакции (`BEGIN … COMMIT`). Строгий порядок: сначала пересоздать функции (шаги 1–2), затем обновить policies (шаг 4). Промежуточное состояние недопустимо — функция обновлена, а политика ещё ссылается на старое поведение создаёт временное окно с неверными правами.

1. **Обновить** (не дублировать) в одной миграции:
   ```sql
   can_manage_settings()   -- owner, director
   can_manage_team()       -- owner, director
   can_read_financial()    -- owner, director, accountant
   can_read_operational()  -- owner, director, admin
   can_read_prices()       -- owner, director, admin, accountant
   can_manage_prices()     -- owner, director
   can_export_financial()  -- owner, director, accountant
   ```
2. Переписать `can_read_all_business()` как deprecated alias для operational read (`owner/director/admin`) и не использовать его для finance.
3. Обновить `can_export_data()` — убрать admin по умолчанию.
4. Заменить policies на business-таблицах: operational full-access → `can_read_operational()`; teacher policies оставить scope-based; prices → `can_read_prices()` / `can_manage_prices()`; `payments` SELECT → `can_read_operational() OR can_read_financial()`.
5. `organization_members` policies + `inviter_can_assign_role()`: admin не может invite/update roles.
6. `organization_settings` UPDATE — только `can_manage_settings()`.
7. `invite-member/index.ts`: синхронизировать `ASSIGNABLE_ROLES` — **обязательно**. Edge Function не должна полагаться только на RPC; двойная проверка предотвращает обход через прямой вызов с service role.
8. RPC `record_personal_lesson_payment` — создать с проверкой `teacher_member_id = auth_member_id()` и INSERT в `payments`.
9. Views для accountant (опционально R2.1): `financial_payments_v`, `financial_revenue_v`.

**Критерий готовности:** прямой Supabase REST/API не обходит UI; regression-тесты §10.2 проходят.

---

### Фаза R3 — Модуль платежей

1. Таблица `payments` (`organization_id`, `client_id`, `amount`, `method`, `subscription_id?`, `personal_lesson_id?`, `created_by`, `created_at`).
2. RLS INSERT/UPDATE: `can_write_all_business()`; SELECT: `can_read_operational() OR can_read_financial()`; прямой INSERT для teacher — закрыт (используется RPC из R2 шаг 8).
3. UI: кнопка «Зафиксировать оплату» в admin-панелях (subscriptions, personal lessons); read-only оперативный журнал в admin dashboard (платежи за день); read-only полный журнал в `/finance/payments` для accountant/owner/director.
4. Миграция данных: backfill из `personal_lessons.paid` + продажи абонементов.

**Критерий готовности:** accountant видит полный журнал; admin может фиксировать оплату и видит оперативный журнал; teacher не видит суммы в REST и получает оплату своих уроков только через RPC.

---

### Фаза R4 — Заметки и teacher field masking (RLS)

1. `client_notes` (`client_id`, `author_member_id`, `body`, `created_at`).
2. RLS: teacher — только свои notes; admin+ — all in org.
3. Column-level masking subscription fields для teacher (views или RPC), дополняя R1 hooks.

**Критерий готовности:** teacher по UUID не получает `price_id` / `paid` даже через REST.

---

### Фаза R5 — Финансовая аналитика и зарплаты

1. `/finance/revenue`, `/finance/debtors`, `/finance/payroll`.
2. Dashboard split: admin → operational widgets only; accountant → financial widgets only.
3. P&L — только owner/director/accountant.

---

### Фаза R6 (опционально) — Роль `reception`

Рекомендация: **Вариант B** — без нового CHECK constraint:

- Шаблон приглашения «Кассир» = `admin` с `organization_members.meta.restricted_admin=true`.
- Доп. guard в `permissions.ts` для subset: payments + attendance + subscription status read; без schedule CRUD, client CRUD, reports.

Вариант A (отдельный код `reception` в CHECK) — только если нужна отчётность по роли в audit/SQL.

Права кассира: оплата + посещаемость + проверка абонемента; без расписания, отчётов, клиентского CRUD.

---

## 8. Маппинг PermissionAction → RLS

| PermissionAction | SQL helper | Роли |
|------------------|------------|------|
| `clients.read` | `can_read_operational()` OR teacher scope | owner, director, admin, teacher* |
| `clients.write` | `can_write_all_business()` + teacher policy | owner, director, admin, teacher† |
| `subscriptions.read` | `can_read_operational()` OR teacher scope; field mask | ↑ |
| `subscriptions.write/sell` | `can_write_all_business()` | owner, director, admin |
| `attendance.write` | admin branch + teacher scope | owner, director, admin, teacher* |
| `schedule.write` | `can_write_all_business()` | owner, director, admin |
| `personal_lessons.write/sell` | admin + teacher (own lesson) | owner, director, admin, teacher* |
| `payments.write` | `can_write_all_business()` | owner, director, admin |
| `payments.write` (инд. урок teacher) | RPC `record_personal_lesson_payment` с проверкой `teacher_member_id = self` | teacher* |
| `payments.read.operational` | `can_read_operational()` | owner, director, admin |
| `prices.read` | `can_read_prices()` | owner, director, admin, accountant |
| `prices.write` | `can_manage_prices()` | owner, director |
| `finance.read` | `can_read_financial()` | owner, director, accountant |
| `finance.export` | `can_export_financial()` | owner, director, accountant |
| `reports.operational` | `can_read_operational()`; teacher — только через scoped queries/RPC | owner, director, admin, teacher* |
| `reports.financial` | `can_read_financial()` | owner, director, accountant |
| `dashboard.export` | `can_export_data()` | owner, director, accountant |
| `settings.manage` | `can_manage_settings()` | owner, director |
| `team.manage` | `can_manage_team()` | owner, director |
| `license.view` | role IN (owner, director) | owner, director |
| `license.activate` | role = owner | owner |

\* teacher — только в пределах scope.  
† teacher CRUD клиентов — только если `teachers_can_edit_clients=true` (§9).

---

## 9. Org-setting overrides (гибкость без новых ролей)

Добавить в `organization_settings` (boolean, default = рекомендованное) — **миграция в R2 или отдельной R1+R2 подфазе; не в чистой R1, где миграции запрещены**:

| Флаг | Default | Эффект |
|------|---------|--------|
| `teachers_can_sell_subscriptions` | `false` | teacher + `subscriptions.sell` |
| `teachers_can_edit_clients` | `false` | teacher + `clients.write` |
| `teachers_can_export` | `false` | teacher + `dashboard.export` (scoped) |
| `teachers_can_view_full_schedule` | `true` | teacher читает всё расписание org в read-only без клиентских данных (имена учеников скрыты) |
| `admin_can_export` | `false` | admin + `dashboard.export` |
| `admin_can_manage_team` | `false` | admin + `team.manage` (не рекомендуется) |

Читать флаги в `permissions.ts` и `usePermissions.ts` (аналогично `teachers_can_manage_disciplines`) только после добавления колонок и обновления `OrganizationSettings`.

> **R1 до миграции:** флаги `teachers_can_sell_subscriptions` и `teachers_can_view_full_schedule` в фазе R1 хардкодятся как `false` / `true` соответственно — до появления колонок в R2. После R2 `permissions.ts` читает реальные значения из `OrganizationSettings`. Это поведение по умолчанию безопасно: teacher не продаёт групповые абонементы, но видит полное расписание.

### 9.1. Флаги отключения модулей (solo-режим / одиночный тенант)

Для организаций, которым не нужны все модули (например, педагог ведёт один класс в неделю и является owner своего тенанта):

| Флаг | Default | Эффект |
|------|---------|--------|
| `module_finance_enabled` | `true` | При `false` — `/finance` скрыт, роль `accountant` недоступна для приглашения; при попытке — ошибка «Финансовый модуль отключён» |
| `module_locations_enabled` | `true` | При `false` — локации не отображаются в расписании, scope и настройках |
| `module_payroll_enabled` | `false` | Зарплатный модуль (R5); `false` — скрыть `/finance/payroll` |

Флаги управляет только `owner` через страницу `/settings/general` (секция «Модули»). Миграция — вместе с флагами §9 в R2.

---

## 10. Чеклист тестирования

### 10.1. Роли

- [ ] owner: полный доступ, activate license
- [ ] director: без activate license, с team + settings
- [ ] admin: CRM write, `prices.read` есть, нет settings/team/prices.write/export
- [ ] teacher: только scope; нет сумм в API; attendance OK; personal_lessons.sell OK
- [ ] accountant: только finance routes; REST на `clients` → 0 rows

### 10.2. Безопасность

- [ ] JWT `member_role` ≠ PostgreSQL role (regression)
- [ ] Смена org → refresh session → права обновились
- [ ] admin не может повысить себя до director через API
- [ ] admin не может invite через `create_organization_invite`
- [ ] teacher не читает чужой `subscription` по UUID
- [ ] teacher не получает `price_id` / `paid` в REST-ответе
- [ ] accountant не вызывает `mark_attendance` успешно

### 10.3. UI

- [ ] Nav скрывает запрещённые пункты для каждой роли
- [ ] Direct URL `/settings/team` as admin → redirect
- [ ] Accountant: `/settings/data` доступен, `/settings/general` — нет
- [ ] ReadOnlyBanner (demo/past_due) работает поверх RBAC

---

## 11. Порядок работ (рекомендуемый)

```
R0 согласование
  → R1 permissions.ts + nav (быстрый UX win, ≤2 дня)
  → R2 RLS migration (security, обязательно сразу после R1)
  → R3 payments (фундамент для accountant)
  → R4 notes + field masking (RLS-уровень)
  → R5 analytics/payroll
  → R6 reception (по запросу)
```

**Оценка:** R1 ≈ 1–2 дня; R2 ≈ 1–2 дня; R3 ≈ 3–5 дней; R4–R5 — отдельные спринты.

**Зависимости:**

| Фаза | Блокирует | Заметка |
|------|-----------|---------|
| R0 | всё | Без согласования не начинать R1 |
| R1 | — | Можно деплоить, но не с accountant в prod без R2 |
| R2 | R3–R5 security | Обязательна перед prod |
| R3 | полноценный `/finance` | R1-заглушка заменяется контентом |
| R4 | — | Можно параллельно с R3 после R2 |
| §9-флаги | R1 overrides | Миграция колонок — в R2 или отдельной подфазе; в R1 использовать только уже существующие settings |

---

## 12. Связанные файлы

| Область | Путь |
|---------|------|
| Типы ролей | `tangodb/src/types/organization.ts` |
| Permissions | `tangodb/src/lib/permissions.ts` |
| Hook | `tangodb/src/hooks/usePermissions.ts` |
| Route guards | `tangodb/src/auth/routeGuards.tsx` |
| Team UI | `tangodb/src/settings/pages/TeamSettingsPage.tsx` |
| Settings layout | `tangodb/src/settings/SettingsLayout.tsx` |
| Invite API | `tangodb/supabase/functions/invite-member/index.ts` |
| Invite RPC | `tangodb/supabase/migrations/20260624000001_v2_organization_invites.sql` |
| Tenant SQL helpers | `tangodb/supabase/migrations/20260620000002_v2_tenant_auth_helpers.sql` |
| Tenant RLS | `tangodb/supabase/migrations/20260620000003_v2_tenant_rls.sql` |
| Business RLS | `tangodb/supabase/migrations/20260623000001_v2_business_rls.sql` |
| JWT hook | `tangodb/supabase/migrations/20260627000002_v2_jwt_member_role_claim.sql` |
| Базовое ТЗ | `tangodb_saas_platform_TZ.md` §5 |

---

## 13. Резюме для стейкхолдера

Рекомендации внешнего ИИ **в целом верны** и хорошо ложатся на архитектуру TangoDB v2. Главные отличия проекта:

1. Уже есть роль **`director`** — её сохраняем между owner и admin.
2. Текущий **`admin` слишком широкий** (настройки, команда, экспорт) — нужно сузить.
3. Текущий **`accountant` слишком широкий** (read всего CRM) — нужен отдельный финансовый контур.
4. **`teacher` слишком широкий** в продажах **групповых** абонементов — сузить, оставить override через settings.
5. Часть рекомендаций (платежи, зарплаты, заметки, P&L) — **новые модули**, RBAC для них закладывается заранее.
6. Базовое ТЗ §5 **устарело** относительно целевой модели — синхронизировать после R0.

Принцип для RLS остаётся неизменным: **UI — удобство, RLS — источник истины**.

---

## 14. Рекомендации (вне обязательного scope)

1. **Не откладывать R2** после R1 — иначе accountant и урезанный admin останутся уязвимы через REST.
2. **Единый источник матрицы** — после R0 обновить `tangodb_saas_platform_TZ.md` §5, чтобы агенты не расходились.
3. **Column masking для teacher** — предпочесть SQL views/RPC, а не только фронтенд-select (defense in depth).
4. **Org overrides** — не включать `admin_can_manage_team=true` в UI по умолчанию; только advanced settings для owner.
5. **Reception** — начинать с Варианта B (`meta.restricted_admin`), не расширять CHECK constraint без необходимости.
6. **Тесты RLS** — добавить SQL-тесты или pgTAP для `inviter_can_assign_role` и accountant deny на `clients`.
7. **Дебиторский отчёт** — заранее согласовать уровень PII для accountant (имя vs anonymized id).

---

## 15. Промпты для агента по фазам

Копировать в Cursor Agent целиком. Перед каждой фазой читать `.cursor/docs/ai/AI_CONTEXT.md` и этот документ.

---

### Промпт R0 — Согласование

```
Задача: провести ревью RBAC-документа tangodb_roles_rbac_TZ.md §4–§5 с владельцем продукта.

Контекст: TangoDB v2, 5 ролей (owner/director/admin/teacher/accountant). Документ предлагает сузить admin и accountant относительно tangodb_saas_platform_TZ.md §5.

Сделай:
1. Составь таблицу «было → станет» для admin и accountant (настройки, команда, управление тарифами, экспорт, CRM).
2. Отметь спорные пункты: PII в дебиторском отчёте, teacher personal_lessons.sell, нужен ли director.
3. Подготовь черновик записи для .cursor/docs/ai/decision_log.md с принятыми решениями.
4. Если решения приняты — перечисли правки для tangodb_saas_platform_TZ.md §5.2 (только список, без правки файла).

Не пиши код. Язык: русский.
```

---

### Промпт R1 — Permissions + UI guards

```
Задача: фаза R1 из tangodb_roles_rbac_TZ.md — permissions и UI guards без SQL-миграций.

Прочитай: tangodb_roles_rbac_TZ.md §6.1, §7 R1, §9.
Файлы: tangodb/src/lib/permissions.ts, usePermissions.ts, App.tsx, SettingsLayout.tsx, TeamSettingsPage.tsx, routeGuards.tsx.

Сделай:
1. Добавь PermissionAction: finance.read, finance.export, reports.operational, reports.financial, payments.write.
2. Сузь: settings.manage, team.manage, prices.write, dashboard.export, license.view — убери admin где указано в gap table; `prices.read` для admin оставь.
3. Убери accountant из disciplines.read и CRM panels.
4. Раздели dashboard.read: operational (owner/director/admin/teacher) vs financial (owner/director/accountant).
5. Добавь PanelId "finance", route /finance/* (заглушка), panelIdFromPath, canAccessPanel.
6. Accountant: nav только dashboard (financial subset) + finance + settings/data (export).
7. Admin: скрой settings/team/export и действия редактирования `/prices`; read-only справочник тарифов для продаж оставь доступным.
8. Teacher: в hooks для subscriptions/clients убери price_id, price, paid и суммы из select для role=teacher (минимальный diff).
9. TeamSettingsPage: admin не видит форму invite (canAssignRole уже есть — проверь согласованность).

Правила проекта: .cursor/rules/core.mdc, без any, Supabase только через hooks/lib.
После изменений: обнови .cursor/docs/ai/changelog.md.
Не трогай RLS и миграции.
```

---

### Промпт R2 — RLS и SQL-хелперы

```
Задача: фаза R2 из tangodb_roles_rbac_TZ.md — security layer.

Прочитай: tangodb_roles_rbac_TZ.md §6.2, §7 R2, §8.
Файлы: 20260620000002_v2_tenant_auth_helpers.sql (can_manage_settings/team),
       20260623000001_v2_business_rls.sql,
       20260624000001_v2_organization_invites.sql (inviter_can_assign_role),
       invite-member/index.ts.

Создай миграцию с именем `<реальная_дата_YYYYMMDD>_v2_rbac_roles_refinement.sql` (подставь актуальную дату запуска, не литеральный YYYYMMDD):
1. UPDATE can_manage_settings(), can_manage_team() — только owner, director.
2. CREATE can_read_financial(), can_read_operational(), can_read_prices(), can_manage_prices(), can_export_financial().
3. UPDATE can_export_data() — убрать admin.
4. Замени can_read_all_business() в full-access policies business-таблиц на operational/financial split по §8; teacher policies не схлопывай в общий helper.
5. prices: read через can_read_prices(), write через can_manage_prices().
6. UPDATE inviter_can_assign_role — admin не может никого приглашать.
7. GRANT EXECUTE на новые функции.

Синхронизируй invite-member ASSIGNABLE_ROLES если нужно.
Не меняй RLS-политики platform/dev-console таблиц.
После: changelog.md, кратко architecture.md если менялась security-модель.

Проверь: accountant SELECT clients → 0 rows; admin cannot create_organization_invite.
```

---

### Промпт R3 — Модуль платежей

```
Задача: фаза R3 из tangodb_roles_rbac_TZ.md.

Создай таблицу payments (organization_id, client_id, amount, method, subscription_id nullable, personal_lesson_id nullable, created_by, created_at).
RLS: INSERT/UPDATE — can_write_all_business(); SELECT — can_read_operational() OR can_read_financial().

Frontend:
- Hook usePayments в tangodb/src/hooks/
- UI /finance/payments — read-only для accountant/owner/director
- Кнопка «Зафиксировать оплату» в admin-панелях (subscriptions, personal lessons)

Backfill migration: personal_lessons.paid + существующие продажи абонементов где возможно.

Следуй conventions: hooks для Supabase, permissions для UI guards.
Обнови changelog.md.
```

---

### Промпт R4 — Заметки и field masking

```
Задача: фаза R4 из tangodb_roles_rbac_TZ.md.

1. Таблица client_notes (id, organization_id, client_id, author_member_id, body, created_at).
2. RLS: teacher — CRUD только где author_member_id = auth_member_id(); admin+ — all in org.
3. SQL view или RPC для subscriptions без price_id/paid для teacher role.
4. UI: блок заметок в карточке клиента (teacher — свои, admin — все).

Убедись что teacher через прямой REST не получает финансовые поля (defense in depth поверх R1 hooks).
Обнови changelog.md.
```

---

### Промпт R5 — Финансовая аналитика

```
Задача: фаза R5 из tangodb_roles_rbac_TZ.md.

Реализуй:
- /finance/revenue, /finance/debtors (accountant + owner/director read-only)
- Split Dashboard: OperationalDashboard (admin) vs FinancialDashboard (accountant/owner/director)
- Admin dashboard: только виджеты §5.3 (активные абонементы, должники, посещаемость)
- Заглушки /finance/payroll до появления teacher_payroll таблицы

Используй can(role, 'reports.operational') и can(role, 'reports.financial').
Обнови changelog.md и design_system.md если новые layout-паттерны.
```

---

### Промпт R6 — Reception (опционально)

```
Задача: фаза R6 из tangodb_roles_rbac_TZ.md — Вариант B (restricted_admin).

Без нового role в CHECK:
1. organization_members.meta JSONB поле restricted_admin: boolean (миграция).
2. В permissions.ts: если admin + meta.restricted_admin — subset прав (payments.write, attendance.write, subscriptions.read masked, без clients.write, schedule.write, reports).
3. Шаблон invite «Кассир» в TeamSettingsPage — admin с meta.restricted_admin=true.

Не ломай обычного admin. Тесты: restricted admin не открывает /clients, /schedule.
Обнови changelog.md и decision_log.md.
```

---

### Промпт R1+R2 — Org-setting overrides (§9)

```
Задача: флаги override из tangodb_roles_rbac_TZ.md §9.

Миграция organization_settings:
- teachers_can_sell_subscriptions (default false)
- teachers_can_edit_clients (default false)
- teachers_can_export (default false)
- admin_can_export (default false)
- admin_can_manage_team (default false)

Подключи в permissions.ts и usePermissions.ts (как teachers_can_manage_disciplines).
UI: OrganizationSettingsPage — секция «Расширенные права ролей» только для owner/director.

Обнови types/organization.ts, OrganizationProvider mapping, changelog.md.
```

---

### Промпт — Regression QA (§10)

```
Задача: пройти чеклист tangodb_roles_rbac_TZ.md §10.

Для каждой роли owner/director/admin/teacher/accountant:
1. Перечисли видимые nav-пункты (ожидаемые vs фактические из кода).
2. Проверь permissions.ts: can() для ключевых actions из §8.
3. Проверь SQL: inviter_can_assign_role, can_read_operational, can_read_financial.
4. Составь таблицу pass/fail и список багов с приоритетом.

Не исправляй код — только отчёт. Язык: русский.
```
