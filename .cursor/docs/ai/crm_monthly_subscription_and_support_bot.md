# Месячная подписка CRM + платформенный Telegram-бот уведомлений

Спека узла: **ручная ежемесячная подписка на CRM** тем же рельсом, что пожизненная лицензия, плюс **outbound-бот разработчику** для уведомлений о заявках на оплату, новой базе и обращениях поддержки из CRM.

Статус: **S3a закрыт, можно S3b** — проверенный черновик + промпты **§16** (сверка с кодом **2.10.39**, повтор 2026-09-11: RLS `suspended` только owner, «S9»≠аудит S09, quote без выбора способа, T−7 только S4; **S0** 2026-09-11: §11 п. 1–3, 8–9, 12 + дефолты 4–5, 10–11; **S1** 2026-09-11: контракт цен v2 + Dev Console). Снимок: `APP_VERSION` / `package.json` = **2.11.5** (после S3a). Подверсия **2.11** открыта (VER-1); каждый следующий код-номер — микропатч `2.11.y`; S7 — лендинг + `decision_log.md` + `architecture.md`. **Платформенный Telegram-бот — в скоупе v1, подключать в S5a+S5b** (решение владельца 2026-09-11; отдельный бот BotFather, не студийный): outbound-only в один `telegram_chat_id` (группа предпочтительна, личка допустима), без webhook и без чата с пользователями CRM; до настройки бота заявки и email не блокируются (Telegram-строка outbox = `blocked`). Паттерн outbox: `renter_telegram_miniapp.md` (§ outbox), но таблицы/токен/worker — отдельно (§1.4). Промпты агента — **§16** (один новый чат = один номер S*).

**Очередь §16** (линейно: следующий номер только после DoD предыдущего; «Этап 2/3/5» — заголовки, не параллельный запуск). Галочку после DoD ставь **здесь и в §16 «Последовательность промптов»**:

- [x] **S0** — закрыть блокеры §11 п. 1–3, 8–9, 12 (только документ)
- [x] **S1** — контракт цены v2 + Dev Console/backfill + **2.11.0**
- [x] **S2a** — SQL: quotes, kind, hold, anchor, submit/activate RPC
- [x] **S2b** — Edge `create-purchase-quote` + `submit-purchase-request`
- [x] **S2c** — атомарный Inbox Activate month/lifetime + Billing
- [x] **S2d** — RLS: отозвать authenticated INSERT заявок
- [x] **S3a** — RBAC/гейты/waitlist/`LicenseRequired` (панель покупки ещё не monthly)
- [ ] **S3b** — CRM UI: SKU → quote → submit
- [ ] **S4** — cron expire + effective `isReadOnly` + T−7
- [ ] **S5a** — outbox + worker + email заявок в outbox
- [ ] **S5b** — Detect/Save/Send test + `org_created` + digest enqueue
- [ ] **S6** — тикеты login/forgot/шапка
- [ ] **S7** — лендинг + architecture + decision_log

Связанное: `architecture.md` (Platform payment config), `decision_log.md` (`PAY-INBOX-1`, `PAY-QR-1`, `HALL-RENT-SELF-1/2`), страница лицензии `/settings/license`, Dev Console `/payment-methods` `/inbox` `/billing`.

**Не путать:** абонемент ученика (`subscriptions`, `billing_model = monthly_unlimited`) — другой контур. Здесь только **SaaS-доступ организации** к CRM.

---

## 0. Цель одной фразой

Демо-студия **до `data_purge_at`** выбирает **пожизненно** или **ежемесячно**, платит по тем же QR/счетам и пишет заявку в CRM; разработчик видит её в Telegram и активирует доступ в Dev Console. Новую заявку после `data_purge_at` принимать нельзя: база может быть удалена в любой момент. Для заявки, отправленной вовремя, нужен ограниченный review-hold (§4.2), иначе strict purge удалит и org, и заявку через `ON DELETE CASCADE`. Параллельно из CRM/экранов входа уходят уведомления разработчику: новая база, не могу войти, письмо сброса не пришло, произвольное сообщение.

Автосписания карты **нет**. Stripe **не включать**.

---

## 1. Как сейчас (снимок 2.10.39)

### 1.1. Пожизненная лицензия — живой рельс

Это канон, который нужно **расширить**, а не заменить.

```
CRM /settings/license?purchase=1
  → ManualPurchasePanel
      QR / банк / VN / МИР / crypto из platform_payment_methods.config
      PurchaseRequestPanel (комментарий ≥ N символов, email, Telegram)
  → Edge submit-purchase-request
      INSERT platform_purchase_requests (request_kind = crm_license)
      email разработчику (contacts.email или секрет DEVELOPER_NOTIFY_EMAIL)
  → Dev Console /inbox
      Activate full access
      consumed access_keys.key_type = lifetime
      organizations.status = licensed
      organization_licenses.license_type = lifetime
```

Правила:

- Реквизиты — JSON `platform_payment_methods` (id = 1), публичный SELECT для JWT. QR = `data:image/...` в конфиге (`PAY-QR-1`).
- Сумма lifetime сейчас лежит **в каждом способе** (`amount` + `currency` у crypto / bank / VN / MIR).
- Edge сейчас принимает заявку от **owner и director** (`organization_members.role`), но CRM UI оборачивает `ManualPurchasePanel` / waitlist / форму ключа в owner-only `license.activate` — **director сегодня не видит покупку в интерфейсе**, хотя API уже разрешает. В целевой модели: `license.purchase` (owner/director) и `license.activate` (только owner; ввод `TDB-LIFE-…`). Renter JWT отказан.
- `submit-purchase-request` принимает `request_kind` из тела клиента (только `crm_license` | `renter_miniapp_addon`); `crm_subscription` и server quote в коде **ещё нет** — целевая модель §3.2–§4.2.
- Ключ lifetime показывается **один раз** в ответе Inbox; пользователь может не вводить ключ — org уже licensed.
- Telegram/WhatsApp/email в шапке CRM и на лицензии — **ссылки** (`https://t.me/omow_second`), не бот.

Ключи кода: `LicenseSettingsPage`, `ManualPurchasePanel`, `PurchaseRequestPanel`, `submit-purchase-request`, `dev-console-purchase-inbox`, `PaymentMethodsPage`, `tangodb/src/lib/paymentConfig.ts` + копия в `tangodb-dev-console/src/lib/paymentConfig.ts`.

### 1.2. Месячная подписка — заготовка, UI закрыт

В БД и SQL узел **уже заложен**, в продукте для клиента — нет.

| Слой | Есть | Что делает сейчас |
|---|---|---|
| Таблица `organization_subscriptions` | да | 1 строка на org; `billing_period` monthly\|yearly; `status` active\|past_due\|canceled; `provider` default **stripe** |
| RPC `sync_organization_subscription` | да | upsert подписки, пишет `organization_licenses.license_type = subscription`, при active → `licensed`, при canceled → `suspended`; **не трогает** lifetime (grandfathering) |
| `organization_allows_writes` | да | `NOT schema_version_locked` **и** ((`demo_active` и (`demo_expires_at IS NULL` или `> now()`)) **или** (licensed **и** (lifetime **или** active subscription с `period_end > now()`))) |
| UI `LicenseSettingsPage` | да | умеет показать статус подписки / past_due; покупка = `SubscriptionWaitlistCard` («Stripe скоро») |
| Edge `create-subscription-checkout` + `stripe-webhook` | да | не подключены к UI |
| Dev Console `/billing` | да | поиск org + ручной adjust статуса **если строка подписки уже есть** |
| Waitlist `platform_waitlist` | да | email «уведомить о запуске» |

Вывод: SQL-гейт Mini App (`renter_miniapp_addon_is_active`, HALL-RENT-SELF-2) **уже** считает «licensed + lifetime **или** active CRM subscription». Месячной продажи просто нет — гейт ждёт этот узел.

Критичные долги заготовки:

- CHECK `platform_purchase_requests.request_kind` в БД сейчас только `crm_license` | `renter_miniapp_addon`; **`crm_subscription` добавить миграцией** вместе с quote/snapshot полями. Trigger `platform_purchase_requests_kind_guard` пускает authenticated INSERT только как `crm_license`.
- `parseManualPaymentConfig` не знает `schemaVersion` / `crmLifetime` / `crmMonthly` (неявный v1); целевой контракт — §3.2 `schemaVersion: 2`. У crypto нет стабильного `id` — только coin/network/address; индекс массива нельзя считать method code.
- `PurchaseRequestPanel` kind **не** передаёт. Хук `useSubmitPurchaseRequest` **всегда** кладёт `request_kind` в тело (`input.requestKind ?? "crm_license"`). Edge принимает только `crm_license` | `renter_miniapp_addon` и иначе форсит `crm_license`. Целевое тело submit — `quote_id` + `client_request_id`, без kind/суммы с клиента (§4.1). Не «прокидывать `requestKind`».
- `organization_has_active_subscription` считает `current_period_end IS NULL` бессрочной активной подпиской. Для manual это недопустимо: активация месяца обязана требовать непустые `period_start`/`period_end`.
- `sync_organization_subscription` обновляет entitlement, но не переводит заявку Inbox в `activated` в той же транзакции. При `status=canceled` и **ещё не** lifetime — ставит `organizations.status = suspended`. Апгрейд month→lifetime обязан сначала записать lifetime, иначе эта функция подвесит org (§8.36).
- Текущая lifetime-активация в `dev-console-purchase-inbox`: несколько независимых записей (key → org → license → request). Повтор уже `activated` сейчас **HTTP 400** `request_already_activated`, а не идемпотентный 200 без plaintext. Новый узел чинит обе ветки.
- Inbox UI `defaultPeriod()` и Edge `defaultAddonPeriod()` для add-on — 1-е…последний день **текущего UTC-месяца**, date-only. Это **не** канон CRM-месяца §2.3; Activate month не копировать ни UI, ни Edge-хелпер.
- Self-service demo (S5): при создании `data_purge_at = demo_expires_at` (+30 дней); `run_demo_lifecycle` **больше не переводит** в `demo_retention` (только уведомления). Статус `demo_retention` и ветка UI на лицензии — legacy/старые org; `purge_expired_demo_organizations` всё ещё purge'ит `demo_active` **и** `demo_retention` по `data_purge_at`. Purge **уже** пропускает org с lifetime или subscription `active|past_due`, но **не** пропускает pending `platform_purchase_requests` (CASCADE).
- `OrganizationProvider.isReadOnly` сегодня = `demo_retention` **или** истёкший `demo_active` **или** (`licensed` + `license_type=subscription` + `subscription.status=past_due`). Не включает: (a) `licensed` + subscription `active`, но `current_period_end <= now()`; (b) `organizations.status = suspended` после grace.
- **`license.activate` входит в `WRITE_ACTIONS`**: при любом `isReadOnly` (в т.ч. `demo_retention` и `past_due`) `RequirePermission` скрывает и покупку, и поле ключа. Без исключения для `license.purchase` / `license.activate` recovery-покупка после демо/месяца в UI мертва, хотя Edge заявку ещё принимает.
- `LicenseSettingsPage`: `showManualPurchase = purchase=1 && isDemo` — лицензированная monthly-орг **не видит** форму оплаты/продления. `useDemoLicenseUi.showPurchaseCta` тоже только demo. `canSubscribe` прячет waitlist у `suspended`. Обработчик `?checkout=success|cancelled` — мёртвый Stripe-хвост.
- `LicenseRequiredPage` / `ReadOnlyBanner` — копирайт про конец **демо**; нет варианта «истёк месяц / suspended». `LicenseRequiredPage`: CTA покупки owner/director; ссылка activate-key **всем** ролям; «назад в CRM» всегда. `OrgWorkspaceRoute` **не** читает `organization.status` и **не** гоняет `suspended` на `/license-required`.
- Policy `organizations_select_member`: SELECT если `organization_allows_reads` **или** (`status=suspended` **и** роль **owner**). Director/admin/teacher/accountant при suspended **не** видят строку org → `organization = null`, из статуса редирект не посчитать. SELECT `organization_licenses` / `organization_subscriptions` / `organization_settings` всегда требует `organization_allows_reads` — даже owner при suspended не читает entitlement. Recovery UI без узкого RLS-исключения (S3a) для director мёртв, для owner — без периода/типа лицензии.
- Drain студийного Telegram — Edge `renter-booking-worker` + `_shared/renterTelegramOutboxDrain.ts` (AES-токен студии). Платформенный worker **не** встраивать туда; HTTP `sendMessage` без `parse_mode` можно повторить общим хелпером с **другим** источником токена.

### 1.3. Контакты и «поддержка» сейчас

- Шапка CRM: Email / Telegram / WhatsApp из конфига.
- Экраны login / register / forgot-password: mailto `omowdance@gmail.com` (`AuthDeveloperContact`).
- Заявка на оплату: только email разработчику, без Telegram.
- Создание демо-базы (`create-self-service-demo-org`): **без** уведомления разработчику.
- Забыл пароль: GoTrue `resetPasswordForEmail` + Turnstile. Связи с разработчиком нет, кроме mailto.
- Вход через Telegram для команды CRM **удалён** (changelog 2026-07-05). Не возвращать.

### 1.4. Три Telegram-канала, которые нельзя смешивать

| Бот | Чей | Зачем |
|---|---|---|
| Бот студии | tenant, токен в CRM настроек Mini App | кабинет арендатора, алерты в чат студии, `renter_telegram_outbox` |
| Личка/группа разработчика `t.me/omow_second` | человек | ручной чат по ссылке |
| **Платформенный бот TangoDB** | **ещё нет в коде; подключаем в S5** | **этот документ (§5): outbound в один chat_id; не путать со студийным ботом** |

Студийный бот арендатора **запрещено** использовать для заявок на лицензию CRM, логина команды и «забыл пароль». Иначе арендатор студии A получит чужие PII, а токен студии утечёт в платформенный контур.

### 1.5. Mini App add-on — не трогать как продукт

`config.renterMiniappAddon` и Inbox-ветка `renter_miniapp_addon` сохранены, новых заявок нет (`addon_purchase_disabled`). Гейт Mini App = купленный CRM. Отдельную ежемесячную цену модуля **не** включать вместе с этим узлом.

---

## 2. Целевая модель продукта

### 2.1. Два SKU, один рельс оплаты

| SKU | Код заявки | Что покупает | Как активировать |
|---|---|---|---|
| Пожизненная лицензия | `crm_license` | `organization_licenses.license_type = lifetime`, `expires_at = null` | как сейчас: consumed lifetime key + licensed |
| Месячная подписка | `crm_subscription` | `organization_subscriptions` provider=`manual`, period 1 месяц, `organization_licenses.license_type = subscription` | **без** lifetime-ключа; atomic activate RPC → entitlement sync |

Реквизиты (QR, IBAN, карта, crypto-адрес) **одни**. Отличается только **сумма** на экране и kind заявки.

Годовой план в этом узле **не запускать** (yearly в схеме оставить, UI year-кнопку waitlist убрать). Stripe не включать; Edge checkout/webhook не удалять — заморозить.

### 2.2. Кто может купить / продлить

Права разделить по смыслу:

- `license.view` — owner/director (так устроен текущий `/settings/license`);
- новое `license.purchase` — owner/director: увидеть реквизиты и отправить заявку;
- `license.activate` — только owner: ввести `TDB-LIFE-…` вручную.

`license.purchase` и `license.activate` — платформенные entitlement-действия, не запись в tenant business data. **Оба убрать из `WRITE_ACTIONS`** (сейчас там только `license.activate`): иначе `isReadOnly` прячет покупку и ключ на `demo_retention` / `past_due`. Не включать их в общий список, заблокированный read-only. Edge/RPC по-прежнему проверяют роль и renter. Не расширять `/settings/license` на teacher/admin/accountant в этом узле: UI не показывает им цены/реквизиты/форму. Это UX/RBAC-gate, не обещание секретности: `platform_payment_methods` остаётся platform-level конфигом, читаемым authenticated JWT. Если реквизиты понадобится скрыть как секрет, это отдельная смена контракта на role-gated Edge projection. Developer-активация из Inbox не зависит от роли отправителя заявки после серверной проверки его active membership.

**Director vs owner:** director может отправить заявку (`license.purchase`); ввод lifetime-ключа и Dev Console-активация для клиента остаются owner-only (`license.activate` как сейчас в `permissions.ts`).

Lifetime-орг **не** предлагать месячную (уже дешевле в долгую и дедлок: `sync_organization_subscription` не понижает lifetime).

Месячная орг **может** апгрейднуть в lifetime тем же рельсом `crm_license` / полем ключа `TDB-LIFE-…`. После lifetime строка подписки: `canceled` (чтобы Billing не думал, что надо ждать платёж).

### 2.3. Календарь периода (канон; S0 фиксирует §11 п. 1–3, иначе не начинать S2)

Рекомендация:

