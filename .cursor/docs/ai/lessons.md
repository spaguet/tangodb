# Lessons

Ошибки и как их избежать в будущем.

## Формат записи

- **Дата:** YYYY-MM-DD
- **Ошибка:** что пошло не так
- **Причина:** почему это произошло
- **Как избежать:** что делать иначе

## Записи

### 2026-08-07 — pg_cron calendar-sync-worker: 403 при успешной обработке

- **Дата:** 2026-08-07
- **Ошибка:** `net._http_response.status_code = 403`, body содержит и `ok:true, processed:N`, и `error: origin_not_allowed`
- **Причина:** `jsonResponse` требовал `Origin` из `ALLOWED_ORIGINS`; pg_cron/pg_net вызывают Edge Function без Origin, поэтому успешный ответ worker перезаписывался в 403
- **Как избежать:** для server-to-server вызовов (cron secret) не применять browser CORS gate к телу ответа; проверять `net._http_response.content`, а не только HTTP status

### 2026-08-07 — Integrations: boot overlay при ошибке Edge Function

- **Дата:** 2026-08-07
- **Ошибка:** на `/settings/integrations` toast «Failed to send a request to the Edge Function» и полноэкранное «Не удалось загрузить TangoDB»
- **Причина:** после GCAL Prompt 13 `GoogleCalendarFreebusySection` автоматически вызывала `google-calendar-list-calendars` при открытии страницы; любой сбой сети/функции давал `unhandledrejection`, а `main.tsx` трактовал **любой** rejection как фатальный boot error
- **Как избежать:** не вешать глобальный boot-overlay на `unhandledrejection`; Edge Function вызывать по действию пользователя; маппить transport-ошибки Supabase в i18n-ключи

### 2026-08-06 — event_session: дубли в Google при смене org/member binding

- **Дата:** 2026-08-06
- **Ошибка:** при смене `created_by` или org-level календаря мероприятия старый Google event и link оставались в прежнем binding
- **Причина:** `upsertEventSession` не вызывал очистку stale links (в отличие от personal/group, где есть `removeStaleLinks`)
- **Как избежать:** для multi-recipient sync использовать `removeStaleRecipientLinks` с актуальными member/org binding id перед upsert

### 2026-08-06 — Расходы: column expenses.payee does not exist

- **Дата:** 2026-08-06
- **Ошибка:** раздел «Расходы» падал с `column expenses.payee does not exist`
- **Причина:** фронт и хук `useExpenses` уже использовали поля `payee` / `document_number`, но миграция `20260889000001_expenses_payee_document.sql` не была применена к удалённой БД
- **Как избежать:** после добавления колонок в коде сразу прогонять `npm run db:push` (или убедиться, что миграция в CI/deploy)

### 2026-08-04 — sync_personal_lesson_paid_status могла сбросить paid='yes' для price=0 уроков

- **Дата:** 2026-08-04
- **Ошибка:** `sync_personal_lesson_paid_status` ставила `paid = CASE WHEN v_net > 0 THEN 'yes' ELSE 'no' END` без учёта `price`. Для урока, покрытого абонементом (`price = 0`, `paid` выставлен вручную в `'yes'` при создании без реальной строки `payments`), любой вызов синка (например, из `void_personal_lesson_payment`) обнулял бы `paid` в `'no'`, хотя реальных изменений оплаты не было.
- **Причина:** функция не различала «оплата урока с ценой» и «урок покрыт абонементом, цена 0» — оба случая сводились к одной и той же проверке `net > 0`.
- **Как избежать:** для `price = 0` не трогать `paid` в синке вообще (оставлять как есть); менять `paid` по `net`/`price` только когда `price > 0`. При реализации частичной оплаты (`paid_amount`) это учтено сразу в новой версии функции.

### 2026-08-03 — Idempotency key персонального урока: не UUID

- **Дата:** 2026-08-03
- **Ошибка:** при записи персонального урока с оплатой — `invalid input syntax for type uuid: "uuid:uuid"`
- **Причина:** `PersonalLessonSaleForm` передавал в RPC `p_idempotency_key` строку `${sessionKey}:${lessonId}`; PostgreSQL ожидает тип `uuid`
- **Как избежать:** для payment RPC с `p_idempotency_key uuid` использовать один `crypto.randomUUID()` на операцию; для пакета уроков — стабильный UUID на каждый `lessonId` (ref/map), как в `PayPersonalLessonModal`

### 2026-08-03 — Белый экран: Vite не инлайнит env через переменную

