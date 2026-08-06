# Architecture

Структура проекта, слои, модули и ключевые потоки данных.

Обновлять при изменении архитектуры.

## Приложения

- `tangodb/` — основное приложение (React + Vite, TanStack Query, Zustand, Supabase)
- `tangodb-dev-console/` — админ-консоль (React + Vite, Supabase)

## Platform payment config

- `platform_payment_methods.config` — единый публично читаемый JSON-конфиг ручных способов оплаты для страницы лицензии CRM.
- Dev Console (`/payment-methods`) обновляет конфиг через Edge Function `dev-console-payment-methods` с developer-доступом.
- Загруженные QR оплаты хранятся в конфиге как небольшие `data:image/...` строки; CRM только отображает загруженные изображения и не генерирует QR на клиенте.
- `platform_purchase_requests` — входящие заявки из CRM после самостоятельной оплаты. CRM создаёт заявку через Edge Function `submit-purchase-request`; функция отправляет email разработчику при настроенном Resend и сохраняет заявку для Dev Console.
- Dev Console (`/inbox`) читает заявки через `dev-console-purchase-inbox`; после ручной проверки оплаты developer активирует lifetime-доступ организации, создаётся consumed lifetime key и обновляется `organization_licenses`.

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
- **Разовые групповые посещения:** отдельная финансово-операционная сущность `single_visits`, создаётся только через RPC `record_single_visit` из popup журнала посещений. Не моделировать как абонемент на 1 урок. `payments.single_visit_id` связывает поступление с визитом; тарифы имеют `prices.category = 'single_visit'` и используют те же `location_id` / `discipline_id` binding rules, что персональные тарифы. `record_single_visit` принимает опциональный `p_amount` — сумма к оплате, отличная от `prices.price` тарифа (договорная скидка); UI — редактируемое поле «Сумма» в `AttendancePanel`, по умолчанию заполняется ценой выбранного тарифа. Payroll считает разовые отдельно через `teacher_pay_rates.single_visit_rate_percent`, по умолчанию от группового процента.
- **Частичная оплата персонального урока:** `personal_lessons.paid_amount` — накопленная чистая сумма оплат (обновляется `sync_personal_lesson_paid_status` из `personal_lesson_net_payment`); `paid` становится `'yes'` только когда `paid_amount >= price` (для `price = 0` — не трогается, ручной флаг). `record_personal_lesson_payment` разрешает несколько платежей (топ-апов) на один урок, блокирует новый платёж только при `error_code: already_fully_paid`. `void_personal_lesson_payment` сторнирует все активные платежи урока, не только первый. `PayPersonalLessonModal` показывает «Оплачено» / «Долг» и подставляет остаток долга по умолчанию; `financial_debtors_v.amount` и `useScheduleDebtors` считают долг персонального урока как остаток (`price - paid_amount`), не полную цену.
- `supabase/` — миграции, RLS, edge functions

## RBAC / RLS (v2)