- Интервал entitlement — полуоткрытый: `[period_start, period_end)`. В момент `period_end` запись уже запрещена. UI показывает **дату и время** конца (локаль пользователя), не «день целиком»: иначе «до 11 октября» читается как весь 11-й день.
- Старт первой активации = серверный `now()` в момент подтверждения разработчиком, не дата клиентского браузера и не 1-е число. **Не** копировать Inbox `defaultPeriod()` add-on (1-е…конец текущего UTC-месяца).
- TZ хранения: **UTC** в `timestamptz`; UI только форматирует в локаль пользователя.
- Конец = один календарный месяц с сохранением исходного дня-якоря. Для старта 31 января последовательность концов — 28/29 февраля, 31 марта, 30 апреля; обычное последовательное `timestamp + interval '1 month'` здесь непригодно, потому что после февраля дрейфует на 28-е.
- Добавить `billing_anchor_day smallint CHECK (1..31)` либо эквивалентный серверный helper с сохранённым anchor. Даты считает только БД.
- Продление до `period_end`: `period_start` текущего entitlement не меняется, `period_end` сдвигается ещё на один месяц по anchor. Продление после `period_end`: новый `period_start = now()`, anchor вычисляется заново, `period_end = add_calendar_month(now(), anchor)`.
- После `period_end` **запись уже закрыта SQL** (`organization_has_active_subscription` / `organization_allows_writes`). Статус `past_due` выставляет cron (§4.5) — возможна задержка минуты/часа; UI **не ждёт** cron и включает read-only по effective rules §8.4.
- Баннер пользователю T−7 до `period_end` — **клиентский** effective state (как demo days-left), не событие cron. Cron шлёт только developer digest.
- Grace: интервал `[period_end, grace_end)`, где `grace_end = period_end + interval '7 days'` (в v1 достаточно **вычислять в cron/RPC**, отдельная колонка `grace_end_at` — опционально для Billing UI). Пока `now < grace_end` — продуктовый режим `past_due`: **запись** закрыта с `period_end` (SQL + UI `isReadOnly`), **чтение** tenant data при `organizations.status = licensed` ещё разрешено RLS (`organization_allows_reads`); Mini App выкл с `period_end`. После `grace_end` — subscription `canceled` + `organizations.status = suspended` → reads/writes закрыты RLS. Данные licensed/suspended не purge'ить; purge только demo.
- Для manual active обязательны `current_period_start IS NOT NULL`, `current_period_end IS NOT NULL`, `end > start`, `provider = 'manual'`, `billing_period = 'monthly'`. Активная manual-строка с `period_end IS NULL` должна быть невозможна на уровне RPC/constraint.

Grace и старт нужно подтвердить как продуктовые решения. Технически SQL `organization_has_active_subscription` уже режет write в момент `period_end`, а UI `isReadOnly` зажигается только на `past_due`; UI обязан вычислять effective expiry по времени независимо от задержки cron. См. §8.4.

---

## 3. Конфиг оплаты и Dev Console

### 3.1. Что не дублировать

Не копировать блоки «Крипто / Банк / VN / МИР / QR». Они общие.

### 3.2. Канон цен и платёжной котировки

Добавить в `platform_payment_methods.config` два явных SKU (числа ниже — пример, не hardcode):

```json
{
  "schemaVersion": 2,
  "pricingRevision": 1,
  "crmLifetime": { "amount": "199", "currency": "USD" },
  "crmMonthly": { "amount": "29", "currency": "USD" }
}
```

В каждом способе **дополнить** поля, не заменяя lifetime:

`crmLifetime` обязателен: карточка lifetime не должна угадывать цену по «первому банку». Для обратной совместимости `method.amount/currency` остаются lifetime override; новые `monthlyAmount/monthlyCurrency` — monthly override.

Каждый способ получает стабильный `methodCode`; для фиксированных блоков это `bankTransfer`, `vietnameseBankTransfer`, `mir`, для crypto — сохранённый `id`, а не индекс массива/адрес.

Правило отображения:

1. Заголовки тарифов: `crmLifetime` и `crmMonthly`.
2. После выбора SKU и способа UI вызывает JWT Edge `create-purchase-quote`. Серверный `resolvePaymentQuote(config, sku, methodCode)` создаёт immutable quote `{ id, organization_id, requester_user_id, sku, method_code, amount, currency, pricing_revision, payment_details_snapshot, qr_sha256, expires_at }`.
3. UI показывает сумму и реквизиты из ответа quote, а не повторно читает «текущий» способ перед submit. Quote привязан к org/user, используется один раз и истекает в `min(now()+24h, data_purge_at)`; если до purge осталось меньше безопасного окна (рекомендация: 15 минут), новый quote не выдаётся и UI направляет к разработчику. Изменение конфига не меняет уже выданную котировку.
4. QR, адрес, IBAN, получатель, note — общие.
5. Сумма — положительный decimal, валюта — нормализованный allowlist-код; некорректный SKU/метод/quote блокирует отправку заявки fail-closed.

Зачем и канон, и per-method: банк может быть в VND, crypto — в USDT. Канон нужен витрине, override — конкретному рельсу.

`pricingRevision` увеличивает серверная Dev Console при изменении цен/способов; клиент не задаёт следующее значение. Save использует compare-and-swap по текущей revision, чтобы две вкладки не затёрли друг друга.

Добавить backend-only `platform_purchase_quotes` без authenticated SELECT/INSERT grants; создание — только Edge/RPC. `payment_details_snapshot` хранит нормализованные текстовые реквизиты/назначение, но не дублирует `data:image`; для QR хранится SHA-256. Создание quote rate-limited, expired unused quotes чистятся bounded batch. Логику `resolvePaymentQuote` + валидацию membership держать в одном Edge `_shared`-модуле для `create-purchase-quote` и `submit-purchase-request` (не дублировать парсер config).

При отправке заявки клиент передаёт `quote_id` и `client_request_id`. Одна DB-транзакция блокирует и потребляет неистёкший quote, выводит `request_kind` из его SKU, копирует в заявку method/amount/currency/revision/details fingerprint и создаёт outbox. Уникальность `(requester_user_id, client_request_id)` возвращает прежнюю заявку при retry; другой request не может повторно потребить quote.

Dev Console `/payment-methods`:

- Две секции сверху: **«CRM — пожизненно»** и **«CRM — ежемесячно»** (`amount`, `currency`), рядом с временно скрытой Mini App ценой.
- В каждом способе рядом с «Сумма к оплате» — поля «Сумма / месяц» и «Валюта / месяц».
- Подпись: «QR и номер счёта общие для lifetime и месяца. Меняется только сумма на экране покупки».
- Для crypto — стабильный read-only `id`, создаваемый один раз.

Парсеры CRM, Dev Console и Edge-resolver держать в одном версионированном контракте (`schemaVersion`) и прогонять на общих fixtures. Физически это сейчас разные runtime-сборки, поэтому «одинаковые интерфейсы на глаз» недостаточны: обязателен contract test на parse/resolve/round-trip.

Rollout: сначала Dev Console сохраняет/backfill-ит v2-конфиг с обеими каноническими ценами и stable crypto id, затем разворачивается новый purchase UI. Старый config читается в compatibility mode для существующего lifetime-экрана, но monthly submit fail-closed до полноценного v2.

### 3.3. Чего не делать в конфиге

- Не класть разные QR на lifetime и месяц.
- Не писать цену в `organization_subscriptions.plan` как источник истины (plan = `'standard'`).
- Не использовать `renterMiniappAddon` как цену CRM.
- Не вычислять цену Inbox по текущему конфигу вместо снимка заявки.

---

## 4. Поток покупки и Inbox

### 4.1. CRM UI лицензии

`/settings/license` и `/settings/license?purchase=1`:

Условие показа `ManualPurchasePanel` **не** `isDemo && purchase=1`. Целевое:

- демо (active/retention) до purge;
- monthly (active / past_due) — продление;
- `suspended` после месяца — recovery;
- **не** lifetime.

`useDemoLicenseUi` / `DemoPurchaseCta` расширить (или рядом `useCrmLicensePurchaseUi`): CTA owner/director при `past_due`, `suspended` (не lifetime). Баннер и CTA **T−7** — **S4** (по `current_period_end`), не тащить в S3b. Убрать обработку `?checkout=success|cancelled` (Stripe-хвост).

**Демо / нет лицензии**

1. Два тарифа: Lifetime (`crmLifetime`) / Monthly (`crmMonthly`).
2. Порядок UX: SKU → способ оплаты → реквизиты и точная сумма → форма «Я оплатил». Текущий порядок, где форма заявки стоит выше реквизитов, исправить.
3. Выбор способа обязателен; перед показом финальной суммы создаётся server quote. Форма шлёт `quote_id`, `client_request_id` и контакты/комментарий, но **не** SKU / method / авторитетную сумму / `request_kind`.
4. `request_kind` (`crm_license` | `crm_subscription`) Edge выводит только из server quote.
5. Waitlist Stripe и подсказку «Stripe скоро» убрать не только с лицензии, но и с `ActivateKeyPage`/i18n (`auth.activateKey.stripeSoonHint`).
6. CTA покупки показывать с первого дня демо; явно писать точную дату удаления данных.

**Уже monthly**

- Блок статуса: период до {datetime}, кнопка «Оплатить следующий месяц».
- Тот же ManualPurchasePanel в режиме monthly (продление).
- Поле lifetime-ключа оставить (апгрейд).

**Уже lifetime**

- Как сейчас: бейдж lifetime, без месячной покупки, без ключа.

**past_due / suspended после месяца**

- Read-only баннер (копирайт не «демо закончилось», а «подписка на CRM истекла») + CTA «Продлить подписку» на `?purchase=1` с предвыбором monthly.
- `LicenseRequiredPage`: два CTA — «Оплатить месяц» и «Купить lifetime» **только owner/director**. Поле/ссылка `TDB-LIFE-…` / `/activate-key` — **только owner**. Сейчас страница всем показывает activate-key, а копирайт только про demo ended. Остальным ролям — текст «доступ приостановлен» + существующие контакты, без покупки.
- `OrgWorkspaceRoute`: при `organizations.status = suspended` редирект на `/license-required`, **исключения** — `/settings/license` (и `?purchase=1`) и само `/license-required`. Иначе CTA зациклится, а RLS уже закрыл business reads. Статус брать из загруженной org-строки; для этого S3a расширяет SELECT `organizations` при suspended на **всех active members** (иначе director/teacher не узнают status — см. §1.2, §8.51).
- На `/license-required` ссылку «назад в read-only CRM» (`license.required.backToReadOnlyCrm`) показывать **только** если reads ещё открыты (demo / `licensed` + `past_due`). При `suspended` ссылка на `/` зациклит редирект — скрыть; оставить CTA оплаты (owner/director) и (owner) activate-key.
- `license.purchase` / `license.activate` не режет `isReadOnly` (§2.2).
- **Нарезка UI:** не расширять `showManualPurchase` на monthly/suspended, пока S3b не введёт server quote. Иначе старая форма уйдёт как `crm_license` (lifetime) за месячные деньги. S3a делает RBAC/waitlist/редирект/RLS recovery SELECT; S3b — витрину SKU/quote.
- **S3a, явный RLS (иначе recovery врёт):** при `organizations.status = suspended`: (1) SELECT `organizations` всем active members (shell + редирект); (2) SELECT `organization_licenses` + `organization_subscriptions` — owner и director (период/SKU на `/settings/license`). Tenant business tables (clients, payments, schedule, …) **не** открывать. Не путать с S2d (тот только INSERT заявок).

`SubscriptionWaitlistCard` удалить из UI (таблица `platform_waitlist` может остаться read-only в консоли).

### 4.2. Edge `submit-purchase-request`

Расширения:

- Поддержать quote SKU `crm_subscription` и серверно вывести из него `request_kind = crm_subscription`.
- Отклонить `renter_miniapp_addon` по-прежнему.
- Lifetime-орг не может слать `crm_subscription`. `create-purchase-quote` для monthly на lifetime — fail-closed.
- Принимать заявки от demo (до purge), monthly active/past_due и `suspended` (recovery). Не требовать `organization_allows_writes`. Не вводить лишний «только demo_active».
- Принимать только `quote_id`; Edge/RPC проверяет его org/user/kind/expiry и копирует server-created snapshot. `payment_method_code` и сумма из тела submit запрещены.
- `client_request_id` (UUID, unique для requester) делает повтор одного submit идемпотентным, не запрещая осознанно создать следующую заявку.
- Edge отклоняет новую заявку, если `now() >= data_purge_at`. Первая своевременная `new`-заявка ставит нерасширяемый `purchase_review_hold_until = data_purge_at + 72h`; повторные заявки не двигают hold.
- В email **и** в Telegram: kind, quote snapshot, method code, org id/name, контакты, комментарий, ссылка «открой Inbox».
- Заявка и строки outbox создаются одной DB-транзакцией; сбой внешней доставки не откатывает заявку (`PAY-INBOX-1`).
- Комментарий про чек: «пришлите скрин разработчику в Telegram / email» — плюс кнопка «Открыть чат» (существующий `telegramUrl`). Чек в Storage платформы в v1 **не** делать (PII + bucket).

`purge_expired_demo_organizations` уже не трогает org с lifetime или subscription `active|past_due`. Дополнительно пропускать demo, пока `now < purchase_review_hold_until` и есть хотя бы одна **eligible** `new` заявка: `request_kind IN ('crm_license','crm_subscription')` (не add-on). Закрытие одной заявки очищает hold лишь при отсутствии остальных eligible `new`; активация лицензирует org и очищает purge-поля; после 72h hold истекает и purge снова разрешён (если нет licensed entitlement). Так заявка не теряется, но спам не даёт бессрочно хранить demo.

Клиент не должен писать в `platform_purchase_requests` напрямую: хук зовёт Edge, Edge — одну SECURITY DEFINER RPC/service-role транзакцию. Предпочтительная защита — отозвать authenticated INSERT и удалить лишнюю INSERT-policy; CHECK оставить `crm_license | crm_subscription | renter_miniapp_addon`, legacy add-on принимать только из доверенного backend. Это RLS-изменение выполнять отдельной явно проверенной миграцией.

### 4.3. Dev Console Inbox

Для `crm_subscription` (status=new):

- Кнопка **Activate month** (не «Activate full access»).
- Период по умолчанию считает **только сервер** (§2.3: `now()` + calendar month, `timestamptz`). **Не** копировать Inbox `defaultPeriod()` add-on (1-е…конец текущего UTC-месяца, date-only). UI показывает серверный превью (дата **и** время), это не источник истины.
- Ручной override — опционален: не date-only add-on inputs как канон; если править — сохранить время Activate (не обрезать до UTC midnight), обязательные reason/note, audit before/after. Без note override отклонять.
- Активация: одна DB RPC `activate_platform_purchase_request(request_id, actor_id, optional_period_override, note)`.
- RPC блокирует (`FOR UPDATE`) заявку, организацию и строку `organization_subscriptions` (create-if-missing внутри той же транзакции).
- **Идемпотентность:** повторный вызов с тем же `request_id` (уже `activated`) возвращает **200** и сохранённый `activated_period_*` без сдвига периода. Текущий Inbox на повтор отвечает **400** `request_already_activated` — заменить на идемпотентный успех.
- **Новая оплаченная заявка** (`request_id` другой, status `new`): при ещё активном entitlement (`period_end > now()`) сдвинуть только `period_end` на +1 календарный месяц по anchor (§2.3), `period_start` не менять; если entitlement уже истёк — новый `period_start = now()` и anchor заново. Две подтверждённые monthly-заявки подряд дают +2 месяца к концу (§8.22).
- RPC повторно проверяет status/kind/lifetime, на сервере считает период по §2.3, вызывает/переиспользует entitlement-логику `sync_organization_subscription`, записывает назначенный период в заявку и переводит её в `activated` **в одной транзакции**.
- **Не** генерировать `TDB-LIFE-…`.
- Не писать `access_keys` (или отдельный `key_type=subscription` не вводить — лишняя сущность; период живёт в `organization_subscriptions`).
- После активации: Telegram пользователю не обязателен в v1 (у него нет бота). Достаточно licensed при следующем refresh CRM. Опционально: email requester, если есть.

Для `crm_license` — поведение прежнее, реализация тоже переводится на атомарную RPC: key hash + org + lifetime license + cancel subscription + request status. **Порядок апгрейда month→lifetime:** сначала `organization_licenses.license_type = lifetime` и `organizations.status = licensed`, затем subscription `canceled`. Если вызвать текущий `sync_organization_subscription(..., canceled)` при ещё `license_type=subscription`, org станет `suspended` (§8.36). Plaintext key генерируется в Edge и показывается только после успешной транзакции. Если ответ потерян, повтор сообщает `already_activated` **без** plaintext (его нельзя восстановить и нельзя хранить); org уже licensed. Активация месяца после lifetime обязана отказать; lifetime после month атомарно гасит subscription.

Фильтры Inbox: kind = lifetime | monthly | addon(legacy).

### 4.4. Billing page

`/billing` становится операционным для manual:

- Видно provider `manual` | `stripe`.
- Действия: продлить на месяц, past_due, canceled, поправить даты.
- `dev-console-adjust-subscription` уже зовёт `sync_organization_subscription` — расширить вход: period_start/end и create-if-missing. Это аварийная developer-операция, а не «исключение для знакомых»: обязательны reason, actor, старое/новое состояние в `platform_audit_log`; те же серверные проверки периода и lifetime.

### 4.5. Cron истечения

Новый тик (как `purge-expired-demo-orgs`):

