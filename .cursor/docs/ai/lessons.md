# Lessons

Ошибки и как их избежать в будущем.

## Формат записи

- **Дата:** YYYY-MM-DD
- **Ошибка:** что пошло не так
- **Причина:** почему это произошло
- **Как избежать:** что делать иначе

## Записи

### 2026-06-27 — Telegram ID хранился в разных форматах

- **Ошибка:** Вход из Telegram Mini App мог завершаться `Authentication failed`, если старый профиль был привязан не строковым `app_metadata.telegram_id`, а числовым ID, `user_metadata.telegram_id` или значением в `organization_members.telegram`.
- **Причина:** `telegram-auth` сравнивал только строковый `app_metadata.telegram_id` и username fallback, не учитывая числовой ID и `tg://user?id=...`.
- **Как избежать:** Для внешних идентификаторов всегда нормализовать все поддержанные форматы хранения и искать по canonical ID + username fallback перед созданием synthetic user.

### 2026-06-27 — Verify email был тупиком после сбоя создания демо

- **Ошибка:** После регистрации пользователь мог попасть на `/auth/verify-email` с `Service unavailable` и текстом про подтверждённый email без действия для восстановления.
- **Причина:** Автосоздание демо-CRM выполнялось один раз; после ошибки страница показывала fallback-текст без кнопки retry, а backend-ошибка не локализовалась.
- **Как избежать:** Для post-auth provisioning добавлять повторяемое действие и переводить известные edge-function ошибки через `parseAuthError`.

### 2026-06-27 — ON CONFLICT без предиката partial unique index

- **Ошибка:** При «Отметить и оплатить» RPC `record_single_visit` падал с «there is no unique or exclusion constraint matching the ON CONFLICT specification».
- **Причина:** В `payments` уникальность по `(organization_id, single_visit_id)` задана partial index с `WHERE single_visit_id IS NOT NULL`, а `INSERT ... ON CONFLICT (organization_id, single_visit_id)` не указывал тот же предикат.
- **Как избежать:** Для partial unique index в `ON CONFLICT` всегда повторять `WHERE`-условие индекса; для новых upsert-паттернов сверять определение индекса и conflict target.

### 2026-06-27 — Native validation оставалась на языке браузера

- **Ошибка:** В английском UI форма добавления клиента показывала системное «Заполните это поле.».
- **Причина:** `required` блокировал `onSubmit` до локализованной проверки, а язык native validation зависит от окружения браузера.
- **Как избежать:** Для кастомных i18n-форм использовать `noValidate` и показывать ошибки через `t()`, либо явно задавать custom validity на каждый required field.

### 2026-06-27 — Старый Telegram-профиль не находился без app_metadata.telegram_id

- **Ошибка:** Пользователь с существующим email-профилем мог получить `Authentication failed` при входе через Telegram.
- **Причина:** `telegram-auth` искал auth user только по `app_metadata.telegram_id` или synthetic `tg_*@tangodb.auth`; старые профили команды с заполненным Telegram username, но без metadata, не подхватывались.
- **Как избежать:** При Telegram-login сначала искать по metadata, затем fallback по нормализованному `organization_members.telegram`, после успешного совпадения синхронизировать `app_metadata.telegram_id`.

### 2026-06-27 — Payroll показывал только преподавателей

- **Ошибка:** В «Зарплаты» owner/director/admin/accountant не попадали в таблицу и начисления, даже если проводили уроки или им нужен оклад.
- **Причина:** UI фильтровал `role === "teacher"`, RPC `recalculate_teacher_settlement` проходил только по teacher, а tenant trigger запрещал ставки не-teacher.
- **Как избежать:** Зарплатный контур должен опираться на `organization_members`, а не на роль teacher. Если поле называется legacy `teacher_*`, явно документировать расширенную семантику и проверять все роли в UI + RPC + trigger.

### 2026-06-27 — Нельзя было записать аванс члену команды

- **Ошибка:** Выплата сверх начисленного блокировалась в UI и БД, поэтому авансы приходилось обходить через «Расходы» без привязки к человеку.
- **Причина:** `teacher_settlements` имел CHECK `amount_paid <= amount_accrued`, а `RecordPaymentModal` запрещал сумму больше остатка.
- **Как избежать:** Для payroll с авансами хранить выплаты как ledger/payment rows и разрешать `amount_paid > amount_accrued`; в UI показывать отрицательный остаток как аванс.

### 2026-06-26 — Forgot password раскрывал существование email (S8)

- **Ошибка:** `ForgotPasswordPage` показывал ошибку Supabase (`User not found` и т.п.), если email не зарегистрирован.
- **Причина:** Ошибка пробрасывалась из `resetPasswordForEmail` в UI.
- **Как избежать:** Всегда показывать нейтральное сообщение «Если аккаунт существует…»; не отображать auth-ошибки на public recovery forms (§8.8).