- **UI guards:** `tangodb/src/lib/permissions.ts` — удобство и навигация.
- **RLS — источник истины:** SQL-хелперы в `supabase/migrations/`.
- **Operational read** (`can_read_operational`): owner, director, admin — CRM-таблицы (clients, subscriptions, schedule и т.д.).
- **Financial read** (`can_read_financial`): owner, director, accountant — финансовый контур (таблица `payments` в R3).
- **Accountant** не получает SELECT на operational-таблицы; teacher — через scope-policies.
- **Settings/team:** `can_manage_settings()` / `can_manage_team()` — только owner, director.
- **Prices:** read `can_read_prices()` (owner, director, admin, accountant); write `can_manage_prices()` (owner, director).
- **Price archive:** `prices.status` (`active | archived`) + `created_at` / `archived_at`; обычный `usePrices` возвращает только active, поэтому архивный тариф недоступен в новых продажах. `list_archived_prices` возвращает tenant-scoped архив со счётчиком связанных `subscriptions` + `single_visits`, не раскрывая клиентские строки.
- **Data migration R2:** существующие `admin` → `owner`, чтобы не потерять доступ к settings/team.
- **Org overrides (§9):** boolean-флаги в `organization_settings` (`teachers_can_*`, `admin_can_*`); читаются в `permissions.ts` через `permissionOptionsFromSettings()` и в SQL через `can_export_data()`.
- **Export split (RBAC-8):** `can_export_data()` — operational dashboard CSV (owner/director; admin при `admin_can_export`; teacher при `teachers_can_export` + scope). `can_export_financial()` — owner/director/accountant. UI: `DataExportPage` — отдельные секции; accountant не грузит CRM-хуки.
- **Team payroll:** таблицы с legacy-префиксом `teacher_*` используются как контур зарплат команды. `teacher_pay_rates` хранит `pay_mode` (`percent` / `fixed` / `fixed_plus_percent`), `fixed_amount`, отдельные проценты для групповых и персональных уроков; `teacher_settlements` — начислено/выплачено по участнику за месяц; `teacher_settlement_payments` — выплаты и авансы. Начисления считаются через RPC `recalculate_teacher_settlement`, выплаты — только через `record_teacher_settlement_payment`; UI — `/finance/payroll` и блок настроек зарплаты в `MemberProfileModal`.
- **Внутренние расходы на зал:** `venue_cost_rule_versions` хранит immutable accepted-снимки правил с включительными периодами (`per_lesson`, `fixed_period`, `disabled`); per-lesson item может ограничиваться одновременно `discipline_id` и `location_id`, более специфичная пара имеет приоритет, а ссылки проверяются в tenant при save/accept. `lesson_occurrence_closures` фиксирует явное закрытие группового/персонального урока, `venue_cost_accruals` — append-oriented начисления и компенсирующие корректировки. Операционный admin/назначенный teacher может закрыть доступный урок, но сумма возвращается только financial-роли; reopen остаётся financial operation. Разрыв в покрытии создаёт `pending_unpriced`, который разрешается принятием покрывающего правила или `recalculate_pending_venue_costs`. `finance_cost_entries_v` и `get_finance_costs` объединяют ручные `expenses` с начислениями зала.
- **Venue-cost UI:** настройки `/settings/venue-costs` (`VenueCostsSettingsPage`, hooks `useVenueCosts`); expiry banner на Dashboard; payment ack через `VenueRulePaymentConfirmDialog` в продаже абонемента, разовом посещении, personal pay/sale; close-lesson кнопки в AttendancePanel (group), LessonInfoPopup и PersonalLessonRow; FinancialDashboard/FinanceExpensesPage читают `useFinanceCosts`; `useRecordPayment` soft-deprecated.
- **История закрытого personal lesson:** closure хранит стабильный `source_personal_lesson_id` и полный `source_snapshot`; nullable FK `personal_lesson_id` использует `ON DELETE SET NULL`. Поэтому канонические delete RPC не падают на FK, но финансовая/audit-история и защита от повторного active closure сохраняются.
- **Expiry acknowledgement:** если на дату нет покрывающей accepted-версии, учитывается последняя non-disabled версия с `valid_from <= date`; будущая accepted-версия не скрывает gap. Канонические payment RPC требуют `p_venue_rule_acknowledged=true`, подтверждение хранится только для каждого действительно нового payment. Legacy idempotency fingerprint без нового boolean принимается при `acknowledged=false`; ответ с уже существующим payment не создаёт задним числом acknowledgement.

## Org modules (module gate, Этап 1)