1. `active` и `now >= period_end` → `past_due` (write уже закрыт SQL с момента `period_end`; UI read-only по §8.4 с того же момента; cron лишь синхронизирует `status` для баннеров/отчётов).
2. `past_due` и `now >= grace_end` → `canceled` + `organizations.status = suspended`.
3. Переходы выполнять idempotent batch RPC с `FOR UPDATE SKIP LOCKED`; повторный cron безопасен.
4. Пользователю: баннер T−7 и CTA считает **UI** по `current_period_end`, без Telegram и без ожидания cron. Разработчику: один ежедневный digest по истекающим/просроченным организациям; dedupe key включает дату и тип digest.

Не purge licensed/suspended org. Не путать с demo 30 дней. Purge demo уже не трогает org с active/past_due subscription — review-hold нужен только pending-заявкам без ещё записанной подписки.

---

## 5. Платформенный бот уведомлений

### 5.1. Роль бота

**Один бот → один chat_id разработчика** (группа или личка). Пользователь CRM с ботом не переписывается. Он жмёт кнопки / пишет форму **в CRM**; backend сохраняет источник события и ставит уведомление в outbox. Подключение — обязательная часть узла (§5.8), не optional follow-up.

Это не Mini App, не webhook арендатора, не замена mailto. Mailto и `t.me/omow_second` остаются запасным каналом.

### 5.2. Инфраструктура (канон v1)

Повторить надёжный outbox-паттерн Mini App, но **не** tenant-токены, AES, webhook арендатора и **не** cron `renter-booking-worker`:

| Кусок | Имя | Зачем отдельно |
|---|---|---|
| Секрет токена | `PLATFORM_TELEGRAM_BOT_TOKEN` | только Edge secret/env; не AES студии, не GCAL, не JSON `platform_payment_methods` |
| Destination | `platform_notification_settings` (singleton) | `telegram_chat_id` (bigint: группа `< 0` или личка `> 0`), title, updated_by/at. **Не** Edge secret: Dev Console должна уметь Save/Detect; секреты из приложения не пишутся |
| Support tickets | `platform_support_tickets` | только реальные обращения пользователя |
| Outbox | `platform_notification_outbox` | email + Telegram, retry и единый delivery audit |
| Drain | Edge `platform-notification-worker` | claim/lease, backoff+jitter, `retry_after`, dead-letter, cron secret. Email — тот же `_shared/email.ts` (`sendTransactionalEmail`) |

Webhook в v1 **не нужен** и **не ставить** (`setWebhook` ломает Detect через `getUpdates`). **`getUpdates` только** у developer-only Edge «Detect» (короткий one-shot poll, без long-polling worker). Cron `platform-notification-worker` и purchase/submit **никогда** не вызывают `getUpdates` — только `sendMessage` (и при необходимости `getMe` для health).

**Почему chat_id не в секретах:** предыдущая формулировка «оба значения — Edge secrets» противоречила кнопке Save в Dev Console. Токен — секрет (CLI/dashboard). Chat id — операционный параметр, пишется developer-only Edge в таблицу без authenticated GRANT.

**Подключение (рекомендуемый порядок, privacy можно оставить Enable):**

1. BotFather → новый бот → токен в `PLATFORM_TELEGRAM_BOT_TOKEN`. Username бота пользователям CRM **не** показывать.
2. Личка: открыть бота → `/start`. Группа: создать служебный чат/supergroup → добавить бота (админ не обязателен для `sendMessage`).
3. Detect в Dev Console: `getMe` (токен жив) + `getUpdates` **только если webhook не установлен**. Кандидаты: `my_chat_member` при добавлении в группу (работает **при включённом Group Privacy**) и private `/start`. Не требовать Disable privacy как основной путь; `@bot` / команда — запасной, если `my_chat_member` не пришёл.
4. Оператор выбирает кандидата **или вставляет chat_id вручную** (это основной надёжный путь) → Save в `platform_notification_settings` → Send test.
5. Пока токена или chat_id нет: источник и email-outbox создаются; Telegram-строка `status=blocked`, `last_error_code=config_missing`, attempts не тратить. После настройки — «Requeue blocked + Send test».

Не рассылать на N личек в v1. Одна запись destination. Если позже понадобится inline Activate — отдельный v1.1: webhook secret + allowlist Telegram user id + повторный login в Dev Console для денег.

`platform_notification_outbox` минимум: `channel`, `event_kind`, `source_type`, `source_id`, `dedupe_key`, sanitized payload snapshot, `status` (`pending|processing|retry|blocked|sent|dead`), `attempts`, `available_at`, lease owner/until, `sent_at`, безопасный `last_error_code`; уникальность — `(channel, dedupe_key)`. Текст Telegram ≤ 4096, комментарий резать на сервере. `403` / `chat not found` / kicked → `blocked` (исправимо: вернуть бота в чат и requeue), не сразу `dead`. `429` — ждать `retry_after`. `dead` — исчерпан retry или неисправимый payload. HTTP к Telegram/email — только worker; заявка/тикет/событие и outbox — одна транзакция.

Паттерн lease/retry изучать в `renter_telegram_outbox` + `renterTelegramOutboxDrain` / `renter-booking-worker`. Не вызывать `decryptTelegramBotToken`. Общий HTTP-хелпер `sendTelegramMessagePlain(token, chatId, text)` вынести в `_shared` (без parse_mode, без tenant AES); call sites: `renterTelegramOutboxDrain` (постепенный рефактор) + `platform-notification-worker`.

### 5.3. Тикеты и платформенные события — не смешивать

`platform_support_tickets` хранит только обращения, для которых нужен ответ/разбор:

| `ticket_kind` | Откуда |
|---|---|
| `login_help` | LoginPage, форма «Не могу войти» |
| `forgot_password` | ForgotPasswordPage, «Письмо не пришло / нет доступа к почте»; **не** заменяет GoTrue reset |
| `license_help` | LicenseSettingsPage / LicenseRequiredPage |
| `other` | шапка CRM «Написать разработчику» |

`purchase_request` уже имеет источник истины `platform_purchase_requests`; `org_created` — immutable platform event/audit. Не создавать для них фиктивные support tickets. Оба источника напрямую enqueue уведомление с `source_type`.

Поля тикета (минимум): id, `client_request_id`, kind, status (`new|open|closed`), user_id nullable, email, telegram handle, organization_id nullable, locale, message, internal page path, created_at/updated_at/closed_at. `client_request_id` уникален и делает retry идемпотентным; для гостя повтор всегда получает тот же нейтральный ответ без данных тикета. `organization_id` для JWT выводится с сервера; гостевой клиент не может привязать тикет к произвольной org. Полные IP/user-agent не хранить; для rate limit использовать короткоживущий keyed HMAC IP, а не обратимый или перебираемый plain hash.

Гостевые kind (`login_help`, `forgot_password`) — Edge `submit-support-ticket`, `verify_jwt=false`, CORS allowlist, **Turnstile fail-closed**, атомарный rate limit IP-HMAC+email-HMAC, одинаковый успешный ответ без enumeration (урок S37). Ограничить kind, длины полей и page path allowlist; не принимать произвольный URL.

Авторизованные — JWT Edge, active member текущей org, не renter actor. Тикет `forgot_password` никогда не является достаточным основанием для смены email/пароля: сброс owner — Dev Console `dev-console-reset-owner-password` + recovery code (owner transfer), минимум два независимых фактора идентификации. Не путать с промптом **S09** аудита безопасности 2026-08-22 (касса/персоналки).

### 5.4. Текст уведомления разработчику

Короткий plain text без `parse_mode`, секретов и Telegram markup injection:

```
[purchase] Месяц · Demo Organization
org: 8f3a…  request: 12ab…
ожидаем: 29 USD
контакт: name@x · @user
«оплатил Vietcombank, чек в почте»
Inbox: https://…/inbox
```

Запрещено в Telegram: пароли, recovery code, plaintext access key, initData, JWT, полный user-agent/IP. Комментарий/имя обрезать так, чтобы всё сообщение ≤ 4096. Ссылку Inbox строить из server-side базового URL Dev Console (новый Edge secret, например `DEV_CONSOLE_PUBLIC_URL` — в репозитории сейчас нет единого имени; зафиксировать при S5 вместе с деплоем консоли), не из `page_url` клиента.

### 5.5. Кнопки в CRM (UX)

Не превращать шапку в чат.

1. Существующие иконки Email/Telegram/WhatsApp **оставить** (прямой контакт).
2. Рядом: кнопка «Сообщение разработчику» → модалка: kind задаёт страница/сервер (не свободный enum), textarea, опционально Telegram @.
3. На login/forgot: свёрнутый блок «Нужна помощь?» с теми же полями + captcha.
4. После отправки: «Сообщение отправлено. Если есть чек — продублируйте в Telegram/email».

Не делать в v1: тред ответов в CRM, вложения в Storage, бот отвечает пользователю.

### 5.6. Новая база

Внутренняя RPC создания self-service demo в той же транзакции создаёт platform event/outbox `org_created` (имя, email domain/HMAC при необходимости корреляции, org id, locale). Edge-вызов «после успешного INSERT» недостаточно надёжен: при падении между INSERT и enqueue событие потеряется.

Антиспам: unique dedupe `org_created:<org_id>`, повторный retry не создаёт второй алерт. Не слать на `purge`. Не слать при invite-member.

### 5.7. Dev Console support inbox

Telegram — канал доставки, не рабочая очередь. Добавить в Dev Console `/inbox` вкладку **Support** (либо отдельный `/support`, но не обе): developer-only list/detail, фильтры kind/status, `new → open → closed`, обязательная internal note/reason при закрытии, actor/time в audit. Ссылка уведомления ведёт на конкретный ticket. Ответ пользователю в v1 остаётся внешним email/Telegram; тред в CRM не хранится.

### 5.8. Подключение платформенного бота (чеклист S5, бот в скоупе)

Outbound-only: пользователям CRM **не** показывать `@username` бота и не просить «написать боту» — только формы §5.5 и ссылки `t.me/omow_second`. Лендинг FAQ «отвечает человек, не бот» остаётся правдой для клиента: этот бот пишет **разработчику**.

1. **BotFather:** `/newbot` → token → Supabase secret `PLATFORM_TELEGRAM_BOT_TOKEN` (никогда в `platform_payment_methods`, RLS читает JWT). Privacy (`/setprivacy`) можно оставить Enable.
2. **Куда писать:** служебная группа (предпочтительно, если разработчиков несколько) **или** личка с `/start` (достаточно для соло). Добавить бота в чат.
3. **Detect + paste + test:** Dev Console (S5): «Detect» (`getMe` + `getUpdates` / `my_chat_member`) **или** вставить chat_id → Save в `platform_notification_settings` → «Send test». Нет токена/id — outbox Telegram `blocked` / `config_missing`, заявки и email не ломаются.
4. **Worker:** отдельный cron/Edge `platform-notification-worker` с `CRON_SECRET` (как `renter-booking-worker` / `calendar-sync-worker`); не добавлять drain в `renter-booking-worker`.
5. **Не делать в v1:** `setWebhook`, inline-кнопки Activate, ответы пользователю из бота, показ username бота в CRM/лендинге.
6. **Миграция purchase email:** сегодня `submit-purchase-request` шлёт email inline и пишет `email_sent` на заявке; целевое — enqueue в outbox (§8.11), worker доставляет email **и** Telegram; `email_sent` оставить read-only legacy до отдельного cleanup UI Inbox.

---

## 6. Гейты доступа (что должно остаться правдой)

```
writes  = NOT schema_version_locked
        AND (
              (demo_active AND (demo_expires_at IS NULL OR demo_expires_at > now()))
           OR (licensed AND (lifetime OR (subscription.status=active AND period_end > now())))
            )

reads   = organization_allows_reads: demo_active | demo_retention | licensed
         # licensed + past_due (grace): reads ещё true; writes уже false (§2.3)
         # status = suspended после grace: reads/writes закрыты (status ∉ списка); данные в БД
         # не путать «есть organization_licenses» с доступом к tenant data

Mini App = licensed AND (lifetime OR active subscription)   # HALL-RENT-SELF-2
         ≠ organization_addons, пока add-on paused
         # active subscription = тот же helper: status=active AND period_end > now()
         # поэтому Mini App гаснет в момент period_end, не дожидаясь cron past_due
```

Следствия:

- Истекший месяц → Mini App **выкл** (как демо). Это согласовано с SELF-2.
- Lifetime не зависит от подписки.
- **Истёкший paid period** (`license_type = subscription` и `period_end <= now()` или `status != 'active'` или `period_end IS NULL`): UI `isReadOnly`, writes закрыты SQL; Mini App выкл; не ждать cron для UI.
- **`past_due` на `licensed` (grace):** те же read-only writes; RLS **reads** ещё открыты (§2.3) — не путать с полной блокировкой.
- **`organizations.status = suspended`** (после grace): reads/writes закрыты RLS; workspace → `/license-required` (§4.1), не смешивать с `past_due`.
- `schema_version_locked` уже режет writes в SQL; в этом узле не менять.

Активация месяца с legacy `demo_retention` / expired `demo_active`, если org ещё не удалена: org → licensed, `data_purge_at = null`, `demo_expires_at = null`. Текущий `sync_organization_subscription(active)` это уже делает для статусов `demo_active|demo_retention|suspended|licensed`.

Suspended после grace: membership и license recovery route доступны, business data остаются в БД, но RLS reads закрыты. UI: `OrgWorkspaceRoute` → `/license-required` + продление; не выкидывать на login. `/settings/license?purchase=1` — узкий recovery route. `license.purchase` / `license.activate` не в `WRITE_ACTIONS`. Чтобы редирект и витрина работали, S3a обязан расширить SELECT `organizations` при suspended на всех members и SELECT license/subscription на owner+director (§8.51) — иначе director видит `organization = null` и вечный LoadingState.

---

## 7. Слои реализации (когда дойдёт до кода)

Не плодить дубли. Логика только `hooks/` + `lib/` + Edge; UI без Supabase.

| Слой | Работы |
|---|---|
| SQL | `platform_purchase_quotes`; CHECK `request_kind` + `crm_subscription`; quote/idempotency/activated-period поля заявки; `organizations.purchase_review_hold_until`; `platform_notification_settings`; manual-period constraints + anchor (`billing_anchor_day` или helper); атомарные submit/activate RPC; `platform_support_tickets`; `platform_notification_outbox`; cron expire/purge hold; убрать direct authenticated INSERT заявки отдельной RLS-миграцией |
| Permissions | добавить `license.purchase` (owner+director); **убрать `license.activate` из `WRITE_ACTIONS`**; в `LicenseSettingsPage`: `ManualPurchasePanel` / заявка — `RequirePermission` на `license.purchase`, поле `TDB-LIFE-…` — на `license.activate` (сейчас всё на `license.activate`) |
| Edge | `create-purchase-quote`; `submit-purchase-request`; `dev-console-purchase-inbox` через atomic RPC; `submit-support-ticket`; `platform-notification-worker`; Detect/Save/Send test destination; без Telegram webhook в v1 |
| CRM | выбор тарифа/метода; server quote; покупка не только demo; убрать waitlist и Stripe checkout-query; модалка тикета; CTA на login/forgot; баннер T−7/продления; suspended gate; копирайт LicenseRequired/ReadOnlyBanner |
| Dev Console | `crmLifetime`/`crmMonthly`, revision и overrides методов; Inbox purchase monthly + Support; Billing create/extend; Telegram detect/paste/test/requeue |
| i18n | CRM: ru/en/vi, ключи `license.plan.*`, `support.ticket.*`; не путать с абонементом ученика. Лендинг: только `tangodb-landing/src/i18n/{en,ru}.ts` (файла vi **нет**) |
| Landing | два тарифа CRM; сохранить «без карты и автосписания»; убрать смысл «месяца нет»; FAQ `faq.a10` — человек отвечает клиенту, платформенный бот только пишет разработчику; early bird до 31 Aug 2026 **просрочен** (§8.16–8.17); править в **S7** |
| Тесты | SQL: atomic/idempotent/concurrent activation; upgrade lifetime-before-cancel; anchor 28/29/30/31; null-end forbidden; lifetime race; exact demo expiry boundary; purge hold с несколькими new; expire→past_due→suspend; Mini App gate; RLS quotes/tickets/requests/settings; outbox dedupe/lease/blocked/requeue/dead; Deno: quote spoof/reuse/expiry/details snapshot, support idempotency, kind guard, rate limit, neutral response, renter forbidden |
| Версия | **S1** открывает `APP_VERSION` + `package.json` → **2.11.0**; каждый следующий код-промпт — `2.11.y` +1 от фактического; changelog; **S7** — лендинг + `decision_log.md` + `architecture.md` (бамп в S7 только если после последнего y ещё есть код) |

Stripe-функции: не вызывать из UI, не удалять в этом узле.

---

## 8. Решения, конфликты и устранённые ошибки

Пункты с продуктовым выбором вынесены в §11. Остальные ниже — технический канон, полученный после сверки с кодом.

### 8.1. Stripe vs ручной месяц

Waitlist обещает Stripe. Ручной месяц — другой продукт.

**Рекомендация:** Stripe заморозить явно в UI («оплата картой не используется; перевод по реквизитам»). Waitlist убрать. Не держать два способа месяца.

### 8.2. Цена: канон + override + snapshot

**Рекомендация:** обязательные `crmLifetime`/`crmMonthly` + override на способе + server-created immutable quote до оплаты (§3.2). Snapshot из quote копируется в заявку; изменение конфига не меняет уже показанную сумму.

### 8.3. Старт периода: дата оплаты, 1-е число, или клик Inbox

