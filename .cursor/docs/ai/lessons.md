# Lessons

Ошибки и как их избежать в будущем.

## Формат записи

- **Дата:** YYYY-MM-DD
- **Ошибка:** что пошло не так
- **Причина:** почему это произошло
- **Как избежать:** что делать иначе

## Записи

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