- **Дата:** 2026-08-03
- **Ошибка:** после деплоя белый экран, в консоли `supabaseUrl is required`
- **Причина:** в `supabase.ts` URL читался как `const env = import.meta.env; env.VITE_SUPABASE_URL` — Vite статически подставляет только прямой доступ `import.meta.env.VITE_*`
- **Как избежать:** всегда использовать `import.meta.env.VITE_FOO` напрямую в клиентском коде; не проксировать через объект/переменную

### 2026-08-02 — Касса аренды: не подменять finance.read голым payments.write

- **Ошибка (потенциальная):** выдать оплату аренды через `can("payments.write")` / `member_can_accept_payments()`.
- **Причина:** `restricted_admin` уже проходит `payments.write`; teacher может пройти `member_can_accept_payments()` при sell-флагах.
- **Как избежать:** канонический gate `rentals.payments.write` / `member_can_record_rental_payment()` = finance **или** (manage_rentals ∧ admin payment-accept); reception — только после явной политики этапа 12.

### 2026-07-31 — Finance: Cannot read properties of undefined (reading 'toLocaleString')

- **Ошибка:** раздел «Финансы» → «Коррекции» падал с `toLocaleString` на undefined.
- **Причина:** RPC `get_corrections_report` возвращает snake_case (`created_at`), а UI читал camelCase (`createdAt`) и передавал undefined в `formatDateTime`.
- **Как избежать:** маппить JSON из PostgREST/RPC в типы фронта; в `formatDateTimeLocale` / `formatCurrency` не вызывать Intl на null/undefined.

### 2026-07-31 — preview_calendar_event_conflicts: «Не удалось проверить конфликты»

- **Ошибка:** при создании мероприятия popup показывал «В это время уже есть занятия…» и «Не удалось проверить конфликты», хотя слот свободен.
- **Причина:** миграция `hall_rentals` вернула RPC `preview_calendar_event_conflicts(jsonb)` с одним аргументом; клиент вызывает `(p_sessions, p_exclude_event_id)` — PostgREST не находит подходящую функцию. Текст про конфликты показывался до результата проверки.
- **Как избежать:** при `CREATE OR REPLACE FUNCTION` не менять сигнатуру RPC, которую уже вызывает фронт; после добавления overload — `DROP` старых версий; UI preview — условный текст только при реальных конфликтах.

### 2026-07-30 — mark_attendance: cannot cast type record to subscriptions

- **Ошибка:** при отметке посещения в журнале — `cannot cast type record to subscriptions`.
- **Причина:** в `mark_attendance` переменная `v_sub` была объявлена как `RECORD`, но передавалась в `resolve_subscription_freeze_policy(p_sub subscriptions)`, который требует тип строки таблицы `subscriptions`.
- **Как избежать:** для RPC/функций с аргументом `table_name%ROWTYPE` или `table_name` всегда объявлять переменную как `subscriptions%ROWTYPE`, не `RECORD`.

### 2026-06-30 — Dev Console «Purge failed» при удалении demo org

- **Ошибка:** Dev Console показывал «Purge failed» при удалении demo org (например «Test studio»).
- **Причина:** S5 purge делает `DELETE FROM organizations` (CASCADE). Audit-триггеры на дочерних таблицах пытались `INSERT INTO audit_log` с `organization_id`, пока строка org уже удалялась → нарушение FK `audit_log_organization_id_fkey`.
- **Как избежать:** Перед org DELETE отключать `audit_%` триггеры (как в `reset_for_test_run.sql`), затем включать обратно. Альтернатива — не логировать DELETE в audit при отсутствующей org, но отключение триггеров проще и предсказуемее для полного purge.

### 2026-06-30 — Повторное сохранение группового урока и schedule_slot_overlap

- **Ошибка:** После «Сохранить» в редактировании группового урока изменения не видны; при повторной попытке — «Не удалось сохранить изменения; слот мог остаться закрытым: schedule_slot_overlap».
- **Причина:** Версионирование закрывало слот (`valid_to = editDate`) и создавало новую строку с `valid_from = editDate + 1`, но форма при повторном открытии брала закрытую версию по `lesson.slotId` и снова пыталась close+insert → пересечение с уже созданной активной версией. Откат `valid_to = null` тоже падал на overlap-триггере.
- **Как избежать:** В форме редактирования выбирать активную версию слота (`pickGroupSlotsForEdit`, при наличии — по `scheduleGroupId`). В `useEditGroupSchedule` при уже закрытом слоте обновлять successor или только insert без повторного close. Метаданные без смены дня/времени — прямой UPDATE активных слотов.

### 2026-06-28 — Прямой INSERT в payments при продаже абонемента