**Рекомендация:** серверное время клика Activate = start. Ручная поправка — только developer с обязательной причиной и аудитом. Сохранять anchor day, иначе даты 29–31 дрейфуют после февраля.

### 8.4. SQL write vs UI read-only (баг заготовки)

`organization_has_active_subscription` требует `period_end > now()`. UI read-only только при `past_due`.

**Рекомендация:** cron ставит `past_due`, но UI не зависит от его задержки: **writes/read-only UI** при `license_type = subscription` и (`status != 'active'` или `current_period_end IS NULL` или `current_period_end <= now()`). **`suspended`** — отдельный gate (редирект workspace), не дублировать в формулу `isReadOnly` для `past_due` на `licensed`. В grace (`licensed` + `past_due`) RLS **reads** ещё true — баннер «оплатите продление», но не «как после purge». Сейчас `OrganizationProvider.isReadOnly` = demo_retention / истёкший demo_active / (`licensed` + subscription `past_due`) — не покрывает истёкший `period_end` при `status = active` и не покрывает `suspended`. `OrgWorkspaceRoute` должен уводить **только `suspended`** на `/license-required` (business reads уже закрыты RLS) — иначе пустая оболочка; `past_due` на `licensed` workspace не редиректить. **Нарезка:** редирект `suspended` + копирайт `LicenseRequiredPage` + RLS recovery SELECT — **S3a**; формула `isReadOnly` + T−7 + `ReadOnlyBanner` для истекшего месяца — **S4**. Серверные `organization_allows_writes` / `organization_allows_reads` — источник истины для мутаций и RLS.

### 8.5. Grace и purge

Демо purge'ится. Купивший месяц — нет.

**Рекомендация:** 7 дней past_due, потом suspended, данные живы. Вернуть = новая заявка месяца. Не удалять базу за неуплату.

### 8.6. Апгрейд month → lifetime: зачёт дней

**Рекомендация v1:** зачёта нет (ручная цена, разработчик сам решает скидку). В заявке lifetime можно написать «уже платил месяц». Не кодировать prorate.

### 8.7. Понижение lifetime → month

`sync_organization_subscription` специально **не** снимает lifetime.

**Рекомендация:** запретить в UI и Inbox. Только support вручную (отдельная операция, не этот узел).

### 8.8. Год / «кнопка Year» на waitlist

**Рекомендация:** не продавать year. Схему `yearly` не дропать.

### 8.9. Кто шлёт заявку: owner vs director

Сейчас оба. Director без смены owner — ок для оплаты студии.

**Рекомендация:** owner+director получают отдельное `license.purchase`; owner-only `license.activate` не расширять. Это устраняет текущее расхождение между Edge/RLS и `RequirePermission`.

### 8.10. Чек оплаты

Сейчас: «пришлите скрин письмом/в Telegram», в заявке только текст.

**Рекомендация v1:** не грузить файлы в CRM. Бот может напомнить «жди чек в личке». Storage чеков платформы = PII и модерация, отложить.

### 8.11. Двойной канал: email + Telegram

**Рекомендация:** оба канала через `platform_notification_outbox`. Delivery status хранить на строках outbox, не размножать `email_sent`/`telegram_sent` по каждому типу источника. Legacy `email_sent` можно оставить до миграции UI.

### 8.12. Авто-алерт каждой новой демо-базы

Может шуметь.

**Рекомендация:** да, одно platform event/outbox на org, не support ticket. Если шум — ежедневный digest/фильтр, не потеря события.

### 8.13. Гостевые тикеты без сессии

Login/пароль часто без JWT.

**Рекомендация:** публичная Edge + CORS allowlist + Turnstile + атомарный rate limit по keyed HMAC + нейтральный ответ. Не требовать логин, чтобы сказать «не могу войти».

### 8.14. Бот vs ссылка t.me/omow_second

**Рекомендация:** ссылка остаётся. Бот — зеркало заявок, не единственный чат. Пользователь может написать в личку напрямую; тогда тикета в CRM нет — это ок.

### 8.15. Несколько разработчиков / группа

**Рекомендация:** одна служебная группа (`chat_id < 0`) **предпочтительна**, если разработчиков больше одного. Личка (`chat_id > 0` после `/start`) — допустимый v1 для соло. Хранить один `telegram_chat_id` в `platform_notification_settings`, не в Edge secret. Для обычного `sendMessage` боту не обязательно быть администратором. Не рассылка на N личек в v1.

### 8.16. Landing «No monthly subscription» / «Без ежемесячной оплаты»

Публично сейчас: витрина про **lifetime без ежемесячной платы за CRM** (EN буквально «No monthly subscription»; RU — «Без ежемесячной оплаты» — **не калька EN**), плюс early bird до **31 Aug 2026** (на 2026-09-11 уже просрочен — см. §8.17). `pricing.afterTrial.text` / `faq.aCard` про «нет карты и автосписания» **остаются правдой** для ручного месяца — не вычищать вместе с заголовком.

**Рекомендация:** править лендинг в том же релизе 2.11: явно два тарифа CRM (month + lifetime), переписать `pricing.afterTrial.*` как «без автосписания / без карты», не «месяца нет»; FAQ про «только lifetime после trial»; просроченный early bird. `faq.a10` («отвечает человек, не бот») уточнить: клиенту отвечает человек в Telegram/email; платформенный бот — служебные алерты разработчику. Иначе воронка врёт относительно `/settings/license`.

### 8.17. Early bird lifetime

**Рекомендация:** не смешивать с месяцем. Lifetime витрина живёт в `crmLifetime`, method `amount/currency` остаётся override для совместимости. Просроченную early-bird формулировку убрать; акции в будущем моделировать отдельными датированными полями, а не вечным текстом.

### 8.18. Триггер kind + PostgREST INSERT

Текущая policy/GRANT позволяет authenticated прямой INSERT `crm_license`, хотя продукт использует Edge. **Рекомендация:** отозвать INSERT у authenticated и оставить только Edge/RPC. Один trigger kind не защищает остальные server-derived поля (quote, requester, idempotency).

### 8.19. `provider` default stripe

Новые ручные строки: **`manual`**. Старые stripe-секреты не использовать. Billing UI показать provider.

### 8.20. Уникальность `organization_subscriptions`

Одна строка на org = текущий entitlement, не журнал. Для v1 активированная заявка обязана хранить `activated_period_start/end`, quote snapshot, actor/time; manual adjustment — before/after в audit. Этого достаточно без новой `organization_subscription_periods`. Если появятся автосписания/refund/proration — добавить отдельный ledger, не перегружать entitlement-строку.

### 8.21. Активация месяца для уже lifetime

Inbox должен отказать (не создавать subscription «для учёта»).

### 8.22. Параллельные заявки new

Две new (lifetime + month, или два month).

**Рекомендация:** idempotency UUID гасит только повтор одного submit; разные заявки не блокировать. Inbox показывает другие `new` по org. Атомарная RPC сериализует активации по org: две подтверждённые monthly-заявки последовательно добавляют два месяца к `period_end` (§4.3). Параллельные активации lifetime vs month: побеждает первая завершённая транзакция; вторая должна отказать (`already_lifetime` / `invalid_kind`). Остальные `new` заявки автоматически не закрывать.

### 8.23. Версия лицензии `crm_product_versions`

Lifetime привязан к major `v2`. Месяц — тоже `organization_licenses.crm_version_id = current`. Смена major (v3) — отдельный узел, не здесь.

### 8.24. i18n сумм

Сумма из конфига — данные, не перевод. Подпись «/ месяц» — i18n.

### 8.25. `overlayPaymentAmounts` сейчас мёртвый

Функция есть, вызовов в CRM нет (остаток Mini App add-on UI). Не расширять её до бизнес-источника quote: она безусловно перезаписывает суммы всех методов и не знает per-method override. Ввести один server-side `resolvePaymentQuote` внутри create-quote; overlay может остаться только presentation helper либо быть удалён отдельным cleanup.

### 8.26. Атомарность Inbox

Текущая lifetime-ветка пишет key, org, license и request отдельными запросами.

**Рекомендация:** обе ветки активировать одной DB RPC с row locks и идемпотентным повтором. Это обязательная починка перед monthly, иначе частичный сбой выдаст доступ без закрытой заявки или consumed key без лицензии.

### 8.27. Бессрочный active из-за `period_end = null`

Текущий helper принимает active subscription с null end как действующую навсегда.

**Рекомендация:** manual active без обеих дат запрещён constraint/RPC; effective gate для manual никогда не использует null как infinity. Совместимость старого Stripe-кода проверяется отдельным тестом.

### 8.28. Bootstrap Telegram

Нельзя одновременно обещать «chat id в Edge secret» и «Save из Dev Console»: приложение **не** пишет Supabase secrets.

**Рекомендация v1 (бот подключаем):** токен — только `PLATFORM_TELEGRAM_BOT_TOKEN`. Destination — строка `platform_notification_settings`, Save/Detect/paste в Dev Console. Detect: `getMe` + `getUpdates` без webhook; лучший сигнал группы — `my_chat_member` (privacy Enable можно не трогать). Ручной paste chat_id — канонический fallback, не «если Detect сломался». Send test обязателен. `403`/kick → `blocked` + requeue, не `dead`. Callback и webhook — v1.1.

### 8.29. Demo purge vs заявка в Inbox

Сейчас `platform_purchase_requests.organization_id` имеет `ON DELETE CASCADE`, а S5 purge удаляет demo на `data_purge_at`. Заявка за минуту до дедлайна может исчезнуть до проверки.

**Рекомендация:** один bounded review-hold 72 часа для своевременно созданной `new`-заявки; повторные заявки его не продлевают. После дедлайна новые заявки запрещены. Это узкое операционное исключение из S5 и требует подтверждения владельца (§11).

### 8.30. Director и экран покупки

Edge уже принимает заявку от director; CRM скрывает `ManualPurchasePanel` за `license.activate` (только owner) **и** за `WRITE_ACTIONS` (любой read-only). Плюс `showManualPurchase` только для demo.

**Рекомендация:** в S3a: `license.purchase` owner+director; обёртка покупки на него; ключ на `license.activate`; оба **не** в `WRITE_ACTIONS`; RLS recovery SELECT (§8.51). Панель покупки для monthly + suspended recovery — **S3b**, не S3a. В `permissions.ts` сейчас есть только `license.view` / `license.activate`.

### 8.31. Inline email заявки vs outbox

Сегодня `submit-purchase-request` отправляет email внутри Edge и выставляет `platform_purchase_requests.email_sent`. Telegram нет. Целевое §5 — одна транзакция «заявка + строки outbox», доставка только worker; иначе частичные сбои и дубли логики с `renter_telegram_outbox`.

### 8.32. Ссылка Inbox в Telegram

В коде нет публичного base URL Dev Console в secrets; при S5 завести `DEV_CONSOLE_PUBLIC_URL` (или одно согласованное имя) и использовать только на сервере в payload outbox.

### 8.33. `license.activate` в `WRITE_ACTIONS`

`can()` при `isReadOnly` возвращает false для всех write-действий, включая `license.activate`. На `demo_retention` и будущем `past_due` форма покупки и ключ скрыты, хотя Edge заявку ещё примет.

**Рекомендация:** `license.purchase` и `license.activate` не входят в `WRITE_ACTIONS`. Tenant writes по-прежнему режет `organization_allows_writes`.

### 8.34. Покупка только на demo

`showManualPurchase = purchase=1 && isDemo`, `useDemoLicenseUi.showPurchaseCta` только demo. Monthly renewal и suspended recovery в текущем UI невозможны.

**Рекомендация:** условие §4.1; CTA T−7 / past_due / suspended отдельно от demo-badge.

### 8.35. Signed quote без таблицы

HMAC-токен котировки без `platform_purchase_quotes` не даёт consume-once (нужен уникальный `quote_id` в БД). Клиентский SKU+method с snapshot только в момент submit дешевле, но пользователь успеет перевести деньги по сумме с экрана, пока Dev Console сменит цену.

**Рекомендация:** оставить server-created quote table (§3.2). Overlay/HMAC-only — нет.

### 8.36. `sync_organization_subscription(canceled)` подвешивает org

Функция при `canceled` и отсутствии lifetime ставит `organizations.status = suspended`. Для апгрейда month→lifetime это ловушка, если гасить подписку раньше записи lifetime.

**Рекомендация:** atomic RPC апгрейда — lifetime license + licensed **первыми**; cancel subscription без ветки suspend. Не вызывать «голый» sync(canceled) из Inbox month-активации.

### 8.37. HMAC-IP vs текущий purchase rate limit

`submit-purchase-request` уже лимитирует по plain `clientIp`. Для гостевых тикетов — keyed HMAC (S37). Не обязательно менять purchase IP-лимит в этом узле; не класть IP в ticket/outbox.

### 8.38. Drain не в `renter-booking-worker`

Студийный outbox дренится оттуда же, где booking maintenance. Платформенный токен/таблица другие; сбой/бюджет Mini App не должен стопорить алерты Inbox.

**Рекомендация:** отдельный `platform-notification-worker`. Общий только HTTP `sendMessage` без parse_mode.

### 8.39. Повтор activate = 400

Сейчас Inbox на уже activated отвечает ошибкой. Целевой контракт — идемпотентный успех без plaintext и без сдвига периода.

### 8.40. `?plan=monthly` в URL

Не делать SKU источником истины из query: quote создаётся после выбора в UI. Query может только **предвыбрать** monthly на recovery CTA, сервер всё равно смотрит quote.

### 8.41. `demo_expires_at IS NULL`

Текущий SQL пишет demo_active при null expiry. Для этого узла не менять helper; новые self-service org по-прежнему получают expiry. Тест границы: expiry ровно `now()`.

### 8.42. Grace `past_due` vs `suspended` (частая путаница в UI)

`past_due` при `organizations.status = licensed` — окно **7 дней** после `period_end`: клиент видит read-only CRM, но **данные в БД читаются**; recovery — `?purchase=1`. `suspended` — после grace: RLS режет reads, нужен `/license-required` + те же CTA оплаты. Баннеры и копирайт различать явно («подписка истекла, оплатите в течение N дней» vs «доступ приостановлен»).

### 8.43. Detect `getUpdates` vs worker

Long-polling `getUpdates` в cron worker заберёт апдейты и сломает Detect в Dev Console. Worker шлёт только `sendMessage`; Detect — редкий one-shot с `offset`/`allowed_updates`, без фонового consumer.

### 8.44. Хук уже шлёт `request_kind`

Спека раньше писала, что панель «не шлёт kind, Edge подставляет». Факт кода 2.10.39: панель kind не передаёт, но `useSubmitPurchaseRequest` всегда кладёт `request_kind: crm_license` в JSON. Целевой контракт всё равно quote-only (§4.1).

### 8.45. Inbox date inputs add-on ≠ CRM-месяц

`defaultPeriod()` Inbox UI и Edge `defaultAddonPeriod()` — 1-е…последний день текущего UTC-месяца, `type=date` / date-only. CRM-месяц — `timestamptz` от серверного `now()` + calendar anchor (§2.3). Копировать виджет add-on или Edge-хелпер как дефолт Activate month нельзя: потеряется время и якорь 29–31.

### 8.46. «Назад в CRM» на `/license-required` при suspended

Страница сейчас всегда даёт `AuthLink to="/"`. После редиректа `suspended` → `/license-required` эта ссылка зациклит. Показывать её только пока `organization_allows_reads`.

### 8.47. Когда бампить 2.11.0

«После узла 2.11.0» читалось как «только S7». По VER-1 подверсию открывает **первый код узла (S1)**. Иначе S1–S6 живут на 2.10.39 и карта подверсий врёт.

### 8.48. S3 vs S4 vs monthly-витрина

S3a: RBAC, waitlist, редирект `suspended`, копирайт `LicenseRequiredPage`, RLS recovery SELECT (§8.51). S3b: витрина quote и `showManualPurchase` для monthly/recovery. S4: `isReadOnly` по `period_end`, T−7 баннер+CTA, cron, `ReadOnlyBanner`. Не расширять покупку на monthly в S3a — старый submit = lifetime. Не тащить T−7 в S3b.

### 8.49. Лендинг без vi

CRM i18n — ru/en/vi. Лендинг — только `en.ts` / `ru.ts`. S7 не создавать `vi.ts` на лендинге.

### 8.50. Digest разработчику

S4 считает истечения и даёт SQL-source. Письмо/Telegram digest — строки outbox **S5b**. Иначе снова inline email в expire-cron.

### 8.51. `suspended`: SELECT org только у owner

Policy `organizations_select_member` (комментарий в SQL: «suspended visible to owner») пускает строку org при suspended **только owner**. Director/teacher не читают `organizations` → `OrganizationProvider.organization = null` → `LicenseSettingsPage` вечный LoadingState; `OrgWorkspaceRoute` не видит `status` и не редиректит. License/subscription SELECT всё равно требуют `organization_allows_reads` — даже owner без периода на экране.

**Рекомендация (S3a, явное RLS):** при `status=suspended` SELECT `organizations` всем active members (нужен shell/редирект). SELECT `organization_licenses` + `organization_subscriptions` — owner и director (recovery SKU/период). Clients/payments/schedule и прочий tenant data не открывать. Это не S2d.

---

## 9. Варианты: что добавить / убрать / изменить по узлу lifetime vs month

Ниже — развилки. **Жирным** — канон, который рекомендую принять.