### 2026-06-26 — Dev Console PostgREST search injection (S7)

- **Ошибка:** `dev-console-search-orgs` и `dev-console-search-billing` вставляли raw user query в `.or(\`name.ilike.%${q}%\`)` — символы `,`, `(`, `)`, `%`, `_` ломали фильтр или расширяли ilike.
- **Причина:** Быстрый MVP-поиск без экранирования; в `dev-console-list-tenants` sanitize был частичным (без `,()`).
- **Как избежать:** Общий `_shared/postgrestSearch.ts`: `sanitizePostgrestSearchTerm` + `buildIlikeOrFilter`; email-поиск — только через RPC `dev_console_user_ids_by_email`.

### 2026-06-26 — ACTIVATION_DEBUG default true (S7)

- **Ошибка:** Edge Function `activate-access-key` по умолчанию возвращала `debug` с SQL/RPC message клиенту (`ACTIVATION_DEBUG ?? "true"`).
- **Причина:** Debug включён для локальной разработки и не переключён перед production hardening.
- **Как избежать:** Default `"false"`; явный `ACTIVATION_DEBUG=true` только в local `.env`; audit metadata без `message` когда debug off.

### 2026-06-26 — activate_access_key overload ambiguity после S5

- **Ошибка:** `function activate_access_key(text, unknown) is not unique` при вызове с двумя аргументами; `db push` fix-миграции падал с `input parameters after one with a default value must also have defaults`.
- **Причина:** Одновременно существовали SQL-обёртка `activate_access_key(text, text)` и PL/pgSQL `(text, text, uuid DEFAULT NULL)` — PostgreSQL не выбирает перегрузку. Попытка убрать DEFAULT только у 3-го параметра нарушила правило DEFAULT-параметров.
- **Как избежать:** Один публичный overload `activate_access_key(text, text DEFAULT NULL, uuid DEFAULT NULL)`; `DROP FUNCTION activate_access_key(text, text)` перед заменой. Не дублировать 2-arg wrapper при 3-arg с defaults.

### 2026-06-24 — Удаление группового слота оставляло занятие в сетке

- **Ошибка:** После «Удалить» в popup группового урока toast показывал успех, но блок оставался в расписании на выбранную дату.
- **Причина:** `useDeleteScheduleSlot` ставил `valid_to = дата занятия`, а `expandSlotsToWeek` показывает слот включительно до `valid_to` (`dateISO > validTo`).
- **Как избежать:** При удалении с даты E закрывать слот как `valid_to = E - 1 day`; если слот начался в E — hard delete. Не путать с edit-версионированием, где старая версия видна включительно E.

### 2026-06-22 — «1 800 000 ₫» в блоке неоплаченных уроков

- **Ошибка:** В шапке блока долгов отображалось «1 800 000 ₫» при одном уроке за 800 000 ₫.
- **Причина:** Количество (`1`) и сумма (`800 000 ₫`) стояли рядом без подписей — визуально сливались в одно число.
- **Как избежать:** Для пар «количество + сумма» всегда использовать подпись или разделитель (`1 урок · 800 000 ₫`), не голые числа.

### 2026-06-22 — PostgREST join personal_lessons → clients на /schedule

- **Ошибка:** «Could not find a relationship between personal_lessons and clients in the schema cache» при загрузке расписания.
- **Причина:** v2 composite FK `(organization_id, client_id1)`; синтаксис `clients!client_id1` работает только с простым FK на `clients.id`.
- **Как избежать:** Не embed-join clients в SELECT personal_lessons; имена через `useClientDirectory` + `enrichLessonClientDisplay` (уже было в коде, join — лишний).

### 2026-06-22 — useEditGroupSchedule без rollback при failed INSERT

- **Ошибка:** При ошибке INSERT новой версии слота старая запись оставалась с `valid_to = editDate`, занятие исчезало из расписания без замены.
- **Причина:** Два последовательных запроса Supabase без транзакции; rollback не выполнялся.
- **Как избежать:** При failed INSERT восстанавливать `valid_to = NULL` у исходного слота; для атомарности — RPC/транзакция в БД.

### 2026-06-22 — paid всегда «no» у teacher в usePersonalLessons

- **Ошибка:** Все персональные уроки преподавателя отображались с красной рамкой (долг), статус оплаты в попапе всегда «Не оплачен».
- **Причина:** `mapPersonalLesson` при `maskFinancial` принудительно ставил `paid: "no"`; view `personal_lessons_teacher_v` не включал колонку `paid`.
- **Как избежать:** Маскировать только `price`, не `paid` (операционный статус); добавить `paid` в teacher view без `price`. Новую колонку во view — только в конец SELECT (PostgreSQL 42P16).