- **Ошибка:** Toast «new row violates row-level security policy for table "payments"» при продаже абонемента преподавателем; абонемент создавался.
- **Причина:** `useRecordSubscriptionPayment` вызывал прямой INSERT для всех ролей кроме `teacher`; при рассинхроне JWT/роли или старом bundle снова шёл client-side INSERT без INSERT policy на `payments`.
- **Как избежать:** Оплату абонемента всегда записывать через SECURITY DEFINER RPC `record_subscription_payment`; не дублировать INSERT в клиенте по роли.

### 2026-06-28 — Tenant trigger + teacher RLS на payments

- **Ошибка:** При продаже абонемента преподавателем toast «subscription_id does not belong to organization», хотя абонемент создавался успешно.
- **Причина:** RPC `record_subscription_payment` (SECURITY DEFINER) обходит RLS при INSERT, но BEFORE trigger `enforce_tenant_row_org_consistency` выполняется в контексте вызывающего пользователя; у teacher нет прямого SELECT на `subscriptions` (только view `subscriptions_teacher_v`), поэтому EXISTS в trigger возвращал false.
- **Как избежать:** Cross-table consistency triggers, которые проверяют FK по org_id, делать SECURITY DEFINER; authorization оставлять в RLS/RPC, а trigger — только integrity check без RLS.

### 2026-06-28 — Teacher invite без scope блокировал CRM

- **Ошибка:** Преподаватель принимал приглашение, становился членом команды, но видел «Нет доступа к обзору для вашей роли» и не мог пользоваться CRM.
- **Причина:** Форма приглашения не передавала `scope`; в БД сохранялся пустой scope, а RBAC трактует это как deny-by-default.
- **Как избежать:** Для роли teacher всегда показывать редактор scope при invite/edit; на backend для teacher без scope применять явный default (`all_disciplines/all_locations`), не полагаться на пустой JSON.

### 2026-06-28 — Recovery-code не должен блокировать создание tenant

- **Ошибка:** Self-service регистрация могла оставить пользователя в Supabase Auth без tenant, если Edge Function падала на генерации или хэшировании аварийного recovery-code.
- **Причина:** Recovery-code создавался до RPC `create_self_service_demo_org`; ошибка вспомогательного security-артефакта возвращала `Service unavailable` и останавливала основной provisioning.
- **Как избежать:** В post-confirm provisioning отделять обязательное создание org/member от необязательных артефактов восстановления: сбой recovery-code логировать и продолжать создание tenant, а UI должен вести существующий auth-профиль без org обратно в retry flow.

### 2026-06-28 — После self-service создания org не обновлялся браузерный JWT

- **Ошибка:** Регистрация могла создать demo org/member на backend, но пользователь не проходил дальше, потому что фронтенд оставался со старой Supabase-сессией без org-claims.
- **Причина:** `supabase.auth.refreshSession()` внутри Edge Function не обновляет refresh/access token в браузере; `RegisterPage` после `createDemoOrganization()` сразу переходил дальше без клиентского refresh и reload org context.
- **Как избежать:** После backend provisioning, который меняет active org/JWT claims, всегда обновлять браузерную Supabase-сессию и refetch organization context перед навигацией.

### 2026-06-27 — parseTelegramAuthError не переводил «Authentication failed»

- **Ошибка:** Пользователь видел «Authentication failed» (на английском) вместо локализованного сообщения при ошибке Telegram-авторизации.
- **Причина:** `parseTelegramAuthError` в `AuthProvider.tsx` не имел кейса для `"Authentication failed"` / `"Service unavailable"` / `"Could not create demo organization"` — все эти строки возвращались as-is.
- **Как избежать:** Для каждой возможной backend-ошибки в `parseTelegramAuthError` и `parseAuthError` добавлять явный маппинг или общий fallback на `auth.error.generic`; не полагаться на то, что backend вернёт локализованную строку.



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

### 2026-06-28 — Dev Console orphan cleanup «Cleanup failed»

- **Ошибка:** Удаление orphan-пользователей в Dev Console падало с «Cleanup failed».
- **Причина:** После добавления `p_user_ids` осталась перегрузка `dev_console_cleanup_orphan_auth_users(uuid, boolean)` — PostgREST/RPC неоднозначность. Плюс FK `organizations.owner_user_id`, `access_keys.created_by`, `platform_audit_log.actor_user_id` блокировали `DELETE FROM auth.users` у бывших owner с inactive membership.
- **Как избежать:** При расширении сигнатуры RPC — `DROP FUNCTION` старой перегрузки в той же или следующей миграции. Перед purge auth user сбрасывать все NO ACTION ссылки на `auth.users`. Проверять реальные колонки таблицы (`self_service_demo_challenges.owner_email_hash`, не `user_id`).

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