### 9.1. Модель продукта

| # | Вариант | Суть | Плюс | Минус |
|---|---|---|---|---|
| **A** | **Два SKU, один ручной рельс** | как §2.1 | минимум нового; Inbox уже есть | нет автопродления |
| B | Месяц = time-limited lifetime key (`TDB-SUB-`, expires_at) | не трогать `organization_subscriptions` | проще Inbox (как ключ) | каждый месяц новый ключ; SQL-гейт Mini App ждёт **subscription**, не expiry license; Billing/Stripe-заготовка мертвеет |
| C | Включить Stripe | checkout + webhook | автосписание | другая юрисдикция/карты; UI waitlist врал месяцами; ломает «как lifetime» |
| D | Только month, lifetime снять с витрины | SaaS-only | проще витрина | early users + grandfathering; ломает лендинг и Inbox activate key |
| E | Month как «подписка», но активировать тем же lifetime ключом каждый раз | путаница | — | **отклонить**: ключ lifetime вечный, период не из чего истекает |

**Канон: A.** Таблица подписок уже есть и уже вписана в writes + Mini App. Не обходить её ключами.

### 9.2. Что убрать

- **`SubscriptionWaitlistCard` и тексты «Stripe скоро»** с лицензии.
- Подсказку `stripeSoonHint` с `ActivateKeyPage` и соответствующие i18n-строки.
- Кнопки Month/Year в disabled-состоянии (year не продаём).
- С экрана покупки — ощущение, что месяц «ещё не готов».
- Не убирать: поле активации `TDB-LIFE-…` (апгрейд и ручная выдача).
- Не убирать: email-уведомление заявок (бот дополняет).
- Не убирать: ссылки Email/Telegram/WhatsApp.
- Не удалять Stripe Edge в этом релизе (мёртвый код можно вычистить позже отдельным микропатчем).
- Не удалять `platform_waitlist` (история email); скрыть UI.

### 9.3. Что добавить

- SKU month + `request_kind`, stable method code, server quote и submit idempotency.
- `crmLifetime`/`crmMonthly` и monthly override в Dev Console (§3).
- Атомарный Activate month в Inbox без lifetime key.
- Cron past_due/suspend + баннер продления.
- Общий notification outbox + платформенный бот (§5).
- CTA помощи на login/forgot.
- Алерт `org_created`.
- Копирайт лендинга.
- Журнал активированных месяцев в Inbox (activated filter уже есть).

### 9.4. Что изменить в lifetime-узле (минимально)

Lifetime **не ломать**. Точечные изменения:

1. Экран покупки: сначала выбор SKU, потом те же реквизиты (сумма lifetime vs month). Показ панели — §4.1, не только demo (**S3b**, не S3a).
2. `PurchaseRequestPanel`: слать `quote_id` + `client_request_id` (сейчас kind **не** передаётся панелью, но хук всё равно шлёт `crm_license`). **Не** прокидывать `requestKind` с клиента.
3. `LicenseSettingsPage`: `RequirePermission` — покупка на `license.purchase`, ключ на `license.activate` (сейчас оба блока на `license.activate`, director не видит покупку). **S3a**.
4. Инструкция step5/step6: для month «активирует период на месяц, ключ не нужен»; для lifetime — как сейчас.
5. Inbox: подпись «CRM lifetime» оставить, рядом «CRM monthly».
6. Не менять формат/pepper/plaintext-once ключа, но перенести связанные DB-записи в атомарную RPC (повтор — 200 `already_activated`).
7. Убрать Stripe `?checkout=` с `LicenseSettingsPage`.

Не стоит: отдельная страница `/subscribe`. Не стоит: разные QR.

### 9.5. Цена и витрина

| # | Вариант | Рекомендация |
|---|---|---|
| **P1** | **`crmLifetime` + `crmMonthly` + per-method override + server quote snapshot** | да |
| P2 | Только per-method monthlyAmount, без crmMonthly | легко разъедется USDT vs банк |
| P3 | Только crmMonthly, методы без своих сумм месяца | не покрывает VND vs USD |
| P4 | Разные QR на месяц | пользователь явно запретил |

Показывать обе цены рядом: «Месяц · 29 USD» / «Навсегда · 199 USD». Источник только `crmMonthly`/`crmLifetime`. Fallback «первый bank/crypto» запрещён: порядок массива не является бизнес-правилом.

### 9.6. Активация месяца

| # | Вариант | Рекомендация |
|---|---|---|
| **M1** | **Inbox → atomic activate RPC → entitlement sync(manual)** | да |
| M2 | Генерировать monthly access key | нет, см. 9.1.B |
| M3 | Пользователь сам вводит «код месяца» | лишний шаг; lifetime тоже часто активируется без ввода |
| M4 | Авто-активация по комментарию без Inbox | нет, PAY-INBOX-1: человек проверяет деньги |

### 9.7. Продление

| # | Вариант | Рекомендация |
|---|---|---|
| **R1** | **Новая заявка crm_subscription + Activate month** | да, тот же UX что первая оплата |
| R2 | Кнопка «я оплатил» без новой заявки | потеря комментария/суммы |
| R3 | Автопродление без заявки | нет денег-автосписания |
| R4 | Напоминание только боту, пользователь пишет в личку | дубль каналов, тикета нет |

Напоминание владельцу: баннер в CRM за 7 дней **по `current_period_end` в UI**. Не email в v1 (можно добавить тем же transactional email позже).

### 9.8. Бот уведомлений

| # | Вариант | Рекомендация |
|---|---|---|
| **T1** | **Источник → notification outbox → worker sendMessage/email** | да: токен в secret, chat_id в settings row |
| T2 | Только заменить email на Telegram в `submit-purchase-request` | не покрывает login/org_created |
| T3 | Пользователь пишет боту, бот парсит | нет привязки user, спам, не «кнопки в CRM» |
| T4 | Взять бота студии / drain `renter-booking-worker` | **запрещено** (§1.4, §8.38) |
| T5 | Двусторонний тред (ответ из Telegram виден в CRM) | v2, не блокер |
| T6 | Inline-кнопка «Activate month» прямо в Telegram | удобно, но нужен auth разработчика в callback; **v1.1**. Сначала Inbox |
| T7 | Оба (token и chat_id) в Edge secrets | Save из консоли невозможен; **отклонить** |

Секреты: только токен бота + `DEV_CONSOLE_PUBLIC_URL` + `DEVELOPER_NOTIFY_EMAIL` / SMTP как сейчас. Chat id не в JSON оплаты и не обязан быть secret. URL/username бота пользователю не нужен. Telegram webhook в v1 отсутствует. Личка или одна группа — один chat_id.

### 9.9. Forgot password

Сейчас: GoTrue email. Кнопка тикета — **дополнение**, когда письма нет / почта потеряна.

Не делать: бот присылает новый пароль в Telegram. Сброс пароля owner без почты — уже Dev Console `dev-console-reset-owner-password` + recovery code (`decision_log` owner transfer). Тикет `forgot_password` = «разработчик, зайди в Tenants».

### 9.10. Новая база

Не путать с `request-demo-key` (письмо с ключом демо — отдельный устаревший путь). Self-service уже создаёт org сам.

Алерт `org_created` ≠ заявка на оплату и ≠ support ticket. Не активировать лицензию из этого события.

---

## 10. Рекомендуемый канон (сводка)

1. Ручной месяц тем же Inbox/QR, kind `crm_subscription`; активация одной idempotent DB RPC, entitlement через `provider=manual`.
2. Lifetime без изменений продукта, но его многошаговую активацию тоже сделать атомарной.
3. Цены: `crmLifetime`/`crmMonthly` + per-method override; заявка хранит server-resolved quote snapshot и method code; QR общие.
4. Waitlist/Stripe скрыть; year не продавать.
5. Истечение: cron past_due → grace 7д → suspended; данные живы; Mini App следует writes.
6. Апгрейд в lifetime разрешён; downgrade запрещён; prorate не кодировать.
7. Бот платформы отдельный, outbound-only, без webhook; **подключаем в S5**; студийный бот и `renter-booking-worker` не трогать; токен в secret, chat_id в `platform_notification_settings`; чеклист §5.8.
8. Email и Telegram доставляет единый notification outbox; источник не зависит от каналов.
9. Гостевые тикеты — Turnstile, без enumeration.
10. Лендинг править в том же релизе.
11. Подверсия **2.11.0** открывается в **S1**; узел закрывается **S7** (лендинг + docs). Не ждать S7, чтобы начать бамп.
12. Чеки файлом в CRM не принимать в v1.

---

## 11. Вопросы владельцу (только продуктовые блокеры)

Коротко ответить по пунктам:

1. Grace: **7 дней** read-only ок?  
   **Решение S0 (2026-09-11):** да — как §2.3: запись закрыта с `period_end`; `[period_end, grace_end)` при `grace_end = period_end + 7 days`, чтение tenant data при `licensed` до `grace_end`; после — `canceled` + `suspended`.
2. Старт периода: **дата Activate**, не 1-е число месяца?  
   **Решение S0 (2026-09-11):** да — первый `period_start = now()` сервера в момент Activate в Inbox; не 1-е число и не Inbox `defaultPeriod()` add-on (UTC month).
3. Продление до конца периода **сдвигает конец по calendar anchor**, а не «сейчас+30 дней»?  
   **Решение S0 (2026-09-11):** да — как §2.3: до `period_end` только сдвиг `period_end` по `billing_anchor_day`; после `period_end` — новый `period_start = now()`, anchor пересчитывается.
4. Нужен ли **год** сразу? (рекомендация: нет — кодировать дефолт)  
   **Решение S0 (2026-09-11):** дефолт спеки, владелец не возразил — год не продавать в этом узле; yearly в схеме не трогать, UI year/waitlist убрать (§2.1, §10 п.4).
5. Алерт **каждой** новой демо-базы? (рекомендация: да, с digest при шуме — кодировать дефолт)  
   **Решение S0 (2026-09-11):** дефолт спеки, владелец не возразил — `org_created` на каждую self-service demo; при шуме — digest (§5.6, S5b), не отключать алерт.
6. ~~Служебная группа или личка?~~ **Решено (2026-09-11):** бот подключаем; один chat_id — группа предпочтительна, личка допустима. Не блокер кода.
7. ~~Username/token BotFather?~~ **Решено (2026-09-11):** подключить в S5 по §5.8; пользователям CRM username не показывать. Не блокер S1–S4.
8. Лендинг меняем сразу (убрать смысл «No monthly subscription», оставить «без карты/автосписания»)?  
   **Решение S0 (2026-09-11):** да — правки лендинга en+ru в **S7** того же релиза: два тарифа CRM, без «месяца нет»; акцент «без карты / без автосписания», не Stripe.
9. Early bird lifetime ещё продаём или только обычная цена в QR?  
   **Решение S0 (2026-09-11):** только **обычная** цена lifetime в конфиге/QR; early bird **не продаём** — промо-период окончен; в S1/S7 не показывать просроченный early bird.
10. Чек только текст+внешний Telegram, без upload? (рекомендация: да — дефолт)  
    **Решение S0 (2026-09-11):** дефолт спеки, владелец не возразил — v1 без upload чека в CRM; комментарий + контакты + ссылка на внешний Telegram (§10 п.12, §9.4).
11. Подтверждаем **только Inbox** в v1, без inline Activate/webhook? (рекомендация: да — дефолт)  
    **Решение S0 (2026-09-11):** дефолт спеки, владелец не возразил — активация только Dev Console Inbox; без inline Activate из Telegram и без webhook бота в v1 (§9.11, §10 п.11).
12. Review-hold своевременной заявки на **72 часа после `data_purge_at`** ок? (рекомендация: да; без него paid request может быть удалён purge)  
    **Решение S0 (2026-09-11):** да — `purchase_review_hold_until = data_purge_at + 72 hours` для заявки, отправленной до `data_purge_at`; иначе strict purge по CASCADE (§4.2, §8.29).

Технические пункты `crmLifetime`, quote snapshot, atomic RPC, owner/director split, outbox, chat_id в settings row, отсутствие webhook в v1 уже канон, не вопросы.

**Блокеры продуктового копирайта и lifecycle:** ответы **1–3, 8–9, 12**. **6–7 закрыты.** **4–5, 10–11** — дефолты из §8/§9, если владелец не возражает.

**S0** записывает явные ответы владельца **сюда** (строка `Решение S0 (YYYY-MM-DD): …` под каждым из п. 1–3, 8–9, 12 и пометку дефолтов 4–5, 10–11). Без этой записи код-промпты не начинать.

S1 — контракт цены (без продажи месяца в CRM). S2a–S2d — SQL/Edge/Inbox/RLS INSERT заявок. S3a — RBAC, гейты, RLS recovery SELECT **без** monthly-витрины. S3b — витрина quote. S4 — expire UI + cron (digest **source** только; enqueue — S5b). S5a — token/settings/outbox/worker. S5b — Detect + `org_created` + digest enqueue. S6 — формы тикетов; merge не требует двустороннего бота.

---

## 12. Риски и анти-паттерны

- Смешать бота арендатора и бота платформы.
- Активировать month кнопкой lifetime (получится вечная лицензия за месячные деньги).
- Клиентский INSERT `request_kind` в обход Edge.
- Поверить сумме клиента или перечитать текущий config вместо quote snapshot.
- Вычислить lifetime-карточку по «первому» способу оплаты.
- Активировать заявку несколькими независимыми DB-записями.
- Считать `period_end = null` бессрочным manual active.
- Потерять anchor на датах 29–31.
- Включить Stripe «заодно».
- Писать токен бота в `platform_payment_methods` (таблица читается любой сессией).
- Слать recovery code / новый пароль в Telegram.
- Purge org за неуплату месяца.
- Удалить demo и pending purchase request по CASCADE до ручной проверки либо позволить заявками бессрочно отодвигать purge.
- Renter JWT на support/purchase Edge.
- Enumeration на гостевом тикете («email не найден»).
- Несогласованные парсеры без versioned fixtures/contract test.
- Считать `past_due` в UI и не в SQL (или наоборот) — касса «оплачено» при мёртвой лицензии.
- Создавать support ticket для каждого purchase/org_created вместо ссылки outbox на настоящий источник.
- Сохранять IP простым hash (перебирается); нужен keyed HMAC с retention.
- Строить Telegram-ссылки/Markdown из неэкранированного пользовательского ввода.
- Название «подписка» в UI лицензии без префикса CRM — путаница с абонементом ученика. Копирайт: «Подписка на CRM», не «Абонемент».
- Оставить покупку на `license.activate` **и** в `WRITE_ACTIONS` — director и любой read-only останутся без self-service.
- Показывать `ManualPurchasePanel` только если `isDemo`.
- Копировать Inbox `defaultPeriod()` (1-е число UTC) в Activate month.
- Вызвать `sync_organization_subscription(canceled)` до записи lifetime.
- Писать chat_id в Edge secret и ждать Save из Dev Console; писать токен в `platform_notification_settings` / JSON оплаты.
- Встроить drain в `renter-booking-worker` или взять бота студии.
- Считать Detect сломанным из-за Group Privacy: сначала `my_chat_member` и ручной paste.
- `setWebhook` на платформенном боте — ломает `getUpdates` Detect.
- Вызывать `getUpdates` из `platform-notification-worker` (конфликт с Detect, потеря chat_id).
- Не уводить `suspended` с workspace на `/license-required` (кроме license recovery).
- Не переводить `suspended` / истёкший `period_end` в UI read-only.
- Прокинуть `request_kind` с клиента вместо quote.
- Сделать SKU из `?plan=` источником истины.
- Показать старый `ManualPurchasePanel` monthly-орге до server quote (S3a без S3b) — заявка уйдёт как lifetime.
- На `/license-required` оставить «назад в CRM» при `suspended` — цикл с `OrgWorkspaceRoute`.
- Копировать add-on `defaultPeriod()` (date-only, 1-е UTC) в CRM-месяц.
- Слать developer digest из S4 до outbox S5b (некуда класть / снова inline email).
- Расширить `showManualPurchase` и ждать Stripe `?checkout=` в одном промпте с quote — нет: checkout убирать в S3a, quote — S3b.
- Бампить **2.11.0** только в S7, оставив S1–S6 на 2.10.39 — ломает VER-1.
- Редирект `suspended` без SELECT `organizations` всем members — director/teacher не узнают status (§8.51).
- S2b сделать submit fail-closed без quote **и** не дать выбрать способ — сломает lifetime до S3b.
- Тащить баннер T−7 в S3b — это **S4**.
- Путать «два фактора на сброс пароля» с промптом **S09** аудита безопасности (касса).

Уроки рядом: `PAY-INBOX-1` (заявка важнее канала доставки), S37 (Turnstile + одинаковый ответ), S40 (`DEVELOPER_NOTIFY_EMAIL` не хардкодить), HALL-RENT-SELF-2 (Mini App следует купленному CRM).

---

## 13. Нарезка внедрения (после согласования §11 / S0)

Порядок, чтобы не сломать lifetime. Детальные промпты — **§16** (S2/S3/S5 нарезаны на подпромпты: один чат = один номер).