### 2026-06-20 — Settings guards с неполными PermissionOptions (RBAC-2)

- **Ошибка:** Прямой URL `/settings/data` при `admin_can_export=true` редиректил, хотя пункт был в nav `SettingsLayout`.
- **Причина:** `routeGuards.tsx` и `SettingsIndexRedirect.tsx` собирали options вручную — только `scope`, `teachersCanManageDisciplines`, `isReadOnly`; без `adminCanExport`, `restrictedAdmin` и др.
- **Как избежать:** Для любой проверки прав использовать `permissionOptionsFromSettings()` — один источник с `usePermissions` и `SettingsLayout`. Добавлять regression в `assertReceptionPermissions()`.

### 2026-06-19 — Приглашение преподавателю не приходит на email

- **Ошибка:** После отправки приглашения в «Настройки · Команда» письмо не приходит на почту преподавателя.
- **Причина:** `sendInviteEmail` в Edge Function `invite-member` была заглушкой (только console.log, `return false`).
- **Как избежать:** Для prod задать `RESEND_API_KEY` и `EMAIL_FROM` в secrets Supabase; UI показывает ссылку и предупреждение, если `email_sent === false`.

### 2026-06-19 — Групповой абонемент виден в журнале другой дисциплины

- **Ошибка:** Клиент с абонементом на «Танго» отображался в журнале посещений группового урока «Бальные танцы».
- **Причина:** `computeSubsForDate` фильтровал только по `category: "group"`, без `disciplineId`; `computeScheduleDatesForMonth` не передавал дисциплину слота расписания в журнал.
- **Как избежать:** При открытии группового урока в журнале передавать `disciplineId` слота в фильтр абонементов; в RPC `mark_attendance` проверять совпадение дисциплины при переданном `p_discipline_id`.

### 2026-06-19 — subscriptions_check при продаже абонемента

- **Ошибка:** `new row for relation "subscriptions" violates check constraint "subscriptions_check1"`.
- **Причина:** v2 CHECK требует `pair_month IN ('', 'm1', 'm2', 'm3')` и `type IN ('solo', 'pair', 'pair_hm')` для групповых. Код записывал `pair_month = "1"` вместо `"m1"`, а кастомные тарифы `tariff_*` попадали в поле `type` как есть.
- **Как избежать:** Маппить price.type → subscription.type/pair_month явно; в БД pair_month только с префиксом `m`.

### 2026-06-19 — invalid input syntax for type uuid: "8" при продаже абонемента

- **Ошибка:** При нажатии «Продать абонемент» Supabase возвращал `invalid input syntax for type uuid: "8"`.
- **Причина:** В v2-схеме `disciplines.id`, `prices.id`, `subscriptions.discipline_id` и `price_id` — UUID. Фронтенд использовал `parseInt()` в `<select>`; для UUID вида `8f3b2c1a-...` parseInt возвращал `8`.
- **Как избежать:** ID из Supabase v2 хранить как `string` (UUID), не приводить к `number` и не использовать `parseInt` для значений `<option value>`.

### 2026-06-19 — Перезагрузка при «Новая дисциплина» в форме расписания

- **Ошибка:** Кнопка «Подтвердить» в модалке «Новая дисциплина» перезагружала страницу, дисциплина не сохранялась.
- **Причина:** `<form>` модалки рендерилась внутри `<form>` «Внести новое занятие» (через `DisciplineSelect`). Вложенные формы в HTML недопустимы — submit попадал во внешнюю форму.
- **Как избежать:** Модалки с собственной формой рендерить через `createPortal(..., document.body)`, чтобы DOM-форма не была вложена в родительскую.

### 2026-06-19 — RLS при создании дисциплины

- **Ошибка:** `new row violates row-level security policy for table "disciplines"` при «Новая дисциплина».
- **Причина:** INSERT без `organization_id`; RLS WITH CHECK требует `organization_id = auth_organization_id()` (та же проблема, что у prices).
- **Как избежать:** При INSERT в tenant-таблицы всегда передавать `organization_id` из `useOrgQueryScope`; для таблиц без явного DEFAULT — добавить `ALTER COLUMN organization_id SET DEFAULT auth_organization_id()`.

### 2026-06-19 — RLS при создании тарифа

- **Ошибка:** `new row violates row-level security policy for table "prices"` при добавлении тарифа.
- **Причина:** INSERT без `organization_id`; RLS WITH CHECK требует `organization_id = auth_organization_id()`. Дополнительно CHECK в v2-схеме не пропускал типы `tariff_*`.
- **Как избежать:** При INSERT в tenant-таблицы всегда передавать `organization_id` из `useOrgQueryScope`; для prices — держать CHECK в sync с `generateTariffTypeKey()`.
