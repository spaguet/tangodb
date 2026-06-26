# Lessons

Ошибки и как их избежать в будущем.

## Формат записи

- **Дата:** YYYY-MM-DD
- **Ошибка:** что пошло не так
- **Причина:** почему это произошло
- **Как избежать:** что делать иначе

## Записи

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