0. **S0** — закрыть блокеры §11 п. 1–3, 8–9, 12 (записать ответы в §11). Дефолты 4–5, 10–11 из §8/§9, если владелец не возражает. Бот не блокирует S1–S4; **S5a+S5b** — BotFather + token + chat_id (§5.8).
1. **S1 — контракт цены.** `schemaVersion`, `pricingRevision`, `crmLifetime`, `crmMonthly`, stable method code (crypto `id`), resolver + contract fixtures; Dev Console/backfill. CRM ещё **не** продаёт месяц. Бамп **2.11.0**.
2. **S2a — SQL.** `platform_purchase_quotes`; CHECK `crm_subscription`; quote/idempotency/activated-period; `purchase_review_hold_until`; anchor/constraints; атомарные submit/activate RPC (lifetime **до** cancel). GRANT INSERT authenticated **ещё не** снимать.
3. **S2b — Edge quote + submit.** `create-purchase-quote` + `submit-purchase-request` через RPC; email заявок **ещё inline** (outbox — S5a). Можно создать monthly-заявку без CRM UI (Deno/curl).
4. **S2c — Inbox + Billing.** Activate month/lifetime одной RPC; идемпотентный 200; фильтр kind; Billing create/extend. Можно активировать месяц вручную без UI CRM.
5. **S2d — RLS.** Отозвать authenticated INSERT `platform_purchase_requests`; trigger kind не ослаблять для JWT. Отдельная явно проверенная миграция.
6. **S3a — RBAC и гейты.** `license.purchase`; оба license-* вне `WRITE_ACTIONS`; waitlist/`?checkout=`/`stripeSoonHint` убрать; `OrgWorkspaceRoute` + копирайт `LicenseRequiredPage`; RLS §8.51. **`showManualPurchase` оставить demo-only** (старая форма не должна слать lifetime за месяц).
7. **S3b — CRM витрина.** Порядок SKU→method→quote→submit; панель для demo + monthly + suspended recovery; продление; `?plan=` только предвыбор.
8. **S4 — cron expire + effective read-only.** Batch past_due/suspend; `isReadOnly` по §8.4; T−7 UI; Mini App regression; копирайт `ReadOnlyBanner`. Digest — только SQL-source, enqueue в S5.
9. **S5a — outbox + worker.** Таблицы settings/outbox; `platform-notification-worker`; purchase email с inline на outbox; Telegram `blocked` без token/chat_id.
10. **S5b — Detect + org_created.** Dev Console Detect/paste/Save/Send test/requeue; `DEV_CONSOLE_PUBLIC_URL`; enqueue `org_created` в той же транзакции, что INSERT demo-org; digest enqueue из SQL-source S4.
11. **S6 — тикеты.** `platform_support_tickets` + `submit-support-ticket` + формы login/forgot/шапка/license_help; Support-вкладка Inbox.
12. **S7 — лендинг + docs.** Копирайт 2.11; `decision_log.md`; `architecture.md`.

Не начинать с бота: без Inbox-месяца алерты «оплатил» некуда приземлять.
Не начинать S3b, пока S2b не отдаёт quote и S2c не активирует month.

---

## 14. Файлы-якоря (для следующего чата)

Не читать всё подряд — codegraph по именам:

- `LicenseSettingsPage` `ManualPurchasePanel` `PurchaseRequestPanel` `SubscriptionWaitlistCard` (`showManualPurchase`, `?checkout=`)
- `parseManualPaymentConfig` (CRM) `formStateToConfig` `configToFormState` (Dev Console — **отдельный** файл, функции `parseManualPaymentConfig` там нет) `overlayPaymentAmounts` `PaymentMethodsPage` + новый `resolvePaymentQuote` (crypto **без** `id` сейчас)
- `submit-purchase-request` `dev-console-purchase-inbox` `sync_organization_subscription` (`canceled` → suspend)
- `platform_purchase_requests_kind_guard` `dev-console-adjust-subscription`
- `organization_allows_writes` `organization_has_active_subscription` `renter_miniapp_addon_is_active` (`schema_version_locked`)
- `create-self-service-demo-org` `ForgotPasswordPage` `AuthDeveloperContact` `LoginPage`
- `OrganizationProvider` (`isReadOnly`) `permissions.ts` (`WRITE_ACTIONS`, `license.view` / `license.activate`; целевой `license.purchase`) `canAccessSettingsSection` (license nav) `useDemoLicenseUi` `DemoPurchaseCta` `LicenseRequiredPage` `ReadOnlyBanner` `OrgWorkspaceRoute`
- `create-subscription-checkout` `stripe-webhook` — не подключать
- `renter-telegram-webhook` `renter_telegram_outbox` `renter-booking-worker` `_shared/renterTelegramOutboxDrain.ts` `telegramToken.ts` — паттерн lease/`sendMessage`; tenant AES/таблицы/этот worker не переиспользовать
- `platform-notification-worker` `platform_notification_outbox` `platform_notification_settings` `submit-support-ticket` `create-purchase-quote` — целевые имена §5–§7 (в коде пока нет)
- лендинг `tangodb-landing/src/i18n/{en,ru}.ts` `pricing.afterTrial.*` `faq.a10` `pricing.earlyBird.*` `faq.a6` `faq.a8` `pricing.step.decide` (файла vi на лендинге нет)

---

## 15. Что считается «готово»

- До `data_purge_at` demo owner/director выбирает месяц, выбирает способ, видит точную сумму и шлёт idempotent заявку с server quote snapshot; bounded review-hold защищает её от purge, но не продлевается спамом. Director видит покупку; read-only не прячет purchase/activate.
- Разработчик получает Telegram + email, в Inbox жмёт Activate month — одна транзакция активирует CRM до `period_end`, записывает период в заявке, включает Mini App; lifetime-ключа нет. Повтор того же request — 200 без второго месяца.
- Через месяц без оплаты: read-only с момента `period_end` (не ждать cron), Mini App выкл, данные на месте, CTA продлить. После grace — suspended, workspace на `/license-required`, покупка доступна.
- Продление сдвигает период по сохранённому anchor; две подтверждённые заявки добавляют два месяца.
- Покупка lifetime поверх месяца атомарно даёт lifetime и гасит подписку **без** промежуточного suspend; month поверх lifetime отказан.
- Новая регистрация → одно platform event/outbox. «Не могу войти» / «нет письма сброса» → support ticket с нейтральным ответом и без раскрытия существования email.
- Support ticket виден и закрывается в developer-only Dev Console inbox; Telegram не является источником статуса.
- Каналы доставки можно ретраить независимо; сбой Telegram/email не теряет заявку/тикет. Пока бот не настроен — Telegram `blocked`, email жив. После S5: «Send test» в Dev Console + реальная заявка → сообщение в служебный чат.
- Grace `past_due`: read-only writes, reads работают; после grace `suspended` — редирект `/license-required`, reads закрыты.
- Студийные боты арендаторов и `renter-booking-worker` не затронуты. Direct authenticated INSERT заявки закрыт отдельной RLS-миграцией. Stripe UI не появился.

---

## 16. Промпты реализации (строго по порядку)

Готовые блоки для нового чата. Источник истины — **этот файл** (§1–§15 + сверка 2.10.39), не память модели и не `renter_telegram_miniapp.md` как шаблон продукта. Раздел **не меняет** продукт: только нарезка работ по §13. Если короткий блок и длинный `#### S*` расходятся — **длинный + §1–§12**. Имена таблиц/Edge из длинного блока.

Карта версий: текущая CRM на момент промптов = **2.10.39**. **S0** без бампа. **S1** (первый код) → **2.11.0**. Каждый следующий код-промпт → `2.11.y` +1 от **фактического** `APP_VERSION`. Timestamp миграции — следующий после последнего файла в `tangodb/supabase/migrations/`, не дата из промпта.

### Как запускать

1. Новый чат / новый контекст на **один** номер (S0, затем S1, … S7).
2. Скопировать целиком короткий блок из **«Последовательность промптов»**. Длинный `#### S*` агент читает сам и выполняет буквально.
3. Шаги внутри длинного блока — **сверху вниз**. Не перескакивать. Не «доделывать» соседний S*, даже если файл тот же.
4. Не начинать промпт N, пока N−1 не закрыт (DoD в конце длинного блока). После DoD поставь `[x]` в чеклисте **шапки** и в **«Последовательность промптов»** ниже.
5. Не объединять промпты «за один прогон, быстрее». Не писать «сделай S1–S7» / «сделай весь S2». «Этап 2/3/5» — только группировка длинных блоков, не разрешение запускать S2a–S2d параллельно.
6. Если упираешься в правило из §1–§12, которого нет в текущем S* — остановись и напиши, какой промпт его закрывает. Не выдумывай продукт.
7. Короткий блок — только вход в чат. Шаги, DoD и исключения — в длинном `#### S*`. Не копируй длинный блок в чат целиком.
8. Повтор чата / частичный код: если **один** артефакт шага уже есть — проверь тестом и **продолжи остальные шаги этого же S***. Стоп всего номера только если DoD закрыт или контур 2.11 уже чужой (S1: `APP_VERSION` уже 2.11.x не из этого файла).
9. **S0 обязателен.** Нет строк `Решение S0` в §11 по п. 1–3, 8–9, 12 — не начинать S1.

### Общие правила (все промпты с кодом)

- Сначала `.cursor/docs/ai/AI_CONTEXT.md`, затем этот файл (указанные § + длинный `#### S*`) и `codegraph_explore` по символам задачи (`projectPath`: `D:\cursor_dev\TangoDB\tangodb`; для Dev Console — `tangodb-dev-console`; лендинг S7 — без codegraph, читать `tangodb-landing/src/i18n/{en,ru}.ts`).
- Логика Supabase — только `tangodb/src/hooks/` и `tangodb/src/lib/` (+ Edge `_shared`). Не в компонентах. Не дублировать хуки/компоненты.
- RLS не ослаблять и не обходить. RLS менять **только в S2d** (и гранты новых таблиц в том S*, который их создаёт). Новые таблицы: `auto_expose_new_tables = false`; **без** `GRANT SELECT/INSERT` `authenticated` на quotes/outbox/settings/tickets (доступ — Edge/RPC `service_role` / SECURITY DEFINER).
- Не трогать студийный Mini App: `renter-booking-worker`, `renter_telegram_outbox`, `decryptTelegramBotToken`, webhook арендатора, `organization_addons` как продукт. Общий HTTP `sendTelegramMessagePlain` — только S5a, без смены источника токена студии.
- Не включать Stripe UI. Не удалять `create-subscription-checkout` / `stripe-webhook` в этом узле.
- Не писать токен бота в `platform_payment_methods` / `platform_notification_settings`. Chat id — не Edge secret.
- Деньги: decimal/text суммы как сейчас в payment config, не JS `number` как источник истины. Quote/RPC — сервер.
- i18n CRM: `ru.ts` / `en.ts` / `vi.ts` / `keys.ts`. Копирайт лицензии: «Подписка на CRM», не «Абонемент». Select — `AppSelect`.
- После кода: `.cursor/docs/ai/changelog.md`. Бамп `APP_VERSION` + `tangodb/package.json` (правило версий выше). Архитектуру — только S7 (S1 может короткую строку VER-1 в `decision_log.md`).
- В конце прогона: `npx tsc --noEmit` в затронутых приложениях (`tangodb/`; с S1 ещё `tangodb-dev-console/`; с S7 ещё лендинг если там tsc). Новых ошибок tsc не добавлять.
- Клиентские типы после миграции: `tangodb/src/types/database.ts` (`npm run db:gen-types` если linked; иначе точечный патч).
- Патч SQL: **ALTER / CREATE OR REPLACE текущего тела** (`sync_organization_subscription`, `organization_has_active_subscription`, `purge_expired_demo_organizations`, `submit-purchase-request`, `dev-console-purchase-inbox`). Не `CREATE OR REPLACE` с нуля из старой миграции.
- Карта работ по промптам (не тащить «весь §7» в текущий шаг): **S1** — конфиг v2, не quotes table, не CRM monthly submit; **S2a** — SQL quotes/kind/hold/RPC, не Edge UI; **S2b** — Edge quote+submit + выбор способа для lifetime-quote, email ещё inline; **S2c** — Inbox/Billing, не CRM витрина; **S2d** — только RLS INSERT заявок; **S3a** — RBAC/waitlist/redirect + RLS recovery SELECT, `showManualPurchase` demo-only; **S3b** — витрина quote (без T−7); **S4** — cron+isReadOnly+T−7, не outbox; **S5a** — outbox+worker+migrate purchase email; **S5b** — Detect+org_created+digest enqueue; **S6** — тикеты; **S7** — лендинг+docs.

### Ловушки нарезки (не повторять)

| Путаница | Правильно |
|---|---|
| «Сделай S2 целиком» | Один чат = один S2*. S2a не пишет Edge |
| S3a расширяет `showManualPurchase` на monthly | Нет. Старый submit = `crm_license`. Витрина — **S3b** |
| `requestKind` с клиента | Запрещено. Kind только из server quote (**S2b**) |
| Inbox `defaultPeriod()` для CRM-месяца | Запрещено (§8.45). Сервер §2.3 |
| Email заявки в outbox в S2b | Inline до **S5a** (PAY-INBOX-1: заявка важнее канала) |
| Digest Telegram в S4 | SQL-source в S4; enqueue — **S5b** |
| Drain в `renter-booking-worker` | Запрещено. `platform-notification-worker` (**S5a**) |
| `setWebhook` / `getUpdates` в worker | Запрещено. Detect only (**S5b**) |
| Chat id в Edge secret | Таблица settings (**S5a/S5b**) |
| Token в `platform_payment_methods` | Только `PLATFORM_TELEGRAM_BOT_TOKEN` |
| RLS INSERT «заодно» в S2a | Только **S2d**, после того как Edge зовёт RPC |
| `sync_organization_subscription(canceled)` до lifetime | Lifetime license + licensed **первыми** (**S2a/S2c**) |
| Бамп 2.11.0 в S7 | Открывает **S1** |
| Тикет на purchase / org_created | Нет. source_type на настоящий источник (**S5/S6**) |
| Гостевой тикет без Turnstile | Fail-closed (**S6**) |
| Лендинг `vi.ts` | Нет файла. S7 = en+ru |
| Stripe checkout «подключить раз уж Edge есть» | Не вызывать из UI |
| `overlayPaymentAmounts` как quote | Нет. `resolvePaymentQuote` на сервере (**S1/S2b**) |
| `license.purchase` в `WRITE_ACTIONS` | Оба license-* **вне** set (**S3a**) |
| Redirect `past_due` на `/license-required` | Только `suspended` (**S3a**). `past_due` остаётся в workspace |
| `isReadOnly` в S3a | Формула expiry — **S4**. S3a не подменять её |
| Support inbox в S5 | Список тикетов — **S6** |
| `org_created` в S2 | Outbox ещё нет. **S5b** |
| Мерж S3a на прод без S3b | Waitlist снят, месяца нет. S3a+S3b одним релизом |
| S2b fail-closed quote без выбора способа | Сломает lifetime. В S2b обязателен выбор **одного** метода для lifetime-quote; SKU month и перестановка формы — **S3b** |
| T−7 CTA/баннер в S3b | Только **S4** |
| Редирект suspended без RLS SELECT org | Director не увидит status. **S3a** §8.51 |
| «S9 два фактора» = аудит S09 | Нет. Сброс пароля — Dev Console + recovery code. Аудит S09 — касса |
| `parseManualPaymentConfig` в Dev Console | Там `formStateToConfig` / `configToFormState`. Один контракт, два адаптера (**S1**) |

### Последовательность промптов (для владельца)

Ставь `[x]` в чекбокс **после закрытия DoD** этого номера (и ту же галочку в шапке файла). Не отмечай заранее. Следующий номер — только когда предыдущий закрыт.

Как запускать: новый чат → скопировать **только** fenced-блок под номером → агент сам читает длинный `#### S*` в этом файле.

- [x] **S0** — закрыть блокеры §11 (только документ; код запрещён)

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md: шапка «Очередь §16», §2.3, §8.3–8.5, §8.16–8.17, §8.29, §11, §16 «Общие правила» / «Ловушки» и #### S0.

Задача: только S0. Выполни блок S0 буквально. Код не писать. Зафиксируй ответы владельца в §11. Без явных ответов на п. 1–3, 8–9, 12 — стоп и перечисли, чего не хватает.

Не переходи к S1. DoD закрыт — стоп.
```

- [x] **S1** — контракт цены v2 + Dev Console/backfill + **2.11.0**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §3, §8.2, §8.24–8.25, §8.35, §16 #### S1. codegraph CRM: parseManualPaymentConfig overlayPaymentAmounts. Dev Console: PaymentMethodsPage formStateToConfig configToFormState (функции parseManualPaymentConfig в консоли нет).

Задача: только S1. Предшественник S0 (строки Решение S0 в §11). Выполни блок S1 буквально. CRM месяц не продавать. Quotes table не создавать (S2a). overlayPaymentAmounts не делать источником quote. Один контракт schemaVersion 2 — два адаптера (CRM parse / Dev Console form).

Не переходи к S2a. DoD закрыт — стоп.
```

- [x] **S2a** — SQL: quotes, kind, hold, anchor, submit/activate RPC

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §2.3, §4.2–4.3, §6, §8.20, §8.26–8.27, §8.29, §8.36, §16 #### S2a. codegraph: sync_organization_subscription organization_has_active_subscription organization_allows_writes platform_purchase_requests_kind_guard purge_expired_demo_organizations.