- **Хранение:** `organization_settings.modules` (JSONB), тип `OrgModules` в `types/organization.ts`.
- **Нормализация:** `normalizeOrgModules()` в `lib/orgModules.ts` — merge с defaults; `finance_basic` для старых org → `true`.
- **Ключи с UI-gate:** `group_subscriptions`, `personal_lessons`, `finance_basic`, `multi_discipline`, `locations`; `pair_subscriptions` / `trio_lessons` — только фильтр тарифов.
- **Точки gate:** desktop nav + mobile tabs (`App.tsx`), `PanelAccessRoute` (`routeGuards.tsx`), settings nav/redirect, financial tab на `/`, financial export в `DataExportPage`.
- **Не gate:** операционная оплата при продаже; RBAC и RLS не заменяются.

## i18n (S10)

- **Default locale:** `ru-RU`; переключатель в `GeneralSettingsPage` → `organization_settings.locale`.
- **Guest locale:** `localStorage` key `tangodb-locale-pref` (`setGuestLocale`) — auth/onboarding до выбора org; синхронизируется при сохранении общих настроек.
- **Структура:** `tangodb/src/lib/i18n/` — typed keys (`I18nKey`), словари `ru`/`en`/`vi`, `t(locale, key, params?)`, `pluralize`, `formatDateLocale`.
- **Хуки:** `useI18n()` (org locale), `useGuestI18n()` (auth flows); nav helpers: `getNavSections`, `getPanelTitle`, `getSettingsNav`, …
- **Правило:** UI-строки только через `t()`; данные пользователя (имена, названия дисциплин) не переводятся; CSV export headers — RU (отдельный этап при необходимости).

## Offline shift (CRM сценарий 11)

- **Снимок:** IndexedDB `tangodb-offline` → store `snapshots`, ключ `${userId}:${organizationId}`; окно −3…+7 дней от «сегодня», TTL 72 ч; обновляется после успешной онлайн-загрузки в `AttendancePanel`.
- **Очередь:** store `queues` — офлайн-отметки групповой посещаемости (`pending/syncing/applied/conflict/failed/cancelled`) и черновики оплат (напоминания без реквизитов).
- **Синхронизация:** RPC `sync_offline_mark_attendance` + `operation_idempotency` scope `offline_mark_attendance`; экран `OfflineReconciliationDialog`; cross-tab lock (`navigator.locks` / localStorage fallback).
- **UI:** `OfflineBanner` (режим офлайн, счётчики, ссылка на сверку), `OfflineLimitedState` (нет/просрочен снимок), `useOnlineStatus.justConnectionRestored`.
- **Безопасность:** `useOfflineSecurityReset` очищает данные при logout / смене org / user.

## Google Calendar sync (GCAL)

- **Outbox:** `calendar_sync_outbox` + `enqueue_calendar_sync` (триггеры на `personal_lessons`); worker — Edge Function `calendar-sync-worker`.
- **Claim:** RPC `claim_calendar_sync_jobs` — атомарный lease, `FOR UPDATE SKIP LOCKED`, дедуп по `(organization_id, dedupe_key)`.
- **Расписание (cron):** внешний scheduler или **Supabase Dashboard → Cron Jobs** с заголовком `x-cron-secret: <CRON_SECRET>` (как `purge-expired-demo-orgs`):
  - `calendar-sync-worker` — каждые **2 мин** (`POST`, body `{}`, опционально `batch_size`);
  - `calendar-reconcile-personal` — **каждый час** (`POST`, body `{}`) → RPC `run_personal_lessons_calendar_reconciliation` → enqueue `reconcile_member` на каждый активный binding с `sync_personal`.
- **Reconcile:** `execute_member_personal_lessons_reconcile` — будущие персоналки без link → upsert; stale links → delete. Ручной запуск: RPC `request_member_calendar_reconcile` (кнопка в Integrations).
- **Dead-letter:** `retry_calendar_sync_dead_job` — сброс `dead` → `pending` (owner/director — любая org-задача; teacher — только свои уроки).
- **Метрики:** `get_organization_calendar_sync_metrics`, `get_team_calendar_sync_metrics` (owner/director, для Prompt 8).