Задача: только S2a. Предшественник S1. Выполни блок S2a буквально. Не Edge UI. Не снимать GRANT INSERT (S2d). Не копировать defaultPeriod() / defaultAddonPeriod(). Lifetime в activate RPC — до cancel subscription.

Не переходи к S2b. DoD закрыт — стоп.
```

- [x] **S2b** — Edge `create-purchase-quote` + `submit-purchase-request`

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §3.2, §4.2, §8.18, §8.31, §8.35, §16 #### S2b. codegraph: submit-purchase-request useSubmitPurchaseRequest ManualPurchasePanel.

Задача: только S2b. Предшественник S2a. Выполни блок S2b буквально. Тело submit = quote_id + client_request_id, не request_kind/сумма. Для lifetime-quote обязателен выбор одного способа (иначе fail-closed сломает текущую покупку). SKU month и перестановка формы — S3b. Email ещё inline (S5a). Lifetime-орг → monthly quote fail-closed. RLS INSERT не трогать (S2d).

Не переходи к S2c. DoD закрыт — стоп.
```

- [x] **S2c** — атомарный Inbox Activate month/lifetime + Billing

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §4.3–4.4, §8.21–8.22, §8.26, §8.36, §8.39, §8.45, §16 #### S2c. codegraph: PurchaseInboxPage defaultPeriod dev-console-purchase-inbox dev-console-adjust-subscription (tangodb-dev-console + Edge).

Задача: только S2c. Предшественник S2b. Выполни блок S2c буквально. Activate month без TDB-LIFE. Повтор activated = 200 без сдвига периода и без plaintext. Не defaultPeriod() / defaultAddonPeriod(). CRM витрину не делать (S3b).

Не переходи к S2d. DoD закрыт — стоп.
```

- [x] **S2d** — RLS: отозвать authenticated INSERT заявок

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §4.2 (абзац про INSERT), §8.18, §16 #### S2d.

Задача: только S2d. Предшественник S2c. Выполни блок S2d буквально. Одна явно проверенная RLS-миграция: отозвать authenticated INSERT platform_purchase_requests. Не ослаблять другие политики. Не трогать Inbox UI. Не делать RLS recovery SELECT для suspended (это S3a §8.51).

Не переходи к S3a. DoD закрыт — стоп.
```

- [x] **S3a** — RBAC/гейты/waitlist/`LicenseRequired` (панель покупки ещё не monthly)

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §2.2, §4.1, §6, §8.4, §8.30, §8.33–8.34, §8.46, §8.48, §8.51, §16 #### S3a. codegraph: WRITE_ACTIONS license.activate LicenseSettingsPage OrgWorkspaceRoute LicenseRequiredPage SubscriptionWaitlistCard ActivateKeyPage.

Задача: только S3a. Предшественник S2d. Выполни блок S3a буквально. showManualPurchase ОСТАВИТЬ demo-only. RLS recovery SELECT §8.51 — явное указание. Не формула isReadOnly по period_end (S4). Не SKU/quote UI и не T−7 (S3b/S4). Redirect только suspended. Activate-key на LicenseRequired — только owner.

Не переходи к S3b. DoD закрыт — стоп.
```

- [ ] **S3b** — CRM UI: SKU → quote → submit

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §4.1, §8.34, §8.40, §9.4, §16 #### S3b. codegraph: ManualPurchasePanel PurchaseRequestPanel useSubmitPurchaseRequest useDemoLicenseUi DemoPurchaseCta LicenseSettingsPage.

Задача: только S3b. Предшественник S3a. Выполни блок S3b буквально. Порядок SKU→method→quote→submit. Панель: demo + monthly + suspended recovery, не lifetime. Хуки без request_kind. ?plan= только предвыбор. T−7 баннер/CTA не делать (S4).

Не переходи к S4. DoD закрыт — стоп.
```

- [ ] **S4** — cron expire + effective `isReadOnly` + T−7

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §2.3, §4.5, §6, §8.4–8.5, §8.42, §8.50, §16 #### S4. codegraph: OrganizationProvider isReadOnly ReadOnlyBanner renter_miniapp_addon_is_active organization_has_active_subscription.

Задача: только S4. Предшественник S3b. Выполни блок S4 буквально. Cron past_due/suspend. isReadOnly по effective expiry. T−7 баннер и CTA в UI. Digest — SQL source, не Telegram/email. Не outbox (S5a).

Не переходи к S5a. DoD закрыт — стоп.
```

- [ ] **S5a** — outbox + worker + email заявок в outbox

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §5.1–5.2, §5.4, §5.8, §8.11, §8.28, §8.31–8.32, §8.38, §8.43, §16 #### S5a. codegraph: submit-purchase-request renterTelegramOutboxDrain renter-booking-worker.

Задача: только S5a. Предшественник S4. Выполни блок S5a буквально. Отдельный platform-notification-worker. Purchase email+telegram через outbox. Без token/chat_id Telegram=blocked, email жив. Не getUpdates в worker. Не Detect UI (S5b). Не тикеты (S6). Студийный worker не трогать, кроме опционального механического вызова общего sendTelegramMessagePlain.

Не переходи к S5b. DoD закрыт — стоп.
```

- [ ] **S5b** — Detect/Save/Send test + `org_created` + digest enqueue

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §5.6, §5.8, §8.12, §8.28, §8.43, §8.50, §16 #### S5b. codegraph: create-self-service-demo-org.

Задача: только S5b. Предшественник S5a. Выполни блок S5b буквально. Detect/paste/Save/Send test/requeue в Dev Console. org_created в той же транзакции, что INSERT demo. Digest enqueue из SQL-source S4. Не webhook. Username бота в CRM не показывать.

Не переходи к S6. DoD закрыт — стоп.
```

- [ ] **S6** — тикеты login/forgot/шапка

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §5.3, §5.5, §5.7, §8.13, §9.9, §16 #### S6. codegraph: LoginPage ForgotPasswordPage AuthDeveloperContact LicenseSettingsPage.

Задача: только S6. Предшественник S5b. Выполни блок S6 буквально. Гостевые тикеты: Turnstile fail-closed, нейтральный ответ, без enumeration. Не менять пароль из тикета (Dev Console reset + recovery code, не аудит S09). Не purchase/org_created как ticket. Support-вкладка Dev Console Inbox.

Не переходи к S7. DoD закрыт — стоп.
```

- [ ] **S7** — лендинг + architecture + decision_log

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_monthly_subscription_and_support_bot.md §8.16–8.17, §10, §15, §16 #### S7. Файлы: tangodb-landing/src/i18n/en.ts ru.ts, architecture.md, decision_log.md.

Задача: только S7. Предшественник S6. Выполни блок S7 буквально. Лендинг en+ru (не создавать vi.ts). Два тарифа CRM, без «No monthly subscription» как «месяца нет», без просроченного early bird. faq.a10: человек клиенту, бот — разработчику. Очередь §16 закрыта. Не выдумывай S8.

DoD закрыт — стоп.
```

---

### Этап 0

#### S0 — закрыть продуктовые блокеры §11

- [x] DoD закрыт

```
Задача: S0. Только документ. Код, миграции, бамп версии — запрещены.

Предшественник: нет. Если в §11 уже есть строки «Решение S0» по п. 1–3, 8–9, 12 — проверь полноту, не дублируй, допиши только пробелы.

Прочитай: §2.3, §8.3–8.5, §8.16–8.17, §8.29, §11.

Делай строго по шагам:

1. Получи от владельца явные ответы на §11 п. 1, 2, 3, 8, 9, 12. Рекомендации спеки не считать ответом.
2. По п. 4, 5, 10, 11: если владелец молчит — запиши «дефолт спеки, владелец не возразил»; если возразил — зафиксируй новое.
3. Впиши под каждым пунктом §11 строку `Решение S0 (YYYY-MM-DD): …`.
4. Если п. 1–3 подтверждены как в §2.3 — заголовок §2.3 оставь каноном. Если владелец выбрал иначе — поправь §2.3/§4.3/§4.5 согласованно (grace, start, renewal) и добавь пункт в §8.
5. Шапка: статус «S0 закрыт, можно S1». Чеклист шапки и §16 «Последовательность промптов»: [x] S0.
6. Не менять код. Не создавать бота. Не бампить версию.

DoD:
- §11 содержит явные решения по 1–3, 8–9, 12.
- Нет противоречия между §2.3 и этими ответами.
- Код не тронут.

Стоп. Не переходи к S1.
```

---

### Этап 1

#### S1 — контракт цены v2 и Dev Console

- [x] DoD закрыт

```
Задача: S1. schemaVersion 2, канон crmLifetime/crmMonthly, per-method override, stable methodCode, contract tests. CRM месяц не продаёт. Таблицы quotes нет.

Предшественник: S0 закрыт в §11. Если APP_VERSION уже 2.11.x чужой (нет schemaVersion в парсере) — стоп и скажи, что в коде. Если частичный S1 — доделай шаги.

Прочитай: §3, §8.2, §8.24–8.25, §8.35.
codegraph: parseManualPaymentConfig overlayPaymentAmounts (tangodb). PaymentMethodsPage formStateToConfig configToFormState (tangodb-dev-console; parseManualPaymentConfig там нет).

Делай строго по шагам:

1. Контракт config (CRM `parseManualPaymentConfig`, Dev Console `formStateToConfig`/`configToFormState`, Edge `_shared/paymentQuote.ts` — один schemaVersion, **не** копировать файлы вслепую):
   - schemaVersion (v1 compatibility = нет поля или 1; целевой 2).
   - pricingRevision: integer, клиент не задаёт следующее значение.
   - crmLifetime / crmMonthly: { amount, currency } обязательны в v2.
   - method.amount/currency остаются lifetime override; monthlyAmount/monthlyCurrency — monthly override.
   - methodCode: bankTransfer | vietnameseBankTransfer | mir; crypto — стабильный id (UUID), не индекс массива/адрес.
   - resolvePaymentQuote(config, sku, methodCode) → amount, currency, payment_details (текст, без data:image), qr_sha256. Fail-closed на битый SKU/метод/сумму/валюту.
   - overlayPaymentAmounts не источник истины и не расширять до quote.

2. Dev Console /payment-methods:
   - Секции «CRM — пожизненно» и «CRM — ежемесячно».
   - В каждом способе «Сумма / месяц» + «Валюта / месяц».
   - Подпись: QR/счёт общие, меняется сумма.
   - Crypto id read-only, генерируется один раз при backfill/save если пуст.
   - Save: compare-and-swap по pricingRevision; сервер инкрементирует revision при реальном изменении цен/способов.
   - Mini App цену по-прежнему скрыть/не продавать.

3. Backfill существующего JSON: schemaVersion=2, crmLifetime заполнен явно (не «первый банк» как правило UI), crmMonthly обязателен в форме; пока месяц не заполнен — monthly resolve fail-closed. Compatibility: старый lifetime-экран читает v1/v2.

4. Fixtures + тесты parse/resolve/round-trip для CRM, Dev Console и Edge. Кейсы: override VND vs USDT, нет crypto id, битый SKU, v1 без schemaVersion.

5. CRM LicenseSettingsPage / ManualPurchasePanel: не показывать месяц, не звать quote. Lifetime не ломать.

6. Бамп APP_VERSION + package.json → 2.11.0. decision_log VER-1: строка 2.11 — ручная месячная подписка CRM. changelog.md.

DoD:
- v2 сохраняется из Dev Console и читается CRM без поломки lifetime.
- Monthly amount без канона/override не угадывается.
- Crypto без id не является methodCode.
- 2.11.0 в обоих файлах версии.
- tsc чистый. CRM UI месяца нет.

Стоп. Не переходи к S2a.
```

---

### Этап 2

#### S2a — SQL: quotes, kind, hold, anchor, atomic RPC

- [x] DoD закрыт

```
Задача: S2a. Схема и RPC активации/submit. Без Edge-функций, без Inbox UI, без снятия GRANT INSERT.

Предшественник: S1 (v2 config).

Прочитай: §2.3 (канон после S0), §4.2–4.3, §6, §8.20, §8.26–8.27, §8.29, §8.36.
SQL: sync_organization_subscription, organization_has_active_subscription, organization_allows_writes, platform_purchase_requests_kind_guard, purge_expired_demo_organizations.

Делай строго по шагам:

1. platform_purchase_quotes: backend-only (нет GRANT authenticated SELECT/INSERT). Поля: id, organization_id, requester_user_id, sku (crm_license|crm_subscription), method_code, amount, currency, pricing_revision, payment_details_snapshot (текст, не data:image), qr_sha256, expires_at, consumed_at, created_at. Expired unused — bounded batch cleanup.

2. platform_purchase_requests: CHECK kind + crm_subscription (оставить renter_miniapp_addon). Поля: quote_id, client_request_id, method_code, amount, currency, pricing_revision, details fingerprint, activated_period_start/end. UNIQUE (requester_user_id, client_request_id). Trigger: authenticated не пишет crm_subscription/add-on; service_role/RPC может все три kind.

3. organizations.purchase_review_hold_until timestamptz NULL. Первая timely new crm_license|crm_subscription ставит hold = data_purge_at + 72h, повтор не двигает. Патч текущего purge_expired_demo_organizations: пропускать demo пока now < hold и есть eligible new (не add-on). Закрытие одной заявки снимает hold только если не осталось других eligible new. Активация лицензирует и чистит purge-поля.

4. organization_subscriptions: billing_anchor_day smallint CHECK 1..31 NULL. Для provider=manual AND status=active: обе даты NOT NULL AND end > start. organization_has_active_subscription: для manual не считать period_end IS NULL infinity. Helper add_calendar_month(start, anchor) без дрейфа 28/29/30/31. Продление до period_end: сдвиг только end; после expiry: start=now(), anchor заново.

5. RPC submit (SECURITY DEFINER): одна транзакция — lock+consume неистёкшего quote своей org/user, kind из SKU, INSERT заявки, hold. Lifetime-орг + crm_subscription → отказ. now >= data_purge_at → отказ. Не требовать organization_allows_writes. Идемпотентность по client_request_id. GRANT INSERT authenticated пока оставить (S2d).

6. RPC activate_platform_purchase_request(request_id, actor_id, optional_period_override, note): FOR UPDATE заявки, org, subscription (create-if-missing). Повтор activated → успех + сохранённый period, без сдвига, без plaintext. crm_subscription: без access_keys; provider=manual; две new monthly подряд = +2 месяца к end если entitlement жив. crm_license: lifetime license + licensed ПЕРВЫМИ, затем subscription canceled без suspend (§8.36). Month после lifetime — отказ. Параллель lifetime vs month: вторая отказ. Остальные new не авто-закрывать. Override периода только с note. Не defaultPeriod add-on.

7. SQL-тесты: atomic lifetime; month; concurrent two months +2; already_activated; null-end forbidden manual; anchor 28/29/30/31; upgrade не suspended; month-on-lifetime отказ; purge hold не продлевается спамом; заявка после data_purge_at отказ; Stripe null-end не сломан как отдельный кейс.

8. Бамп 2.11.y, changelog, database.ts.

DoD:
- RPC есть, GRANT INSERT authenticated ещё есть.
- Edge UI нет.
- Тесты SQL по списку.
- Lifetime-активация готова к вызову из Inbox (S2c).

Стоп. Не переходи к S2b.
```

#### S2b — Edge create-purchase-quote + submit-purchase-request

- [x] DoD закрыт

```
Задача: S2b. JWT Edge quote и submit через RPC S2a. Email заявок ещё sendTransactionalEmail inline. Не RLS.

Предшественник: S2a.

Прочитай: §3.2, §4.2, §8.31, §8.35.
codegraph: submit-purchase-request useSubmitPurchaseRequest ManualPurchasePanel.

Делай строго по шагам:

1. Edge create-purchase-quote (verify_jwt=true): owner/director, не renter. resolvePaymentQuote из S1. INSERT quote только backend. expires_at = min(now()+24h, data_purge_at). Если до purge < 15 минут — не выдавать. Rate-limit. Lifetime-орг + sku monthly — 403. Клиент не задаёт amount.

2. Патч submit-purchase-request: quote_id + client_request_id + контакты/комментарий. Не принимать request_kind, payment_method_code, сумму. Звать RPC S2a. Membership/renter как сейчас. Addon 403. Email inline + snapshot quote в тексте. Telegram не слать (S5a).

3. Чтобы не сломать lifetime в щели до S3b: научить текущий ManualPurchasePanel/хук слать quote для sku=crm_license. Quote требует methodCode — **обязателен выбор одного способа** до submit (чекбокс/радио по уже показанным реквизитам). Порядок «форма выше QR» можно не менять до S3b. SKU month не открывать. Legacy submit без quote — fail-closed.

4. Deno-тесты: spoof суммы, reuse quote, expiry, чужой org/user, renter forbidden, monthly на lifetime, purge window.

5. config.toml новой функции. Бамп 2.11.y, changelog.

DoD:
- Quote consume-once.
- Submit без quote не создаёт заявку.
- Lifetime-покупка на demo требует выбранный способ и quote_id (щель до S3b не ломает текущий рельс).
- Email всё ещё inline.
- GRANT INSERT не снят.

Стоп. Не переходи к S2c.
```

#### S2c — Inbox Activate month/lifetime + Billing

- [x] DoD закрыт

```
Задача: S2c. Dev Console Inbox и Billing на atomic RPC. Без CRM витрины месяца.

Предшественник: S2b.

Прочитай: §4.3–4.4, §8.21–8.22, §8.36, §8.39, §8.45.
codegraph: PurchaseInboxPage defaultPeriod dev-console-purchase-inbox dev-console-adjust-subscription.

Делай строго по шагам:

1. dev-console-purchase-inbox activate → activate_platform_purchase_request. Plaintext lifetime key только после успеха, один раз. Повтор: 200 без plaintext и без сдвига period. Activate month: без ключа; показать assigned period datetime. Не defaultPeriod() для CRM-месяца; превью с сервера. Override — note обязателен. Фильтр kind: lifetime | monthly | addon(legacy). Кнопка «Activate month».

2. Billing: provider manual|stripe; extend / past_due / canceled / даты через расширенный dev-console-adjust-subscription (period_start/end, create-if-missing, reason, actor, before/after в platform_audit_log). Те же проверки lifetime и периода.

3. Не генерировать TDB-LIFE для month. Не key_type=subscription.

4. Тесты идемпотентности Inbox. Бамп 2.11.y, changelog.

DoD:
- Месяц активируется из Inbox по заявке S2b без UI CRM.
- Два вызова одного request не дают два месяца.
- Upgrade month→lifetime не suspended.
- defaultPeriod add-on не используется для CRM-месяца.

Стоп. Не переходи к S2d.
```

#### S2d — RLS: отозвать authenticated INSERT заявок

- [x] DoD закрыт

```
Задача: S2d. Одна миграция RLS. Не фичи.

Предшественник: S2c (Edge submit идёт через RPC).

Прочитай: §4.2 последний абзац, §8.18. Явное указание на смену RLS — этот промпт.

Делай строго по шагам:

1. REVOKE INSERT ON platform_purchase_requests FROM authenticated. Удалить INSERT policy, если есть. CHECK kind оставить.
2. Trigger kind не пускать authenticated crm_subscription.
3. Тест: JWT INSERT → отказ; Edge/RPC submit → успех; service_role add-on только backend.
4. Бамп 2.11.y, changelog. Не ослаблять другие таблицы. Не менять `organizations_select_member` и SELECT license/subscription (это S3a §8.51).

DoD:
- Прямой PostgREST INSERT заявки невозможен.
- Submit Edge жив.
- Другие RLS не «почищены заодно».

Стоп. Не переходи к S3a.
```

---

### Этап 3

#### S3a — RBAC, waitlist, suspended gate (без monthly-витрины)

- [x] DoD закрыт

```
Задача: S3a. Права и гейты + RLS recovery SELECT §8.51. showManualPurchase оставить `purchase=1 && isDemo`. Не SKU/quote UI. Не формула isReadOnly по period_end. Не T−7.

Предшественник: S2d.

Прочитай: §2.2, §4.1, §6, §8.4, §8.30, §8.33–8.34, §8.46, §8.48, §8.51.
codegraph: WRITE_ACTIONS license.activate LicenseSettingsPage OrgWorkspaceRoute LicenseRequiredPage SubscriptionWaitlistCard ActivateKeyPage.

Делай строго по шагам:

1. permissions.ts: PermissionAction + `license.purchase` = owner|director. `license.activate` owner-only как сейчас. Убрать `license.activate` из WRITE_ACTIONS. Не класть `license.purchase` в WRITE_ACTIONS.
2. LicenseSettingsPage: ManualPurchasePanel / заявка — RequirePermission license.purchase; поле TDB-LIFE — license.activate. showManualPurchase НЕ менять (demo-only).
3. Удалить SubscriptionWaitlistCard с лицензии (таблица platform_waitlist не дропать). Убрать stripeSoonHint с ActivateKeyPage + i18n. Убрать обработку ?checkout=success|cancelled.
4. Явный RLS (это указание менять политики): при organizations.status = suspended (а) SELECT organizations всем active members; (б) SELECT organization_licenses и organization_subscriptions — owner и director. Tenant business tables не открывать. Не трогать S2d INSERT заявок.
5. OrgWorkspaceRoute: organizations.status === suspended → /license-required, исключения: /settings/license (включая ?purchase=1) и /license-required. Не редиректить past_due / demo_retention. Статус — из org-строки (после шага 4 она есть у всех members).
6. LicenseRequiredPage: варианты копирайта demo ended / истекший месяц / suspended. CTA «Оплатить месяц» (?purchase=1, можно ?plan=monthly как предвыбор) и «Купить lifetime» только owner/director. Ссылку activate-key / поле ключа — только owner. Ссылку «назад в read-only CRM» скрыть при suspended (§8.46). Прочим ролям — текст + контакты, без покупки.
7. i18n ru/en/vi для новых строк. Бамп 2.11.y, changelog.
8. Не выкатывать S3a на прод без S3b: waitlist уже снят, monthly-витрины ещё нет.

DoD:
- Director видит покупку на demo (license.purchase), ключ — только owner.
- Read-only demo не прячет purchase/activate.
- Waitlist и Stripe-хвост с лицензии/activate-key исчезли.
- Suspended уходит на /license-required без цикла «назад»; director/teacher тоже (не organization=null).
- Owner/director при suspended читают license+subscription; clients/payments по-прежнему закрыты.
- Monthly-орг всё ещё не видит ManualPurchasePanel (S3b).
- Прод-релиз S3a+S3b вместе (щель waitlist без месяца недопустима).

Стоп. Не переходи к S3b.
```

#### S3b — CRM витрина SKU → quote → submit

- [ ] DoD закрыт

```
Задача: S3b. Экран покупки по §4.1. Панель не только demo.

Предшественник: S3a. Quote Edge — S2b.

Прочитай: §4.1, §8.34, §8.40, §9.4.
codegraph: ManualPurchasePanel PurchaseRequestPanel useSubmitPurchaseRequest useDemoLicenseUi DemoPurchaseCta LicenseSettingsPage getPurchaseActivationSteps.

Делай строго по шагам:

1. Условие панели: демо (active/retention) до purge; monthly active/past_due (продление); suspended recovery; НЕ lifetime.
2. UX: SKU → способ → server quote → реквизиты и сумма из quote → форма «Я оплатил». Форма выше реквизитов — исправить. Submit: quote_id, client_request_id, контакты, комментарий. Не SKU/method/сумма/request_kind.
3. Хуки: убрать requestKind. client_request_id UUID на попытку.
4. Уже monthly: статус до {datetime}, кнопка «Оплатить следующий месяц», тот же panel в режиме monthly, поле lifetime-ключа оставить (апгрейд).
5. Lifetime: бейдж, без месяца, без ключа.
6. past_due/suspended: CTA продлить с предвыбором monthly (?plan= только предвыбор, quote всё равно серверный).
7. useDemoLicenseUi / DemoPurchaseCta или рядом useCrmLicensePurchaseUi: CTA owner/director при past_due, suspended (не lifetime). Точная дата purge на демо. T−7 баннер и CTA — S4, не здесь.
8. step5/step6: month — период на месяц, ключ не нужен; lifetime — как сейчас.
9. i18n license.plan.* без путаницы с абонементом ученика. Бамп 2.11.y, changelog.

DoD:
- Demo owner/director шлёт crm_subscription или crm_license через quote.
- Monthly renewal создаёт новую заявку.
- Lifetime не видит месяц.
- Director не вводит ключ.
- ?plan= не подменяет quote.
- T−7 баннер/CTA отсутствуют (S4).

Стоп. Не переходи к S4.
```

---

### Этап 4

#### S4 — cron expire + effective read-only + T−7

- [ ] DoD закрыт

```
Задача: S4. Истечение и UI read-only. Digest только SQL-source. Не outbox, не Telegram.

Предшественник: S3b.

Прочитай: §2.3, §4.5, §6, §8.4–8.5, §8.42, §8.50.
codegraph: OrganizationProvider isReadOnly ReadOnlyBanner renter_miniapp_addon_is_active organization_has_active_subscription.

Делай строго по шагам:

1. Cron/Edge (как purge-expired-demo-orgs) + idempotent batch RPC FOR UPDATE SKIP LOCKED:
   - active AND now >= period_end → past_due;
   - past_due AND now >= grace_end (period_end + 7 days, если S0 не изменил) → canceled + organizations.status=suspended.
2. organization_has_active_subscription / Mini App gate: status=active AND period_end > now(); Mini App гаснет в period_end, не ждать cron. Licensed/suspended не purge.
3. OrganizationProvider.isReadOnly: добавить license_type=subscription AND (status != active OR period_end IS NULL OR period_end <= now()). Не дублировать suspended в эту формулу (редирект уже S3a). demo_retention / expired demo_active сохранить.
4. ReadOnlyBanner: копирайт не только «демо закончилось»; ветка «подписка на CRM истекла» / grace N дней. CTA на ?purchase=1.
5. Баннер T−7 до period_end в CRM (клиентский effective state, как demo days-left) и CTA продления owner/director. Не email, не Telegram.
6. SQL-view/RPC digest source (истекающие/просроченные org) — без отправки. Enqueue — S5.
7. Тесты: expire→past_due→suspend; UI read-only при active+истёкшем end без cron; Mini App off; exact now() boundary. Бамп 2.11.y, changelog, config.toml cron.

DoD:
- Запись закрыта с period_end (SQL+UI) без ожидания cron.
- После grace — suspended + редирект S3a.
- Данные licensed/suspended живы.
- T−7 баннер и CTA видны owner/director до period_end.
- Ни одного sendMessage/email из этого промпта.

Стоп. Не переходи к S5a.
```

---

### Этап 5

#### S5a — notification outbox + worker + миграция email заявок

- [ ] DoD закрыт

```
Задача: S5a. Инфраструктура доставки. Detect UI нет. org_created нет. Тикетов нет.

Предшественник: S4.

Прочитай: §5.1–5.2, §5.4, §5.8, §8.11, §8.28, §8.31–8.32, §8.38, §8.43.
codegraph: submit-purchase-request renterTelegramOutboxDrain renter-booking-worker.

Делай строго по шагам:

1. platform_notification_settings singleton: telegram_chat_id bigint (группа <0 / личка >0), title, updated_by/at. Нет GRANT authenticated. Токен НЕ здесь.
2. platform_notification_outbox: channel, event_kind, source_type, source_id, dedupe_key, sanitized payload, status pending|processing|retry|blocked|sent|dead, attempts, available_at, lease, sent_at, last_error_code. UNIQUE (channel, dedupe_key).
3. Вынести sendTelegramMessagePlain(token, chatId, text) в _shared: без parse_mode, без tenant AES. Worker платформы зовёт его. renterTelegramOutboxDrain — только механическая замена HTTP, если безопасно; иначе не трогать drain студии.
4. Edge platform-notification-worker + CRON_SECRET (как renter-booking-worker). Claim/lease, backoff+jitter, retry_after на 429, 403/chat not found/kicked → blocked не dead. Не getUpdates, не setWebhook. Email через sendTransactionalEmail. Текст ≤4096, комментарий резать на сервере. Секреты/JWT/ключи в payload запрещены. Inbox URL из DEV_CONSOLE_PUBLIC_URL (завести секрет, не из page_url клиента).
5. Патч submit-purchase-request: заявка + строки outbox (email + telegram) в одной DB-транзакции; убрать inline send (или оставить fallback только если RPC outbox упал — нет, целевое: только enqueue). email_sent на заявке не размножать как источник истины; можно выставлять по sent email-строки или оставить legacy read-only.
6. Нет token или chat_id: источник создаётся, Telegram status=blocked last_error_code=config_missing, attempts не тратить. Email всё равно pending.
7. Тесты: dedupe, lease, blocked, requeue, dead, сбой канала не откатывает заявку. Бамп 2.11.y, changelog, config.toml. Не писать token в JSON оплаты.

DoD:
- Заявка жива при падении Telegram.
- Worker не вызывает getUpdates.
- renter-booking-worker не дренирует платформенный outbox.
- Detect UI нет.

Стоп. Не переходи к S5b.
```

#### S5b — Detect / Save / Send test + org_created + digest

- [ ] DoD закрыт

```
Задача: S5b. Подключение бота в Dev Console, алерт новой базы, digest enqueue.

Предшественник: S5a.

Прочитай: §5.6, §5.8, §8.12, §8.28, §8.43, §8.50.
codegraph: create-self-service-demo-org.

Делай строго по шагам:

1. Dev Console (developer-only Edge): Detect = getMe + getUpdates one-shot (только если webhook не установлен; иначе сказать снять webhook). Кандидаты: my_chat_member (privacy Enable ок) и private /start. Ручной paste chat_id — канонический путь. Save в platform_notification_settings. Send test. Requeue blocked. Username бота в CRM/лендинге не показывать.
2. org_created: патч внутренней RPC создания self-service demo — в той же транзакции, что INSERT org, enqueue outbox (dedupe org_created:<org_id>). Не support ticket. Не при purge. Не при invite-member. Edge «после INSERT» недостаточно.
3. Ежедневный digest из SQL-source S4 в outbox (dedupe дата+тип). Если объём велик — минимальный enqueue из того же expire-cron через RPC outbox, не inline email. Не оставлять digest «на потом».
4. Бамп 2.11.y, changelog.

DoD:
- Save chat_id работает без записи secrets из приложения.
- Send test доходит или blocked/config_missing честно.
- Новая demo-org = один алерт, retry не дублирует.
- Digest source S4 уходит в outbox (не inline email).
- Нет webhook.

Стоп. Не переходи к S6.
```

---

### Этап 6

#### S6 — support tickets и формы

- [ ] DoD закрыт

```
Задача: S6. Тикеты. Не purchase/org_created.

Предшественник: S5b (outbox жив).

Прочитай: §5.3, §5.5, §5.7, §8.13, §9.9.
codegraph: LoginPage ForgotPasswordPage AuthDeveloperContact LicenseSettingsPage PurchaseInboxPage.

Делай строго по шагам:

1. platform_support_tickets: поля §5.3. UNIQUE client_request_id. Нет GRANT authenticated INSERT/SELECT. IP не хранить; rate limit keyed HMAC.
2. Edge submit-support-ticket:
   - Гости login_help / forgot_password: verify_jwt=false, CORS allowlist, Turnstile fail-closed, rate limit IP-HMAC+email-HMAC, одинаковый успешный ответ без enumeration. kind/длины/page path allowlist.
   - Авторизованные other / license_help: JWT, active member текущей org, не renter; organization_id с сервера.
3. UX: шапка «Сообщение разработчику» — модалка, kind задаёт страница, не свободный enum. Login/forgot — свёрнутый блок + captcha. После отправки: «Сообщение отправлено… чек продублируйте в Telegram/email». Иконки Email/Telegram/WhatsApp оставить. Не тред в CRM, не Storage вложений.
4. Тикет forgot_password не меняет пароль (Dev Console `dev-console-reset-owner-password` + recovery code; не промпт S09 аудита безопасности).
5. Enqueue outbox на тикет в той же транзакции. source_type=support_ticket.
6. Dev Console: вкладка Support в /inbox ИЛИ отдельный /support, не оба. List/detail, фильтры kind/status, new→open→closed, note/reason при закрытии, audit. Ссылка из Telegram на ticket. Telegram не источник статуса.
7. Тесты: idempotency, kind guard, rate limit, neutral response, renter forbidden. Бамп 2.11.y, changelog, i18n support.ticket.*.

DoD:
- Гость без JWT может сказать «не могу войти» без раскрытия email.
- Purchase/org_created не плодят тикеты.
- Закрытие тикета требует reason.

Стоп. Не переходи к S7.
```

---

### Этап 7

#### S7 — лендинг, architecture, decision_log

- [ ] DoD закрыт

```
Задача: S7. Публичный копирайт и закрытие узла в docs. Не новая фича CRM.

Предшественник: S6. Очередь §16 после DoD закрыта.

Прочитай: §8.16–8.17, §10, §15. Файлы: tangodb-landing/src/i18n/en.ts, ru.ts (vi.ts не создавать), architecture.md Platform payment config, decision_log.md VER-1 / PAY-INBOX.

Делай строго по шагам:

1. Лендинг en+ru:
   - Два тарифа CRM (month + lifetime). Убрать смысл «No monthly subscription» / «Без ежемесячной оплаты» как «месяца нет».
   - pricing.afterTrial.* и faq.aCard: «без автосписания / без карты» — правда для ручного месяца, не вычищать.
   - Просроченный early bird (31 Aug 2026) убрать из витрины; не вечный текст акции. pricing.subtitle, pricing.step.decide, faq.a8, footer.nav.pricing.
   - faq.a6: после trial можно месяц или lifetime, не «только lifetime».
   - faq.a10: клиенту отвечает человек в Telegram/email; платформенный бот пишет разработчику, username бота не светить.
2. architecture.md: v2 цены, quote, kind crm_subscription, outbox, platform bot vs studio bot, activate RPC.
3. decision_log.md: решение узла 2.11 (ручной месяц, бот outbound-only, без Stripe). Не дублировать HALL-RENT.
4. Шапка этого файла: статус «S0–S7 закрыты» и `[x]` в шапке и в §16 «Последовательность промптов», если DoD этого прогона зелёный. changelog.md. Бамп 2.11.y только если в S7 есть код после последнего патча; иначе только docs.

DoD:
- Воронка лендинга не врёт относительно /settings/license.
- architecture описывает quote + outbox + отдельный бот.
- Нет S8 в этом файле.
- Студийный Mini App не упомянут как сломанный.

Стоп. Узел закрыт.
```
