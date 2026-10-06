# Продуктовые редакции CRM: Lite / Studio / Pro

Спека узла: **три редакции одного приложения**, бесконфликтный апгрейд и даунгрейд, отдельный биллинг. Текущая CRM (`tangodb/` 2.11.48) становится **Pro**.

Статус: **E0–E11 код и статический смоук готовы; флаг prod off.** Реализация — отдельная подверсия **2.12** (VER-1: новый узловой контур), код E1a в **2.12.0**, E1b в **2.12.1**, E1c в **2.12.2**, E2 в **2.12.3**, E3 в **2.12.4**, E4 в **2.12.5**, E5 в **2.12.6**, E6a в **2.12.7**, E6b в **2.12.8**, E6c в **2.12.9**, E7 в **2.12.10**, E8 в **2.12.11**, E9 в **2.12.12**, E10 в **2.12.13**, E11 в **2.12.14**. Промпты агента — **§16** (один новый чат = один номер E*). Ревизия спеки: **r14**.

**Навигация:** §0–§15 продукт, план, риски F1–F124 · §16 промпты E0–E11 · §17 Dev Console · §18 БД · §19 capability↔маршрут · §20 оплата v3 · §21 слои гейтов · §22 cutover.

<details>
<summary><strong>Оглавление (§0–§22)</strong></summary>

| § | Тема |
|---|---|
| 0 | Цель, сценарий-якорь |
| 1 | Снимок 2.11.48 |
| 2 | Имена Lite / Studio / Pro |
| 3 | Модель: ceiling, edition, капы, биллинг |
| 4 | Архитектура: capabilities, схема, SQL, клиент |
| 5 | Бесконфликтные переходы |
| 6 | План E0–E11, флаг `editions_lifecycle` |
| 7 | Рекомендации |
| 8 | Риски F1–F124 · карта по темам |
| 9 | Тест-план |
| 10 | Вне скоупа v1 |
| 11 | Открытые решения (E0) |
| 12 | Карта кода |
| 13–14 | Риски продукта, успех |
| 15 | Документы после кода |
| 16 | Промпты агента |
| 17 | Dev Console |
| 18 | БД, миграции, §18.9–§18.15 |
| 19 | Capability ↔ маршрут |
| 20 | Оплата schemaVersion 3 |
| 21 | Слои гейтов |
| 22 | Cutover runbook |

</details>

**Очередь §16** (линейно: следующий номер только после DoD предыдущего; E1a–E1c и E6a–E6c — нарезка этапов E1/E6 из §6, **не** параллельный запуск). Галочку после DoD ставь **здесь и в §16 «Последовательность промптов»**:

- [x] **E0** — закрыть §11 письменно (только документ)
- [x] **E1a** — SQL: таблицы entitlements/state/events + flags + backfill + **2.12.0**
- [x] **E1b** — SQL: time-aware хелперы, wrap writes/капы/триггеры (флаг off = 2.11)
- [x] **E1c** — SQL: Activate/preview `IN`, purge, adjust wrap, notification CASE, тесты
- [x] **E2** — каталог TS + nav/route + `isReadOnly` + fallback accountant/reception
- [x] **E3** — гейт write-RPC + leftover insert + pair-cron + `create_renter`
- [x] **E4** — журнал Lite: roster-таблицы + RPC + UI отметок
- [x] **E5** — occupancy: серые чипы + запрет create + TZ CTA
- [x] **E6a** — payment config v3 + quote SKU Studio
- [x] **E6b** — Inbox: `rowKind` / `isMonthly` / Activate Studio
- [x] **E6c** — Billing / flag / Tenants / Metrics / Keys / bot / renter bootstrap
- [x] **E7** — UI лицензии: три карточки, режим vs cancel
- [x] **E8** — джобы: expire, Mini App, GCal, webhook skip
- [x] **E9** — демо → Lite (без purge по таймеру)
- [x] **E10** — лендинг + i18n + architecture / decision_log
- [x] **E11** — смоук якоря + роли (owner, teacher, accountant Lite **и** Studio → upsell Pro)

Ревизии:

- **2026-09-21 r1:** сняты противоречия даунгрейда; dual-write; roster; капы; Dev Console §17; БД §18.
- **2026-09-21 r2:** сверка с кодом **2.11.48** — закрыты дыры grace vs касса, `isReadOnly` / dual-write `organization_licenses`, капы (инвайты, archive), payroll skip, кошелёк на Lite, флаг cutover **не** в payment config, Billing JOIN, Activate во время демо; слои гейтов §21; runbook §22. Риски **F43–F58**.
- **2026-09-21 r3:** аудит r2 — `change_reason`/`trial_start`; purge **licensed Lite**; F59–F70; Dev Console (badge «Licensed», `expiring_soon` только demo, пути контракта); БД (`accept_organization_invite` + кап, `purge_single_organization`); уточнён Billing (org-root, не INNER JOIN).
- **2026-09-21 r4:** аудит r3 — капы vs `multi_*` capabilities; зеркало `period_*` ↔ `current_period_*`; тест-план grace/licenses; `owner_mode` Studio при `pro_monthly` (renew Pro); Dev Console `OrgsPage.canPurge` + типы консоли; Mini App `tangodb-renter`; F71–F74; §17.10 / §18.8.
- **2026-09-21 r5:** сверка r4 с кодом **2.11.48** — time-aware хелперы (не ждать cron после `period_end`); гейт edition на **PostgREST INSERT/UPDATE**, не только RPC; капы restore/reactivate + advisory lock; Inbox `rowKind` / фильтры Studio; purge `suspended` ≠ Lite; review-hold SKU Studio; матрица RPC×capability §18.9; F75–F90. Dev Console §17.12; БД §18.10–§18.11.
- **2026-09-21 r6:** аудит r5 vs код **2.11.48** — cutover **whiplash** (флаг off ≠ time-aware write); advisory lock **один bigint** (как 2.11, не два `hashtextextended`); триггеры INSERT ≠ UPDATE (consume `mark_attendance` / rename зала); XOR raising-instrument; касса Studio vs `can_read_financial`; venue-ack и GCal-enqueue на не-Pro; Inbox `isMonthly` + Edge `InboxKindFilter`; Billing canned note; неполный §18.9 (`subscription_groups`, `replace_subscription_partner`, payroll/venue/rental RPC). F91–F108. Dev Console §17.13; БД §18.12–§18.14.
- **2026-09-21 r7:** аудит r6 vs код **2.11.48** — имена SQL/Edge **как в базе** (не второе вымышленное имя); `preview_activate` / Activate month-ветка = **равенство** `crm_subscription` (Studio → lifetime/ключ); platform-notification CASE ELSE = «Lifetime»; Billing `extend_one_month` + Stripe-option; Keys **generate и issue**; accountant fallback на **Studio**; leftover pair-cron; TZ vs Mini App слоты; `create_renter` + карточка арендатора; `useFinanceRentalScreensEnabled`; `parsePurchaseQuoteSku`. F109–F121. Dev Console §17.14; БД §18.15.
- **2026-09-21 r8:** промпты агента **§16** (E0–E11, нарезка E1a–E1c и E6a–E6c) + чеклист очереди в шапке. Продукт §0–§15 / §17–§22 не менялся.
- **2026-09-21 r9:** редакторская сверка r8 — порядок ревизий r7→r8; `trial_end` = clamp по `rank(mode) ≤ rank(effective_ceiling)`, не «≤ lite»; §6 vs F108 (`isReadOnly` в E2 до флага, Lite writes — только при on); дубль строки §1 `organization_allows_writes`; оглавление; §18.3 `trial_end` согласован с §3.1/E9; опечатка F108.
- **2026-09-21 r10:** аудит r9 — **§22 п.4** согласован с §6/F108 (E2 снимает month-lock в `isReadOnly` до флага; Studio Activate — нет); F91 уточнён (whiplash ≠ откат E2); §17.8 журнал Lite = E4 + флаг on; E9/§18.3 `trial_end`: `mode` = колонка `active_edition`, не `change_reason` `owner_mode`; §6 DoD E2 + `isReadOnly`; оглавление раскрывающееся; AI_CONTEXT rev **r10**.
- **2026-09-21 r11:** аудит r10 vs код **2.11.48** — DELETE licenses **не** во время grace (§3.1 vs §18.3); флаг on = **E1–E9** (r10 список без E2/E5/E7); Activate Studio при off → `editions_lifecycle_off` (F52, не «опционально»); accountant fallback vs `canReadScopedCrm=false` (F123); `ReadOnlyBanner` завязан на `isReadOnly` (F122); §22 явно E9; канон п.13–14. Риски **F122–F123**.
- **2026-09-21 r12:** сверка r11 vs код **2.11.48** — E2/F123: пересечь с edition **`findFirstEnabledAccessiblePanelPath`** и `PanelAccessRoute` (боевой redirect), не только `findFirstAccessiblePanelPath` (NAV-1); `isReadOnly` **без** `suspended` (recovery как 2.11 — `OrgAccessRoute` → `/license-required`, §4.4); §11 п.14 / §4.3 / E0 — DELETE licenses **не** во время grace; reception fallback — `/attendance`, не «subscriptions»; §14 п.8 — JWT-gate Lite при флаге on; §22 п.1 — E1 = E1a→E1c.
- **2026-09-21 r13:** редакторский аудит r12 — §4.5 / канон п.9 vs F123 (2.12 = upsell Pro, не «следующий хит» `/renters`/`/prices`); канон шапки `r8–r12`; §14 п.8 явная отсылка к §18.9; §7 п.28 якоря реализации; §12 nav fallback согласован с E2.
- **2026-09-21 r14 (эта):** аудит r13 vs код **2.11.48** — early-return `findFirstEnabledAccessiblePanelPath` (`isTeacherPayrollOnly` → `/finance/payroll`, `isRentalInboxOnly` → `/finance/rental-inbox`) и `findFirstAccessibleSettingsSection` (accountant → `hall-rent`) не были в E2 (**F124**); `canAccessFinanceNav`; §19 без finance-подмаршрутов; F116 слал к §18.15 вместо матрицы §18.9; шапка §18.9 «INSERT OR UPDATE» vs §18.12; §5.2 «живой ceiling» vs grace `past_due`; E0 DoD пропускал §11.9; канон шапки vs §16; payroll/venue skip независимо; карта источников истины.

Связанное: `architecture.md` (Org modules, Platform payment, RBAC/RLS), `crm_monthly_subscription_and_support_bot.md` (ручной месяц Pro, quote/Inbox), `decision_log.md` (`CRM-EDITIONS-0` … `CRM-EDITIONS-7`, `CRM-SUB-2.11`, `HALL-RENT-SELF-2`), страница лицензии `/settings/license`, Dev Console `/inbox` `/billing` `/payment-methods` `/orgs` `/keys` `/` (Metrics).

**Не путать:**

| Слово | Что это |
|---|---|
| Абонемент ученика (`subscriptions`) | Товар студии |
| Подписка организации (`organization_subscriptions`) | 1:1 зеркало месяца CRM (совместимость 2.11). **Не** источник редакции |
| Модуль org (`organization_settings.modules`) | Чекбоксы владельца «что показать в меню» |
| Редакция (`edition`) | **Этот документ:** оплаченный пакет + выбранный режим |
| `crm_product_versions` | Major линии продукта (`v2`), не тариф |
| `instrument` | Как право получено: trial / free / month / lifetime |
| `effective_ceiling` | Вычисленный потолок (max rank живых entitlements). **Не колонка.** Раньше в черновике также `purchased_ceiling` — синоним, в схеме не создавать |
| `schema_version_locked` | **Колонка** `organizations`, не значение `status`. При locked writes закрыты независимо от редакции |

Автосписания карты **нет**. Stripe **не включать**. Рельс оплаты — тот же ручной QR/Inbox, что у Pro.

**Канон продукта (закрыто r7; r8–r13 не ломают; r14 добавляет F124 в E2, не меняя п.1–14, иначе E1/E3/E6/cutover разъедутся):**

1. SQL-хелперы редакции **time-aware**: `period_end <= now()` = grace/expire **без ожидания cron** (как 2.11 `organization_has_active_subscription` уже режет writes по дате). Cron только **персистит** `status` / `edition_state` / события. **Write-path time-aware и Lite-writes — только при `editions_lifecycle=on`.** При off: поведение 2.11 (не открывать licensed Lite, не clamp кассу, expire всё ещё `suspended`). Иначе E2 покажет журнал Lite, а через 7 дней cron 2.11 запрёт орг (F91).
2. Гейт write-path = `edition_allows` в **RPC и триггерах**, но **не** слепой `BEFORE INSERT OR UPDATE` на всю строку. Consume (`mark_attendance` обновляет `subscriptions.lessons_left`; отметка персоналки) и UPDATE имени зала **не** `edition_forbidden`. Канон — **§18.12**. Имена RPC — **фактические** (`create_group_subscription`, не вымышленный `sell_subscription`). Матрица — **§18.9**.
3. Кап Lite ловит не только INSERT: restore архивного клиента, реактивация члена, accept invite; гонка — **один** `pg_advisory_xact_lock(bigint)` через `hashtextextended(org::text || ':edition-cap:' || resource, 0)` (как 2.11 venue/payroll). **Не** два аргумента `hashtextextended` — двухключевая форма lock принимает `int4, int4`, такой вызов в PG **не скомпилируется** (F92). Pending invite **не** считает просроченные.
4. Inbox: `rowKind` **не** мапит неизвестный kind в `crm_license`; фильтр `monthly` = только Pro month; Studio — отдельный kind. UI-ветка месяца (`isMonthly`, `preview_activate`, override period) = **оба** `crm_subscription` **и** `crm_studio_subscription` (сегодня `=== "crm_subscription"` — Studio снова станет lifetime-кнопкой, F93). Review-hold демо включает `crm_studio_subscription`.
5. Purge: licensed + live `free_lifetime` **нельзя**. `suspended` (антифрод) — отдельный `force_anti_abuse` + note + audit, **не** `force_licensed` и не кнопка Purge у Lite.
6. Raising-instrument XOR: live `trial_pro` | `studio_monthly` | `pro_monthly` | `pro_lifetime` — **не больше одного** на org (+ всегда `free_lifetime`). Индексы r5 (`live_instrument` + `one_paid_month`) **не** запрещают `studio_monthly` + `pro_lifetime` (F94).
7. Касса Studio ≠ финансовый контур Pro: `can_read_financial` / SELECT `payments` **не** снимать с owner/accountant на Studio (S36: роль = API). Режем write `expenses` / payroll / venue / аренда и UI-виджеты. Venue-ack в `record_*_payment` на не-Pro **не блокирует** оплату (F95). GCal `enqueue_calendar_sync` на INSERT персоналки Studio **не** плодит outbox (F96).
8. **Имена = факт 2.11.48, не invent.** Adjust Billing = SQL `dev_console_adjust_organization_subscription` (Edge `dev-console-adjust-subscription`) + параметр `p_extend_one_month` — **не** плодить вторую функцию `dev_console_adjust_organization_edition`. Month-ветка Activate/preview = `request_kind IN ('crm_subscription','crm_studio_subscription')`. Сегодня оба SQL проверяют **равенство** `crm_subscription` (`preview_month_only`; Activate уходит в lifetime-ключ) — F109 / F118.
9. Fallback accountant/reception — **и Studio, не только Lite.** Сырой RBAC-порядок `PANEL_FALLBACK_PATHS` (2.11.48): `/finance` → `/clients` (miss у accountant) → `/renters` → … → `/prices` (NAV-1 `canReadRentalTariffs`) — **баг до E2** (F123). **2.12:** пересечь путь с `editionAllows` в **обоих** fallback-хелперах + `PanelAccessRoute`; accountant на Lite/Studio → **upsell Pro**, не `/finance`, `/clients`, `/renters`, `/prices`. На Studio `/finance` закрыт редакцией как на Lite (F110/F123).
10. `apply_scheduled_subscription_member_changes` на leftover-абонементе Lite = **consume** (как `mark_attendance`), не продажа. Гейт `group_subscriptions` здесь **запрещён** (F112).
11. Смена TZ организации на Lite/Studio падает, пока живы Mini App слоты `awaiting_payment`/`active`/`prepaid_charged` (триггер 2.11). Сначала occupancy «снять будущие слоты» (F111).
12. Payroll / venue-cost skip = **любой non-Pro** (Studio тоже), не формулировка «только Lite».
13. SPA `isReadOnly` (E2/F108) ≠ SQL Lite-writes. Снять month-lock **можно** до флага. **Activate `crm_studio_subscription` при флаге off запрещён** (`editions_lifecycle_off`) — иначе Mini App-хелпер 2.11 откроется от Studio month (F52). Activate Pro month/lifetime при off **пишет entitlements** (анти-drift), write-path остаётся 2.11. Quote/Inbox `new` Studio на staging допустим; Activate — нет.
14. Accountant: `canReadScopedCrm` = **false** (нет `clients.read` / `subscriptions.read` / журнала). После отсечения `/finance` следующий RBAC-хит — `/renters`, затем `/prices` (NAV-1 `canReadRentalTariffs`). Fallback 2.12 = **upsell Pro**, не клиенты и не «операционная касса» без нового panel (F40, F123). Reception → `/attendance`. **Уточнение RBAC п.9, не второй fallback.**

**Где правда** (не плодить ещё один чеклист — F85 / §7 п.28):

| Вопрос | Читать | Это напоминание, не второй канон |
|---|---|---|
| Инварианты продукта | канон п.1–14 | §7 |
| Имена RPC / Edge / триггеры | §18.9 + §18.12 + §18.15 | F* «почему» |
| Дубли рисков | F85 (канон = младший номер) | старшие F — ярлыки |
| Шаги агента | длинный `#### E*` | короткий блок шапки §16 — только вход в чат |
| Cutover | §22 | §6 — план этапов, не runbook |
| Экраны Dev Console | §17.14 | §17.12 — сверка Edge |
| Nav / roles 2.12 | §4.5, E2 шаг 5, F123, **F124** | не invent «следующий хит» PANEL_FALLBACK |

---

## 0. Цель одной фразой

Одна кодовая база CRM; организация выбирает **Lite (бесплатно, бессрочно)**, **Studio (платная подписка)** или **Pro (месяц или пожизненно)**; переход в любую сторону **не удаляет данные** и не ломает уже купленные учениками занятия.

Сценарий-якорь (обязательный приёмки): *Lite → Studio → Pro → через год банкротство → снова Lite → позже снова Pro.* Данные, история, остатки абонементов и сетка расписания живы на каждом шаге.

---

## 1. Как сейчас (снимок 2.11.48)

Одна платная CRM. Нет понятия «тариф продукта».

| Слой | Факт |
|---|---|
| Доступ | `demo_active` 30 дней → purge; либо `licensed` + lifetime **или** monthly Pro |
| SKU | `crm_license` (пожизненно), `crm_subscription` (месяц). Оба открывают **весь** продукт |
| Quote | `platform_purchase_quotes.sku` CHECK только `crm_license` \| `crm_subscription` |
| Inbox kind | CHECK `crm_license` \| `crm_subscription` \| `renter_miniapp_addon` (addon с клиента запрещён). `rowKind()`: addon / `crm_subscription` / **иначе `crm_license`**. Studio без правки = lifetime UI + Activate без period preview (F76). Фильтр `monthly` → `kindToRequestKind` = только `crm_subscription` |
| Конфиг оплаты | `platform_payment_methods.config` **schemaVersion 2**: `crmLifetime` / `crmMonthly` |
| Модули | JSONB `organization_settings.modules` — владелец сам выключает разделы. Это **не** оплата (S36: модуль = UI, роль = API) |
| Истечение месяца | `past_due` → grace 7д → `suspended` (чтение почти закрыто, кроме owner) |
| Mini App | гейт = купленный CRM (HALL-RENT-SELF-2); демо = выкл |
| Журнал | `attendance.subscription_id` **NOT NULL**, уникальность `(org, date, subscription_id, schedule_group_id)`, **нет `client_id`** — список на урок из абонементов группы |
| Nav | `/prices` **без** moduleKey (всегда в меню); `/renters` завязан на модуль `locations`, не на аренду |
| Даунгрейд | не существует. Lifetime нельзя понизить месяцем. Purge демо **удаляет** org |
| Лицензия / месяц | `organization_licenses` и `organization_subscriptions` обе **1:1 с org**. `license_type` CHECK только `lifetime` \| `subscription` (**нет `none`**). `plan` на практике `'standard'`. Lite без строки licenses — норма, как только появится |
| `organization_allows_writes` | `licensed` **и** (lifetime **или** active month с `period_end > now()`). `past_due` уже **не** даёт writes. Licensed без license/month = **false** — сломает Lite |
| UI `isReadOnly` | `OrganizationProvider`: `demo_retention` / просроченное демо **или** `isCrmSubscriptionWriteClosed` (license_type=`subscription` и статус не active / period_end прошёл). **Вся CRM** read-only, не только касса |
| `can_manage_settings` | только **owner/director**, не admin, не reception |
| Integrations в settings | `canAccessSettingsSection('integrations')` = любой `role != null` (учитель тоже видит пункт) |
| Сетка «+ Аренда» | `can('rentals.write') && modules.locations` — не hall-rent capability |
| `/prices` hall-rent вкладка | жива, если роль видит rental tariffs (accountant/finance), **без** edition |
| Inbox kindLabel | `"CRM monthly"` для любого `crm_subscription` (`PurchaseInboxPage.tsx`) — после Studio перепутывает Pro и Studio |
| Billing search | корень `organizations` + embed licenses/subscriptions (PostgREST = LEFT). Lite **в списке есть**, но `license_type=null` и фильтр `none` ≠ «редакция Lite»; **нет** `active_edition` / entitlements → поддержка не видит Studio vs Lite |
| Purge licensed | `purge_single_organization`: блок только при `organization_has_lifetime_license` или month `active`/`past_due`. **Licensed Lite без строки licenses — purge разрешён** (бомба для вечного Lite, F70) |
| Tenants badge | `licensed` без lifetime/subscription → бейдж **«Licensed»** (не Lite/Studio/Pro) |
| `expiring_soon` (Tenants DC) | только `demo_expires_at` в ±7д; **не** T−7 month Studio/Pro |
| Digest expire | `enqueue_platform_crm_subscription_digest` + copy про **suspend** |
| Капсы / archive | у `clients` есть `archived_at`; у `locations` / `disciplines` **нет** archive — считаем все строки |
| Инвайты | `organization_invites` + `create_organization_invite` — отдельный INSERT, не член. Pending = `accepted_at IS NULL AND revoked_at IS NULL`. **Просроченные (`expires_at <= now()`) в 2.11 всё ещё «висят» pending** — в кап 2.12 **не входят** (F81) |
| Writes не только RPC | `personal_lessons` — **PostgREST INSERT** (`useAddPersonalLessons`); `expenses` INSERT/UPDATE/DELETE; `prices` INSERT/UPDATE/DELETE; `clients` archive/restore UPDATE `archived_at`; члены — RPC `update_team_member(..., p_is_active)`. Групповая продажа канон = `create_group_subscription` (в `useSubscriptions` ещё есть `.insert` — дыра S36-класса, F75) |
| Касса месяца SQL | `organization_has_active_subscription`: `status=active` **и** `current_period_end > now()` (manual). Writes 2.11 закрываются **по дате**, cron только ставит `past_due`/`suspended`. 2.12 хелперы редакции обязаны быть такими же time-aware (F75) |
| Activate errors | `month_on_lifetime_forbidden` / `already_lifetime` — не `already_pro_lifetime`. Inbox Edge мапит их в `activation_forbidden`. Новый код + алиас 2.11 (F83) |
| Review-hold демо | `_organization_has_eligible_purchase_review_new`: kind только `crm_license` \| `crm_subscription`. Studio-заявка **не** держит purge демо, пока не добавить SKU (F80) |
| Billing filter | `none` = нет subscription-embed **и** не lifetime; `lifetime` / `active` / `past_due` / `canceled` по зеркалу месяца. **Нет** фильтра редакции. `createManualSubscription` всегда Pro month через `dev-console-adjust-subscription` |
| Tenants | `canPurge = status !== 'purged'`; `license_badge` Lifetime / Subscription / Demo / Licensed; Metrics (`DashboardPage`) — licensed vs demo, **без** edition |
| Хвост миграций 2.11 | последняя: `20261217000001_ux16_show_beginner_hints.sql`. Цепочка 2.12 — **после** этого префикса (§18.8) |
| Контракт оплаты | канон `platformPaymentContract.ts` (CRM + Edge `_shared`). `tangodb/src/lib/paymentQuote.ts` **нет**; Edge quote — `_shared/paymentQuote.ts` (re-export). Dev Console `package.json` version `0.1.0`; Mini App `tangodb-renter` `0.1.26` — не путать с CRM `2.11.48` |

Следствие: «выключить финансы в настройках» ≠ «купить дешёвый тариф». Скрытый пункт меню не закрывает RPC **и не закрывает PostgREST INSERT**. Для платных редакций нужен **слой entitlement в SQL (RPC + триггеры таблиц)**. Старые 1:1 таблицы **не удаляем** — dual-write (§4.3, §18). **Нельзя** оставить `license_type=subscription` после cancel месяца: 2.11 `isReadOnly` тогда запирает журнал Lite (F43).

---

## 2. Названия (закрыто)

Витринное имя **одно во всех локалях**, латиницей, без перевода и без склонения:

| Код (БД / SKU / логи) | На экране ru | На экране en | vi (когда дойдём) |
|---|---|---|---|
| `lite` | **Lite** | **Lite** | **Lite** |
| `studio` | **Studio** | **Studio** | **Studio** |
| `pro` | **Pro** | **Pro** | **Pro** |

Не использовать в UI: перевод «Студия», «Базовый», Basic, Старт, Стандарт, Ядро; не склонять Lite/Studio/Pro.

Фразу вокруг имени переводим, само имя — нет.

| Место | ru | en |
|---|---|---|
| Карточка тарифа | Редакция **Lite** | **Lite** plan |
| Карточка тарифа | Редакция **Studio** | **Studio** plan |
| Карточка тарифа | Редакция **Pro** | **Pro** plan |
| Кратко в шапке / бейдж | Lite · Studio · Pro | Lite · Studio · Pro |
| CTA | Перейти на Studio | Upgrade to Studio |
| CTA | Перейти на Pro | Upgrade to Pro |
| CTA | Остаться на Lite | Stay on Lite |
| Upsell | Доступно в Studio | Available on Studio |
| Upsell | Доступно в Pro | Available on Pro |
| Лицензия | Сейчас у вас Lite | You are on Lite |
| Лицензия | Сейчас у вас Studio | You are on Studio |
| Лицензия | Сейчас у вас Pro | You are on Pro |

В коде, URL и SKU слово `basic` **не использовать** (путать с `finance_basic`). Не `free` в коде: Lite может быть и режимом при живом потолке Pro.

Deep link `?plan=monthly` **оставляем = Pro month** (`crm_subscription`), чтобы не сломать T−7 баннеры 2.11. Studio: `?plan=studio`. Не переназначать `monthly`.

---

## 3. Модель продукта

### 3.1. Два независимых факта на организацию

| Факт | Смысл | Меняется когда |
|---|---|---|
| **`effective_ceiling`** | Максимум живых entitlements (всегда ≥ `lite` после демо). Колонки `purchased_ceiling` **нет** | Покупка / истечение месяца / выдача lifetime / конец демо. **Не** при смене режима |
| **`active_edition`** | Какой набор экранов и write-path включён **сегодня** | Явный выбор владельца **вниз** (режим) или апгрейд, если ceiling позволяет **и** поднимающий instrument `active` (не `past_due`) |

Инвариант: `rank(active_edition) ≤ rank(effective_ceiling)`.

`effective_ceiling` = max rank строк `organization_entitlements`, у которых **time-aware `phase` IN (`active`,`past_due`)** (не сырая колонка `status`: после `period_end` monthly `status` ещё `active`, пока cron не тикнул — потолок/SKU lock всё равно `past_due`, после grace window — уже не держит lock):

| instrument | edition | rank | Когда |
|---|---|---|---|
| `free_lifetime` | `lite` | 1 | С создания org, **никогда не отменяем** (кроме purge всей org) |
| `studio_monthly` | `studio` | 2 | Пока месяц Studio жив / grace |
| `trial_pro` | `pro` | 3 | Демо 30д |
| `pro_monthly` | `pro` | 3 | Пока месяц Pro жив / grace |
| `pro_lifetime` | `pro` | 3 | Навсегда, пока ключ/активация не отозваны админом (антифрод) |

**Trial — не четвёртая редакция.** `edition` всегда `lite` \| `studio` \| `pro`. Демо = `instrument = trial_pro`.

**Pro lifetime никогда не сгорает** из-за режима Lite. Владелец может работать в Lite, затем вернуть Pro **без второй оплаты**.

**`owner_mode` во время демо** (`trial_pro` live, `demo_active`): **разрешён** вниз (Lite/Studio UI), Mini App остаётся выкл. Потолок всё ещё Pro (trial). После `trial_end` потолок = lite (`free_lifetime`); колонка `active_edition` (режим, выбранный во время демо) сохраняется только если `rank(active_edition) ≤ rank(effective_ceiling)`; иначе clamp `lite` (без покупки на практике всегда `lite`). Не запрещать режим «чтобы увидеть Pro» — продажа демо и так 30 дней на Pro по умолчанию (`active_edition=pro` при создании).

Два разных действия владельца (не смешивать — в черновике 2026-09-20 здесь был конфликт §3.1 / §4.6 / §11 п.6–7):

| Действие | Что делает | Деньги |
|---|---|---|
| **Режим** (`owner_mode`) | Только `active_edition` вниз, ceiling жив **и** поднимающий instrument `active` (не один `past_due`) | Ничего не отменяется. «Вернуть Pro» мгновенно при живом lifetime / active month |
| **Отменить месяц** (`owner_cancel`) | Явная кнопка «перейти на Lite и отменить подписку» | Месяц Studio/Pro **сразу** `canceled`, ceiling падает (если нет lifetime). Lifetime **не** трогаем |
| **Expire / grace** | Cron после `period_end` | **не** как cancel сразу. См. фазы ниже |

Баннер T−7 **только предупреждает**, ceiling не режет. Неоплаченный остаток периода в v1 **не возвращаем** (ручной рельс, без автопрорации).

Апгрейд Studio→Pro mid-cycle: v1 **не** считать кредит. Полный месяц Pro; строка Studio `canceled`. Зафиксировать в UI.

#### Фазы месяца (v1, закрыто — иначе §4.4 конфликтовал сам с собой)

В 2.11 `past_due` ещё «держит» подписку в Billing, но writes уже закрыты с `period_end`, а после grace org = `suspended`. В 2.12 **не** оставлять кассу Studio/Pro на время grace и **не** давать кнопку «Вернуть Studio» без оплаты, пока единственный высокий entitlement = `past_due`.

| Фаза | monthly `status` | `effective_ceiling` | `active_edition` | Платные write | Lite write | CTA |
|---|---|---|---|---|---|---|
| До `period_end` | `active` | studio/pro | как выбрал | да | да | T−7: renew-баннер |
| Grace: `period_end` … +7д | `past_due` | studio/pro **для renew / SKU lock** | **auto-clamp `lite`**, reason `expire_grace` | нет | да | **renew** того же SKU |
| После grace | `canceled` | lite (если нет lifetime) | `lite`, reason `expire` | нет | да | **buy** |

Колонка `monthly status` — **персист cron**. Time-aware `organization_entitlement_phase` даёт те же фазы **до** тика (status ещё `active` после `period_end` → уже `past_due` для writes).

Правила grace:

1. `set_organization_active_edition` **не поднимает** active по потолку, который держит только `past_due` **или time-aware past_due**. Поднять можно: Activate оплаты **или** живой `pro_lifetime` / другой `active` instrument.
2. `edition_allows` смотрит `organization_active_edition()` (функция, не сырая колонка). Во время grace функция = `lite`. Отдельный «третий гейт period_open» в каждом RPC **не нужен** — фаза внутри хелпера.
3. `past_due` **не** бывает у `free_lifetime` / `pro_lifetime` / `trial_pro` (CHECK). Time-aware может *трактовать* monthly `active` как past_due, пока cron не персистил статус.
4. UI **не** `isReadOnly` на всю CRM. Не `LicenseRequiredPage`. Баннер: «Studio/Pro закончились, N дней на продление; сейчас режим Lite».
5. `organization_subscriptions` зеркало: `past_due` → после grace `canceled`. Строку 1:1 **не удаляем**.
6. Зеркало `organization_licenses` **во время grace не трогать** (`past_due` month = live → `license_type=subscription`). Иначе инвариант §18.3 врёт, Billing теряет month-строку.
7. **DELETE** строки licenses — только после grace / `owner_cancel`, если нет live `pro_lifetime` (типа `none` в CHECK нет). Иначе 2.11 `isReadOnly` запирает журнал (F43). Lifetime-строку не трогать.

#### Time-aware хелперы (закрыто r5 — иначе окно кассы после `period_end`)

В 2.11 `organization_has_active_subscription` уже требует `current_period_end > now()`. Cron `expire_crm_organization_subscriptions` **только синхронизирует** `past_due` / `suspended`. Если 2.12 будет clamp `active_edition` **только в cron**, между `period_end` и тиком касса Studio/Pro останется открытой (регресс относительно 2.11).

Канон: функции ниже **не доверяют одной колонке `status`**.

```text
organization_entitlement_phase(row, now)  -- не колонка
  lifetime / free_lifetime / trial_pro: как status
    trial_pro: если period_end <= now → canceled (для writes), даже если cron не успел
  studio_monthly / pro_monthly:
    period_end IS NULL            → canceled
    now < period_end              → active
    now < period_end + 7 days     → past_due   -- даже если status ещё 'active'
    иначе                         → canceled   -- для writes и ceiling; SKU lock тоже снят
                                   -- (можно buy, не stuck на renew), пока cron не персистил
```

| Вопрос | Откуда ответ |
|---|---|
| Можно ли **писать** кассу Studio/Pro | `organization_active_edition()` = функция: `min(edition_state.active_edition, max raising instrument с phase=active)`. Raising с phase=past_due/canceled **не** держит active. После `period_end` сразу lite, без cron |
| Ceiling / renew / `purchaseSkuLock` | live = phase IN (`active`,`past_due`). После grace window (даже до cron `canceled`) lock снят, SKU снова choice |
| Колонка `organization_edition_state.active_edition` | персист для Billing/событий. Может **отставать** на минуты. SPA и RPC читают **функцию**, не колонку |
| Cron | идемпотентно: проставить monthly `past_due`/`canceled`, clamp колонки state, events, dual-write зеркал. Не единственный гейт |

`get_organization_edition` возвращает уже вычисленный `active_edition` + `effective_ceiling` + `phase` live month (для баннера T−7 / grace). Не отдавать «сырой» state, если он выше time-aware clamp.

### 3.2. Что входит в редакции (продукт)

Общее для всех: вход, команда, настройки школы (название, TZ, локаль), расписание, журнал, база клиентов, страница лицензии, гостевые support-тикеты платформы.

| Возможность | Lite | Studio | Pro | Capability |
|---|---|---|---|---|
| Расписание (группы, сетка, замены педагога) | да | да | да | `schedule` |
| Журнал посещений | да (roster) | да | да | `attendance` |
| База клиентов | да (кап) | да | да | `clients` |
| Абонементы + **продажа / оплата / заморозка** | нет * | да | да | `group_subscriptions` |
| Списание **уже купленного** абонемента в журнале | да, если строка есть | да | да | `attendance` (не `group_subscriptions`) |
| Персональные уроки + **продажа / оплата** | нет * | да | да | `personal_lessons` |
| Отметка посещения **уже созданной** персоналки | да, если строка есть | да | да | `attendance` |
| Тарифы и прайс-лист | нет | да | да | `prices` |
| Разовое посещение (`single_visits`) | нет | да | да | `single_visits` |
| Несколько залов / направлений | нет (кап 1+1) | да | да | `multi_location` / `multi_discipline` |
| Финансы (журнал платежей, выручка, дебиторы, расходы) | нет | нет | да | `finance` |
| Зарплаты команды | нет | нет | да | `payroll` |
| Касса аренды зала + арендаторы (staff) | нет | нет | да | `hall_rent` |
| Mini App арендатора | нет | нет | да | `renter_miniapp` |
| Google Calendar | нет | нет | да | `google_calendar` |
| Мероприятия / мастер-классы в сетке | нет * | нет * | да | `calendar_events` |
| Экспорт операционный CSV | нет | да | да | `export_operational` |
| Экспорт финансовый | нет | нет | да | `export_financial` |
| Офлайн-журнал | нет | нет | да | `offline_attendance` |
| Дашборд | операционный, без денег | операционный + остатки абонементов | полный, вкл. финансовый | — |

`*` на сетке **видны** уже существующие персоналки / аренда / события как занятость зала (read-only). Создавать новые — только если редакция позволяет.

**Операционная касса** (оплата абонемента, персоналки, разового) = Studio, **не** Pro. Pro добавляет финансовый контур, зарплаты, аренду, Mini App, GCal. На Lite новые деньги **не принимать** — иначе Lite = касса. Остаток уже оплаченных уроков **дохаживается**. Неоплаченный долг на Lite **заморожен** (не собираем). Void / correct операционных платежей — **Studio+**, на Lite нет даже у leftover (иначе обход «не принимать деньги»).

**Payroll / venue-cost** с отметок **не начислять на любой non-Pro** (Lite **и** Studio): `payroll` / `hall_rent` только Pro. В том числе leftover `mark_attendance` после даунгрейда. Внутри `mark_attendance` / `mark_personal_lesson_attendance` / `close_group_lesson_occurrence` / `close_personal_lesson_occurrence`: skip **независимо** — `!edition_allows(payroll)` → нет payroll accrual; `!edition_allows(hall_rent)` → нет venue-cost accrual. Не одним `AND` на оба (иначе гипотетический контур «есть payroll, нет зала» начнёт писать venue). После возврата на Pro дыры дат **не бэкфиллить** в v1 (§10). Не писать «skip только на Lite» — Studio тоже без зарплат и venue-cost.

**Кошелёк арендатора на Lite/Studio:** новые брони и topup **нет**. Исключение (иначе деньги в ловушке): `preview_renter_wallet_payout` / `staff_renter_wallet_payout` **разрешены** при живом балансе, как «снять будущую аренду» (F3). Карточка арендатора — read + payout.

**Офлайн-журнал** в v1 только Pro: текущий `sync_offline_mark_attendance` завязан на `subscription_id`, roster-offline = отдельный узел. Studio/Lite — только онлайн. На даунгрейде с Pro очередь IndexedDB не применять (F18).

Support-бот платформы и `/settings/license` — все редакции.

**Reception** (`restricted_admin`): на Lite панель абонементов скрыта редакцией; журнал roster доступен. Fallback → `/attendance` (не `/subscriptions` / sell). RBAC у reception шире, но home после отсечения закрытых panel = журнал. Роль не удалять.

**Accountant:** `canReadScopedCrm` = false — нет `clients.read`, `subscriptions.read`, журнала, сетки. Сегодня после `/finance` fallback попадает в `/renters` (Pro), затем `/prices` через NAV-1 `canReadRentalTariffs`. 2.12: **не** расширять `can()` (F40). Landing = upsell Pro + роль жива; не обещать клиенты/операционную кассу без нового panel (F23/F123).

**Замены педагога** — `schedule`, все редакции.

**Waitlist / ёмкость группы** — контур абонемента, Studio+. RPC `add_group_waitlist_entry` / `update_group_waitlist_status` + `edition_allows(group_subscriptions)`. Lite roster в v1 **не** пишет waitlist и не блокирует SQL-ёмкостью (мягкое предупреждение в UI допустимо). Не путать с `platform_waitlist` / `SubscriptionWaitlistCard` (Stripe «скоро») на `/settings/license` — это платформенный интерес, не ёмкость группы; карточку не привязывать к редакции.

**Операционная касса Studio vs финансовый контур Pro (закрыто r5, уточнено r6):** Studio принимает деньги за абонемент / персоналку / разовое и может **void / correct** этих же операционных платежей (ошибка кассира). Pro добавляет журнал расходов (`expenses` PostgREST), write-off дебиторки, зарплаты, venue-cost, кассу аренды. `correct_payment` / `update_payment_in_place`, если платёж привязан к subscription / personal_lesson / single_visit — **Studio+**; если расход / аренда / payroll — **Pro**. `finance_period_closed_until` на Studio **жив** (как 2.11) для операционных дат.

**SELECT `payments` / `can_read_financial` на Studio не снимать** (F97). S36: роль = API. Owner/director/accountant на Studio по-прежнему читают операционные платежи (карточка абонемента, журнал оплат). Режется **UI** `/finance` (виджеты дебиторов, расходы, payroll, HallRentalDashboardBlock) и **write** Pro-RPC. Accountant на Studio: роль жива, fallback **как на Lite** (F23 / F110) — не `/finance` и не `/prices?section=hall-rent`; `record_subscription_payment` не отбирать.

**Venue-ack на не-Pro (F95):** `record_subscription_payment` / `record_personal_lesson_payment` / `record_single_visit` в 2.11 требуют `p_venue_rule_acknowledged`, если на дату нет покрывающего правила. После даунгрейда Pro→Studio правила зала **остаются в таблицах**. Если оставить гейт — касса Studio встанет. Канон: при `!edition_allows(hall_rent)` ack **не обязателен**, accruals **не писать** (как skip payroll). Не удалять версии правил.

**GCal outbox на Studio (F96):** триггеры `enqueue_calendar_sync` на `personal_lessons` / слотах / аренде / событиях в 2.11 пишут outbox при любом INSERT. Studio создаёт персоналки → очередь заполнится, worker потом skip. Канон: enqueue **no-op**, если `!edition_allows(google_calendar)` (или флаг off — поведение 2.11). Существующие outbox не drain-delete в Google (§4.9).

**Occupancy на даунгрейде:** кроме будущей аренды (F3) — отмена **будущих** персоналок (`delete_personal_lesson` / `delete_personal_lesson_series_from_date`) и **будущих** мероприятий, чтобы не держать зал. Прошедшие строки и деньги не трогать; refund нет.

**Карточка арендатора (канон r7):** read + payout на Lite/Studio. `upsert_renter` **UPDATE** уже существующей строки (имя/телефон) — **да**. INSERT нового арендатора — только Pro: `upsert_renter` create **и** legacy `create_renter` (GRANT 2.11 ещё жив — F115). Contacts / contracts / documents / communications / QR / `commit_organization_renter_bot` / invoices / advance / topup / adjust — `hall_rent` (Pro).

**Смена TZ организации** (`organization_settings.timezone`): триггер 2.11 бросает `timezone cannot change while Mini App slots are awaiting_payment/active/prepaid_charged`. На Lite/Studio сначала «снять будущие слоты», потом TZ. Не ослаблять триггер «потому что Mini App выкл» — слоты в таблицах остаются (F111).

### 3.3. Биллинг

| Редакция | Как платят | SKU (новые и старые) |
|---|---|---|
| Lite | бесплатно, бессрочно | нет заявки; `free_lifetime` |
| Studio | **отдельная** месячная подписка (дешевле Pro) | **новый** `crm_studio_subscription` |
| Pro | как сейчас: месяц **или** пожизненно | `crm_subscription`, `crm_license` (имена SKU **не ломать**) |

v1 **не** запускать: пожизненную Studio, годовой план (`billing_period = yearly` в таблице есть — **не использовать**), add-on «только финансы». Stripe по-прежнему заморожен. `organization_addons` / `renterMiniappAddon` **не** источник Mini App (HALL-RENT-SELF-2).

Цены — `platform_payment_methods.config` **schemaVersion 3**: канон `crmStudioMonthly` рядом с `crmLifetime` / `crmMonthly`. Реквизиты QR/банка **общие**. Quote/submit — тот же рельс, `request_kind` **только из SKU quote**, не с клиента.

Парсер **обязан** читать schemaVersion 2: отсутствие `crmStudioMonthly` → fail-closed **только** для SKU Studio; Pro lifetime/month продолжают продаваться. Сохранение в Dev Console поднимает конфиг до v3.

Демо 30 дней = **пробный Pro** (`active_edition = pro`, `trial_pro`). Mini App на демо **выкл**, как сейчас. После демо: cancel `trial_pro`, org `status = licensed`, `data_purge_at = null`, `active_edition = lite`. Данные **не** purge'ить.

**Покупка во время демо (закрыто):** Activate любого платного SKU в той же TX: `trial_pro` → `canceled`; `status=licensed`; `data_purge_at=null`; пишется paid entitlement; `active_edition` = купленная редакция. Mini App: после Activate **Pro** (month/lifetime) = **вкл** (это уже не демо). Activate **Studio** во время демо → Mini App остаётся выкл. Не оставлять live `trial_pro` рядом с month (F47) — unique live instrument по `trial_pro` иначе блокирует повторное демо-право, а Mini App-хелпер 2.11 может открыться от licensed+month.

Существующие клиенты (lifetime и month) → ceiling `pro`, `active_edition = pro`. Grandfathering без дополнительной заявки. `organization_subscriptions.plan = 'standard'` читать как **Pro month**.

### 3.4. Что владелец всё ещё может выключить сам

`organization_settings.modules` остаются **подмножеством** редакции. Studio не может включить `finance_basic`, даже если JSONB = true. Lite не может включить `group_subscriptions`.

Нормализация: `effectiveModules = catalog(active_edition) ∩ normalizeOrgModules(settings)`. Источник истины write-path — SQL `edition_allows()`, не JSONB.

Сохранение настроек **не персистит** ключи вне каталога активной редакции (F8). JSONB при даунгрейде **не затираем** — апгрейд возвращает прежний выбор (F13).

Ключи, которых **нет** в `OrgModules` сегодня (hall-rent, GCal, events, Mini App, export, offline) — **только** edition, без нового JSONB в v1.

### 3.5. Капы Lite (v1 канон)

Иначе бесплатный вечный Lite = полный Pro без финансов по цене хостинга.

| Ресурс | Lite | Studio / Pro |
|---|---|---|
| Залы (`locations`) | 1 **новый**; лишние с демо **не удаляем** | без капа продукта |
| Направления | 1 **новое**; лишние с демо остаются | без капа |
| Клиенты | 200; если с демо уже больше — нельзя добавить | без капа |
| Члены команды (active) | 8; лишних не добавлять | без капа |

Кап = **INSERT / invite**. Существующие сверхлимитные строки **работают** (сетка демо не ломается). Баннер: «на Lite нельзя добавить ещё зал / ученика — Studio». Не заставляем выбрать «основной зал» в v1.

Как считать (SQL, не только UI):

| Ресурс | Формула |
|---|---|
| Залы | `count(*)` из `locations` (archive-колонки нет). INSERT если count ≥ 1 на Lite → cap |
| Направления | `count(*)` из `disciplines`. То же |
| Клиенты | `count(*)` из `clients WHERE archived_at IS NULL`. Архив не занимает слот; 201-й активный — cap |
| Члены | `count(*)` `organization_members WHERE is_active` **+** pending invites: `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`. Owner входит в 8. Деактивированный член слот освобождает. **Просроченный инвайт слот не занимает** (иначе 20 истекших писем навсегда жрут кап — F81) |

**Капы vs capabilities `multi_location` / `multi_discipline`:** в каталоге §4.2 у Lite — «первый ресурс + cap на следующий», не полный запрет залов. Первый зал и первое направление на Lite — через `organization_within_edition_cap` (INSERT пока count меньше лимита). `edition_allows(multi_location)` в E3 = «можно создать ещё один зал»: на Lite true только пока залов меньше 1; на Studio/Pro — без продуктового капа. То же для `multi_discipline`. Иначе кап-триггер и capability расходятся (F71).

Abuse (тысячи орг, накрутка) → `suspended`, не silent purge. Purge заброшенных Lite — **не в v1** (§11.9).

Гейт капа — **триггер BEFORE INSERT** на `clients`, `locations`, `disciplines`, `organization_members` **и** RPC `create_organization_invite` + `accept_organization_invite` (F60, F61). Прямой INSERT в `organization_members` разрешён RLS owner/director — без триггера кап обходится на accept.

**Кап на UPDATE (закрыто r5, F77):** INSERT-триггер не ловит:

| Обход | Путь 2.11 | 2.12 |
|---|---|---|
| Архив → снова активен | `useRestoreClient`: UPDATE `clients.archived_at = null` | BEFORE UPDATE: переход `archived_at IS NOT NULL → NULL` считает слот как INSERT. Если активных уже ≥ 200 — `edition_cap_exceeded` |
| Выключенный член → включён | RPC `update_team_member(..., p_is_active => true)` | та же `organization_within_edition_cap(..., 'members')` **до** UPDATE; триггер на `is_active false→true` как страховка |
| Параллельные INSERT | два JWT одновременно, оба видят count=199 | в кап-хелпере **один** ключ, как 2.11 venue/payroll: `PERFORM pg_advisory_xact_lock(hashtextextended(org_id::text \|\| ':edition-cap:' \|\| resource, 0));` затем count (F78, F92). **Не** `(hashtextextended(org), hashtextextended(resource))` — в PG двухключевой `pg_advisory_xact_lock` это `int, int`, не `bigint, bigint` |

`upsert_renter` **не** кап клиентов (это hall_rent). Кап залов/направлений — только INSERT (archive-колонки нет). **DELETE** зала/направления на Lite **разрешён** (`useDeleteLocation` / `useDeleteDiscipline`; FK `locationInUse` уже блокирует занятый). Кап = текущий `count(*)`, не «когда-либо созданные». Delete+insert одного зала — замена, не рост. Не вешать edition-запрет на DELETE.

Числа капов — в SQL (константы функции), не только в UI. Owner-вопрос §11.4 может сменить числа до E1; дефолт для кода = эта таблица. В v1 **не** выносить числа в payment config (срежет CAS `pricingRevision`). Dev Console adjust капов — не в v1.

---

## 4. Архитектура

### 4.1. Слои доступа (не смешивать)

```
organizations.status          — жива ли орг (demo_active / licensed / suspended / purged)
        ↓
organization_entitlements     — что оплачено / trial / free lite   → effective_ceiling
        ↓
organization_edition_state    — что включено сегодня (≤ ceiling)
        ↓
organization_settings.modules — владелец прячет неиспользуемое внутри редакции
        ↓
RBAC (role + scope)           — кто в команде
        ↓
RLS / RPC                     — правда API
```

Урок S36 остаётся: **спрятать пункт меню недостаточно**. Каждый write-RPC, который продаёт абонемент, персоналку, платёж, аренду, GCal, экспорт — проверяет `edition_allows(org, capability)`. SELECT исторических строк **не** вырезать: иначе даунгрейд «ломает» карточку клиента и сетку.

`demo_retention` в v1 **не используем** на новом пути: демо → сразу `licensed` + Lite. Уже сидящие в `demo_retention` на миграции → Lite licensed, не purge.

Слои **не заменяют** друг друга — см. шпаргалку §21. Особенно: `isReadOnly` 2.11 ≠ edition. На Lite `isReadOnly` должен быть false.

### 4.2. Каталог capabilities (коды, не экраны)

Стабильные ключи для SQL и UI. `write` = create/update денежных и структурных операций. Read истории — всегда, если строки есть.

| Capability | Lite | Studio | Pro |
|---|---|---|---|
| `schedule` | write | write | write |
| `attendance` | write | write | write |
| `clients` | write (кап) | write | write |
| `group_subscriptions` | — | write | write |
| `personal_lessons` | — | write | write |
| `prices` | — | write | write |
| `single_visits` | — | write | write |
| `multi_location` | write (1-й зал; 2-й — cap) | write | write |
| `multi_discipline` | write (1-е направление; 2-е — cap) | write | write |
| `finance` | — | — | write |
| `payroll` | — | — | write |
| `hall_rent` | — | — | write |
| `renter_miniapp` | — | — | write |
| `google_calendar` | — | — | write |
| `calendar_events` | — | — | write |
| `export_operational` | — | write | write |
| `export_financial` | — | — | write |
| `offline_attendance` | — | — | write |

Read исторических данных: если в таблице есть строки, UI показывает **архивный** блок («осталось с Pro/Studio»), без кнопок «Продать / Оплатить / Создать».

`pair_subscriptions` / `trio_lessons` — **не** capabilities и не SKU. Фильтр прайса внутри Studio/Pro (F30).

Маппинг JSONB → capability и маршруты — **§19**.

### 4.3. Данные (схема v1)

Не плодить вторую лицензию как истину. Не класть ceiling только в `organizations.edition` (отвергнуто: потолок и режим живут разной жизнью).

**Источник истины редакции:** `organization_entitlements` + `organization_edition_state`.

**Зеркала 2.11 (1:1, не удалять):**

| Таблица | Роль после 2.12 |
|---|---|
| `organization_licenses` | Доказательство **оплаченного** Pro/Studio month или Pro lifetime: `lifetime` пока жив `pro_lifetime`; `subscription` пока жив Pro/Studio month (`active`\|`past_due`). **Не создавать** фейковую лицензию для Lite. **Никогда не перезаписывать** `lifetime` → `subscription` (F6). После cancel/expire без lifetime — **DELETE** строки (F43) |
| `organization_subscriptions` | Зеркало **текущего** месяца: `plan = 'studio' \| 'pro'` (`'standard'` = Pro, grandfather). 1:1 — **нельзя** хранить два месяца сразу. Пишется той же транзакцией, что entitlement |

```text
organization_entitlements
  id uuid PK
  organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE
  edition text NOT NULL CHECK (edition IN ('lite','studio','pro'))
  instrument text NOT NULL CHECK (instrument IN (
      'free_lifetime','trial_pro','studio_monthly','pro_monthly','pro_lifetime'))
  status text NOT NULL CHECK (status IN ('active','past_due','canceled'))
  CHECK (past_due только studio_monthly | pro_monthly)
  period_start timestamptz        -- monthly/trial; NULL у lifetime/free
  period_end timestamptz          -- зеркало в organization_subscriptions: current_period_start / current_period_end (имена 2.11, не переименовывать)
  billing_anchor_day int          -- как у текущего месяца CRM (1–31)
  source_request_id uuid NULL REFERENCES platform_purchase_requests
  created_at, updated_at
  CHECK (instrument ↔ edition):
    free_lifetime → lite
    studio_monthly → studio
    trial_pro | pro_monthly | pro_lifetime → pro
  CHECK (monthly/trial: period_end NOT NULL)
  CHECK (free_lifetime | pro_lifetime: period_end IS NULL AND status <> 'past_due')
  CHECK (trial_pro: status <> 'past_due')

-- НЕ UNIQUE (org, edition, instrument) на все строки: canceled + повторная покупка.
CREATE UNIQUE INDEX organization_entitlements_live_instrument
  ON organization_entitlements (organization_id, instrument)
  WHERE status IN ('active', 'past_due');

-- Не больше одного платного месяца сразу (Studio XOR Pro month).
CREATE UNIQUE INDEX organization_entitlements_one_paid_month
  ON organization_entitlements (organization_id)
  WHERE status IN ('active', 'past_due')
    AND instrument IN ('studio_monthly', 'pro_monthly');

-- Raising XOR (r6 / F94): trial, любой paid month и lifetime не сосуществуют.
-- live_instrument + one_paid_month ЭТОГО НЕ ЗАКРЫВАЮТ (studio_monthly + pro_lifetime проходили бы).
-- free_lifetime всегда рядом — в индекс не входит.
CREATE UNIQUE INDEX organization_entitlements_one_raising
  ON organization_entitlements (organization_id)
  WHERE status IN ('active', 'past_due')
    AND instrument IN ('trial_pro', 'studio_monthly', 'pro_monthly', 'pro_lifetime');

CREATE INDEX organization_entitlements_expire
  ON organization_entitlements (status, period_end)
  WHERE status IN ('active', 'past_due')
    AND instrument IN ('studio_monthly', 'pro_monthly')
    AND period_end IS NOT NULL;

organization_edition_state
  organization_id uuid PK REFERENCES organizations ON DELETE CASCADE
  active_edition text NOT NULL CHECK (active_edition IN ('lite','studio','pro'))
  changed_at timestamptz NOT NULL
  changed_by uuid NULL            -- auth.users; NULL = cron; Dev Console actor = developer user
  change_reason text NOT NULL CHECK (change_reason IN (
      'purchase','renew','expire','expire_grace','owner_mode','owner_cancel',
      'trial_start','trial_end','admin_adjust'))
  -- renew = Activate того же SKU с past_due (не второй live-row). Не reuse пустой строки.

-- Обязательный append-only след (не опционально). Owner_mode иначе не попадёт в platform_audit_log.
organization_edition_events
  id uuid PK
  organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE
  from_edition text, to_edition text
  from_ceiling text, to_ceiling text
  reason text NOT NULL  -- те же коды, что change_reason
  actor_user_id uuid NULL
  created_at timestamptz NOT NULL
  metadata jsonb NOT NULL DEFAULT '{}'
CREATE INDEX organization_edition_events_org_created
  ON organization_edition_events (organization_id, created_at DESC);
```

Миграция backfill (одна транзакция на org, SQL-тест обязателен):

| Было | entitlements | state |
|---|---|---|
| lifetime | `pro_lifetime` + `free_lifetime` | `pro` |
| month `active`/`past_due` | `pro_monthly` (период как в `organization_subscriptions`) + `free_lifetime`; `plan` оставить/`standard`→`pro` | `pro` |
| `demo_active` | `trial_pro` (end = `demo_expires_at`) + `free_lifetime` | `pro` |
| `demo_retention` | cancel trial; `free_lifetime`; `status=licensed`; purge-поля NULL | `lite` |
| `licensed` без license и без month (аномалия **2.11**; после 2.12 — норма **Lite**) | только `free_lifetime` | `lite` |
| `suspended` из-за expire месяца | **не** авто-unsuspend всех. Эвристика backfill: `suspended` + month `canceled` + нет lifetime + в `platform_audit_log` **нет** `org.suspended` / anti-abuse за окно expire → `licensed` + Lite. Иначе оставить `suspended` и пометить в Dev Console «needs review» (F64) |

`organization_subscriptions.plan`: истина плана **в entitlements**. Зеркало: Studio month → `plan='studio'`; Pro month → `plan='pro'`. Не читать plan в CRM write-path. Provider зеркала месяца = `'manual'` (как 2.11).

DDL, RLS, список RPC — **§18**. Dual-write licenses — **§18.3** (DELETE строки после cancel / конца grace без lifetime; **во время grace** licenses не трогать).

### 4.4. SQL-хелперы

```text
organization_edition_rank(e)            -- lite=1 studio=2 pro=3
organization_entitlement_phase(row)     -- §3.1 time-aware; не колонка
organization_effective_ceiling(org)     -- max phase IN (active, past_due); минимум lite после free_lifetime
organization_active_edition(org)        -- функция: clamp(state.column, raising phase=active).
                                        -- SPA/RPC НЕ читают сырую колонку, если она выше фазы
edition_allows(org, capability)         -- каталог organization_active_edition()
organization_allows_writes()            -- 2.12 при editions_lifecycle=on:
                                        --   NOT schema_version_locked  (F106, первым)
                                        --   AND status IN ('demo_active','licensed')
                                        --   AND (demo_active AND demo_expires_at > now()
                                        --        OR licensed AND live free_lifetime)
                                        --   suspended / purged / demo_retention → false
                                        --   past_due месяца БОЛЬШЕ не закрывает org-writes
                                        --   licensed без lifetime/month больше не false
                                        --   JWT-ветка auth_organization_id() 2.11 ОСТАЁТСЯ
                                        --   (service_role / cron: p_org видима без JWT-org)
                                        -- 2.12 при флаге off: ТЕЛО 2.11 без изменений
                                        --   (licensed ∧ (lifetime ∨ active month))
renter_miniapp_addon_is_active()        -- licensed
                                        -- AND organization_active_edition() = pro
                                        -- AND edition_allows(..., renter_miniapp)
                                        -- AND нет live trial_pro (phase active)
                                        -- демо / trial: false (HALL-RENT-SELF-2 не ослаблять)
organization_within_edition_cap(org, resource)  -- locations | disciplines | clients | members
                                        -- members = active members + pending non-expired invites
                                        -- внутри: advisory xact lock по (org, resource)
```

Истечение Pro/Studio month — **фазы §3.1 + time-aware**, не этот список в отрыве:

1. `period_end` (даже до cron) → phase `past_due`; `organization_active_edition()` = lite; **не** `suspended`; Lite writes открыты. Cron позже ставит monthly `past_due` + колонку state `expire_grace`.
2. Grace 7 дней: баннер «продлите»; ceiling для **renew/SKU lock** ещё studio/pro; `owner_mode` вверх запрещён.
3. После grace (даже до cron): phase `canceled`; функция active=lite, ceiling без month; SKU lock снят. Cron: monthly `canceled`; DELETE `organization_licenses` если нет lifetime; колонка state `expire`; org `licensed`.
4. `suspended` — антифрод / ручной бан Dev Console / abuse капов. Штатный expire **не** suspend'ит.

Это ломает текущий `expire-crm-subscriptions` (после grace пишет `organizations.status=suspended`) и UI `isReadOnly` / `LicenseRequiredPage`. **Истечение Pro ≠ read-only всей CRM.** `LicenseRequiredPage` только `suspended` (и legacy `demo_retention`). Digest cron: тексты «перешли на Lite», не «студия заблокирована».

`organization_has_active_subscription` 2.11 (`status=active AND period_end > now()`) **оставить** как зеркальный хелпер месяца; write-path CRM **не** опирается на него после E1 — только entitlements + `organization_allows_writes` + `edition_allows`.

### 4.5. Клиент

Новые файлы (не дублировать permissions):

- `tangodb/src/lib/orgEdition.ts` — типы, rank, `editionAllows()`, merge с modules, капы;
- хук `useOrgEdition()` рядом с `useOrgModules()` — данные с RPC `get_organization_edition`, не выводить редакцию из `organization_licenses`;
- `OrganizationProvider.isReadOnly` **перестать** считать через `isCrmSubscriptionWriteClosed`. Новое: `demo_retention` \| (просроченное `demo_active`) \| `purged` (если UI показывается). **`suspended` не добавлять** — как 2.11.48, recovery через `OrgAccessRoute` → `/license-required` (§4.4). Licensed Lite / grace / owner_mode Lite → **не** read-only;
- **`ReadOnlyBanner`** сегодня весь внутри `if (!isReadOnly) return null` — после E2 **пропадёт** grace CTA (F122). T−7 живёт отдельно в `CrmSubscriptionRenewalBanner` (не isReadOnly). E2 обязан вынести grace/expire-Lite баннер из-под isReadOnly; `ReadOnlyBanner` — demo retention / expired demo, **не** suspended и **не** month;
- nav: пункт виден если `editionAllows ∩ module ∩ canAccessPanel`;
- `PanelAccessRoute` — редирект + экран «доступно в Studio/Pro» с CTA покупки, не голый `/`. Accountant/reception fallback — **Lite и Studio** (F23 / F56 / F110 / **F123** / **F124**): порядок кандидатов остаётся `PANEL_FALLBACK_PATHS` (`/finance` → `/clients` → `/renters` → … → `/prices` → `/settings`), но **каждый panel/path пропускается**, если `!editionAllows` для маршрута (или dedicated upsell). **Мало пересечь цикл:** в 2.11.48 `findFirstEnabledAccessiblePanelPath` **до** цикла возвращает `/finance/payroll` (`isTeacherPayrollOnly` ∧ `finance_basic` JSONB) и `/finance/rental-inbox` (`isRentalInboxOnly`). JSONB при даунгрейде **не затираем** (F13) — без edition-гейта на early-return учитель на Lite попадает в Pro payroll. `canAccessFinanceNav` (пункт «Финансы» в меню) — те же два исключения ∩ edition. **2.11.48 без E2:** accountant (`canReadScopedCrm=false`) после закрытого `/finance` попадает в `/renters` или `/prices`; учитель — в `/finance/payroll`. **Цель 2.12:** пустой intersection после пересечения → экран **upsell Pro**, роль жива; не `/finance`, `/clients`, `/renters`, `/prices`, не payroll/rental-inbox. Reception → `/attendance` (не `/subscriptions` / sell). Accountant `license.view` **не** расширять (F40); `/settings/license` ему не home.
- **`findFirstEnabledAccessiblePanelPath`** (`PanelAccessRoute`, redirect с `/`) **и** **`findFirstAccessiblePanelPath`** (NAV-1 в `rbac-regression-check.mjs`) — **один** edition-aware хелпер или общая функция фильтрации пути; оба вызывают её; **early-return payroll / rental-inbox тоже**. **`findFirstAccessibleSettingsSection`:** accountant без `settings.manage` первым хитом берёт `hall-rent` (`canReadRentalTariffs`); после гейта hall-rent/data/integrations пересечение пустое → upsell Pro, не Integrations. Детали DoD — **§16 #### E2** шаг 5. NAV-1 не оправдывает landing accountant на `/prices` при закрытой редакции.

Обязательно закрыть дыры текущего nav:

- `/prices` сегодня **всегда в меню** — гейт `prices`;
- вкладка `/prices?section=hall-rent` — ещё и `hall_rent` (на Studio прайс услуг есть, касса аренды нет);
- `/renters` сегодня `moduleKey: locations` — гейт `hall_rent` (не локации);
- тулбар сетки «Аренда»: сейчас `can(rentals.write) && modules.locations` — `hall_rent`;
- `/settings/hall-rent`, `/settings/integrations`, `/settings/subscriptions` — §19;
- `/settings/integrations` сегодня виден **любому** role — скрыть create/connect на не-Pro, не оставлять живой OAuth.

`WRITE_ACTIONS` не подменяют edition. `license.purchase` / `license.activate` по-прежнему вне write-lock (урок 2.11).

`PurchaseSkuLock` 2.11 = `"choice" | "monthly"`; `PurchasePlanPrefill` = `"monthly" | "lifetime" | null`; `parsePurchasePlanParam` не знает `studio`. **Расширить:** lock `"choice" | "studio_month" | "pro_month"` (`"monthly"` = синоним `pro_month` только в тестах 2.11, в UI не оставлять); prefill `+'studio'`; `?plan=studio`. `?plan=monthly` **не** переназначать. `useFinanceRentalScreensEnabled` сегодня смотрит `ratesQuery.data?.addonActive` (час. ставки / Mini App bundle), **не** edition — на Studio после F52-хелпера экраны кассы аренды должны гаснуть (F117).

`resolveSelectedSku` при lock `"monthly"` всегда отдаёт `crm_subscription` — сломает Studio T−7. `purchaseCtaPath` / `useCrmSubscriptionUi.purchasePath` сегодня **всегда** `MONTHLY_PURCHASE_PATH` (Pro). 2.12: путь по живому instrument (F72). Deep link `?plan=studio` при live `pro_monthly` / `pro_lifetime` — игнорировать (lock Pro, не открывать SKU Studio).

`isManualPurchaseEligible` / `purchaseCtaKind` сейчас **не знают Lite licensed** (нет demo, нет month, нет lifetime → CTA null, панель покупки скрыта). На Lite: SKU Studio+Pro, CTA «buy». На Pro lifetime: SKU скрыты, кнопка режима «Вернуть Pro» если `active_edition < pro`.

`purchaseSkuLock` 2.11 (`monthly` → только `crm_subscription`) **ломает** апгрейд lifetime во время Pro month и Studio. Цель:

| Состояние | Lock / доступные SKU |
|---|---|
| Lite / demo | choice: Studio, Pro month, lifetime |
| Studio month `active` (phase) | renew Studio + апгрейд Pro month/lifetime; не второй Studio |
| Studio `past_due` (grace, вкл. time-aware) | renew Studio (тот же SKU); апгрейд Pro допустим как Activate Pro (cancel Studio) |
| Pro month `active` | renew `crm_subscription` **и** lifetime; **не** Studio |
| Pro `past_due` | renew Pro / lifetime |
| Pro lifetime | нет платных SKU |

Deep link: `parsePurchasePlanParam` + `?plan=studio`. Константа `STUDIO_PURCHASE_PATH`. `?plan=monthly` **не** переназначать.

T−7 баннер — и для Studio month (`plan=studio` в зеркале). При `active_edition=studio` и живом **`pro_monthly`** баннер и lock остаются **Pro** (F72).

### 4.6. Покупка и Inbox

Расширить, не копировать `ManualPurchasePanel`.

| Сейчас | Цель |
|---|---|
| SKU: license \| subscription | + `crm_studio_subscription` |
| lock monthly, если уже Pro month | lock = нельзя **купить ниже ceiling**; апгрейд Studio→Pro разрешён; Pro month → только renew Pro / lifetime, не Studio |
| lifetime прячет месяц | lifetime Pro прячет **все** платные SKU. Режим Lite — не покупка |
| Activate month → sync subscription | Activate читает SKU quote → пишет entitlement + зеркала 2.11 + поднимает `active_edition` в **одной** TX |
| `create-purchase-quote` allowlist | + Studio; lifetime-орг + любой month (вкл. Studio) → отказ `already_pro_lifetime` |
| CHECK quotes / requests | миграция: добавить `crm_studio_subscription` |

Правила Activate (сериализация `FOR UPDATE` по org, как 2.11 §8.22):

- уже `pro_lifetime` → `already_pro_lifetime` (F7);
- Activate Studio при live Pro (`pro_lifetime` или `pro_monthly` phase IN `active`,`past_due`) → отказ (сначала cancel/expire Pro; `past_due` всё ещё в SKU lock; не два месяца);
- Activate Pro при живом Studio month → Studio `canceled`, Pro `active`, полный месяц без кредита;
- во время демо: cancel `trial_pro` в той же TX (§3.3);
- во время grace (`past_due` того же SKU, вкл. time-aware): это **renew**, не второй live-row — перевести `past_due` → `active`, продлить period, поднять `active_edition`, `change_reason='renew'`;
- **флаг off:** Activate / preview `crm_studio_subscription` → `editions_lifecycle_off` (F52). Activate Pro month/lifetime при off пишет entitlements + зеркала 2.11, write-path не переключает на Lite.

Параллельные заявки Inbox: не блокировать разные SKU в статусе `new`; активация сериализуется. Inbox показывает обе.

**Dev Console Inbox — обязательно (F76, иначе Studio = lifetime):**

- `rowKind()` 2.11: неизвестный kind → `crm_license`. В 2.12: явные `crm_license` \| `crm_subscription` \| `crm_studio_subscription` \| `renter_miniapp_addon`; иначе **не активировать**, показать `unknown_request_kind`.
- `kindLabel`: «Studio / месяц», «Pro / месяц», «Pro / пожизненно», addon как сейчас — не общее «CRM monthly».
- Фильтр: `lifetime` / `pro_month` (`crm_subscription`) / `studio` / `addon` / `all`. Текущий `monthly` **не** должен глотать Studio (сегодня `kindToRequestKind("monthly")` = только `crm_subscription`).
- `preview_activate` + override period: та же ветка, что у Pro month, для **Studio**.
- **SQL 2.11.48 (не только UI):** `preview_activate_platform_purchase_request` — `IF v_req.request_kind <> 'crm_subscription' THEN RAISE preview_month_only`. `activate_platform_purchase_request` month-ветка — `IF v_req.request_kind = 'crm_subscription'`. Studio без правки = preview 400 **или** lifetime-ключ (F109, F118). Канон: оба `IN ('crm_subscription','crm_studio_subscription')`. `_preview_crm_month_activation_period` читает entitlements (live month), не только зеркало `organization_subscriptions`.
- `mapRpcActivateError`: `already_pro_lifetime` **и** алиас 2.11 `month_on_lifetime_forbidden` / `already_lifetime` → один UI-код; плюс `studio_not_configured`, `ceiling_blocks_sku`, `preview_month_only`, `unknown_request_kind`.

### 4.7. Журнал Lite (обязательный продуктовый узел)

Сейчас журнал пустой без абонементов группы. Lite **без** абонементов иначе бесполезен.

**Факт схемы 2.11.48 (не игнорировать):**

- `attendance.subscription_id` NOT NULL, `client_display` text, **нет `client_id`**;
- unique `(organization_id, date, subscription_id, schedule_group_id)` — не слот;
- `mark_attendance` + freeze + payroll завязаны на абонемент.

Nullable `subscription_id` на той же таблице в v1 **отвергнуть**: взрывает unique, teacher-scope, corrections, offline sync, payroll.

**Канон v1 — отдельные таблицы**, старый `mark_attendance` не ломаем:

```text
schedule_group_roster
  organization_id, schedule_group_id, client_id
  UNIQUE (organization_id, schedule_group_id, client_id)
  -- постоянный состав группы без абонемента
  -- add/remove не удаляет историю отметок

roster_attendance
  organization_id, schedule_group_id, client_id, date
  attendance_status   -- тот же набор, что у attendance
  created_by, created_at
  UNIQUE (organization_id, date, schedule_group_id, client_id)
```

RPC (имена рабочие): `add_group_roster_client`, `remove_group_roster_client`, `mark_roster_attendance` (идемпотентность как у mark). Не вызывать payroll / venue-cost / freeze. Teacher-scope: те же `teacher_can_mark_group_attendance` / `teacher_has_schedule_group_access`, что у `attendance`.

Поведение журнала:

| Ситуация | Список на урок |
|---|---|
| Lite, нет абонементов | roster группы + кнопка «добавить ученика на занятие» |
| Studio/Pro | абонементы группы **∪** roster (история Lite) **∪** разовые по правилам Studio |
| Даунгрейд, живой абонемент | **старый** `mark_attendance` списывает урок. Не наказывать ученика. Payroll/venue-cost **не** начислять (§3.2) |
| Даунгрейд, абонемента нет | roster |
| Тот же клиент в roster **и** в абонементе группы | один раз: если есть живой абонемент → только `mark_attendance`. Roster-строка на эту дату не дублирует. Нет фейкового subscription (F42) |

Freeze абонемента в Lite **скрыт** (даже у дохаживаемого пакета). Empty-state: «добавьте ученика на занятие», не «продайте абонемент».

`add_group_roster_client`: только существующий `clients.id` с `archived_at IS NULL`; кап клиентов — на INSERT клиента, не на roster. UNIQUE (org, group, client). Remove не CASCADE-ит `roster_attendance`.

Без этого узла Lite нельзя выпускать.

### 4.8. Сетка расписания после даунгрейда

Единая occupancy. Аренда, персоналка, мероприятие, отпуск — **серые read-only чипы** с подписью «доступно в Pro» (персоналка — «доступно в Studio», если ceiling/режим Studio не даёт create, но строка с Pro/Studio осталась). Клик → карточка просмотра без Оплатить/Удалить серию прошедшего. Удаление серии на Lite **запрещено для прошедшего** (не рвать финансы). Исключения occupancy (зал не вечно занят): отмена **будущей** аренды (`cancel_rental` / `cancel_rental_series_occurrence` / `renter_cancel_bookings_from_date` / `renter_cancel_pack_from_date`); удаление **будущей** персоналки; отмена **будущего** мероприятия. Прошедшие слоты не трогать. Mini App новые брони — отказ.

Создание: «+ Аренда / Мероприятие / Персональный» скрыты по capability. Не использовать `modules.locations` как прокси аренды.

Freebusy Google в формах записи: не звать Edge на не-Pro (F62).

### 4.9. Фоновые джобы

Условие «пауза Pro-воркеров»: `active_edition <> 'pro'` **или** (для Mini App) не `renter_miniapp_addon_is_active`. Не путать с expire-cron: он работает **всегда**. При `editions_lifecycle=off` пауза **не** применяется (поведение 2.11, F91).

| Джоб / Edge | Поведение |
|---|---|
| `expire-crm-subscriptions` | Studio **и** Pro month: `past_due` + clamp lite (`expire_grace`) → после grace Lite licensed, **не** suspend. Читает флаг `editions_lifecycle`. Пока off — поведение 2.11 |
| `enqueue_platform_crm_subscription_digest` | те же org; тексты «Lite / продлите Studio\|Pro», не «suspended». Включать Studio month |
| `purge-expired-demo-orgs` | больше **не** удаляет org с живым `free_lifetime` / `licensed`. Новый путь: `trial_end` → Lite. Hold заявки Inbox (2.11) сохранить. Ручной purge в Dev Console — только demo без данных / явный developer. Пока флаг off — старый purge демо |
| `renter-booking-worker` | не создаёт **новые** холды; confirmed **доигрывают** дату, включая T−24 `prepaid_charged` по уже существующим self-hold (не бросать заряд). `renter_create_booking` → `edition_forbidden`; исходящий студийный бот не enqueue новых |
| `calendar-sync-worker` / kick | не enqueue новых; **не** удалять события в Google. Триггеры `enqueue_calendar_sync` на таблицах — no-op, если `!edition_allows(google_calendar)` (Studio INSERT персоналки иначе забивает outbox, F96) |
| `google-calendar-webhook` | **не** писать в CRM, если `!edition_allows(google_calendar)` (иначе апгрейд/даунгрейд рассинхрон с другой стороны) |
| `google-calendar-renew-watches` | не продлевать каналы на не-Pro |
| `calendar-reconcile-personal` / `calendar-extend-group-horizon` | skip org без Pro |
| `google-calendar-freebusy` | отказ, если не Pro |
| смена TZ org | не ослаблять триггер Mini App слотов; на даунгрейде CTA «снять будущие» **до** смены TZ (F111) |
| venue-cost / payroll RPC-cron | не считает **новые** начисления; старые строки не трогает |
| `platform-notification-worker` | жив на всех редакциях (заявки, тикеты, org_created). Шаблон kind Studio |

При возврате на Pro: reconcile GCal по кнопке + renew watches; Mini App снова `renter_miniapp_addon_is_active`.

### 4.10. Онбординг и пресеты

Визард сейчас включает модули по пресету (`solo_teacher`, `dance_school`, …). После узла:

- новый орг = демо Pro 30 дней (продажа), затем Lite (v1; §11.10);
- при создании: `free_lifetime` + `trial_pro`, `active_edition=pro`;
- пресеты модулей **clamp** к редакции в effective, JSONB не затираем;
- `FirstDayChecklist` / empty-state «продайте абонемент» на Lite не показывать;
- соло-преподаватель на Lite: персоналки в JSONB могут быть true — UI/SQL всё равно закрыты.

### 4.11. Лендинг

Три карточки, CTA «Начать бесплатно» → регистрация (демо Pro → Lite), «Studio» / «Pro» → `#pricing`. Матрица §3.2 = копирайт. Не копировать текущий `Features.tsx` (там финансы и персоналки как у единого Pro). Лендинг — `tangodb-landing`, не Dev Console.

### 4.12. Версионирование CRM

Подверсия **2.12**. `crm_product_versions` остаётся `v2`. Не путать edition с `APP_VERSION`. Первый код E1 → `2.12.0` в `appVersion.ts` + `package.json`.

Dev Console — **§17**. Схема БД целиком — **§18**.

---

## 5. Бесконфликтный переход

### 5.1. Жёсткие правила

1. **Никакого DELETE tenant-данных** при смене редакции (абонементы, платежи, аренды, GCal links, кошельки, payroll, roster).
2. Апгрейд = открыть write-path. Данные уже на месте.
3. Даунгрейд режима = закрыть write-path + остановить джобы. Сетка и карточки читают историю.
4. Смена — **одна DB-транзакция** (`set_organization_active_edition` / activate purchase / cancel month). Не «сначала JSONB модулей, потом лицензия». Dual-write зеркал в той же TX.
5. Идемпотентность: повтор того же перехода — 200 без второго side-effect.
6. Audit: `platform_audit_log` (Dev Console / activate) и/или `organization_edition_events`: from, to, reason, actor.
7. UI даунгрейда: чеклист «что заморозится», явный confirm (фраза «данные не удаляются»). Режим vs отмена месяца — **две** кнопки, не одна.
8. Побеждает Activate (покупка) над `owner_mode` в гонке той же секунды, если ceiling вырос (F27): lock строки org.

### 5.2. Матрица переходов

| Из → в | Условие | Деньги | Данные |
|---|---|---|---|
| Lite → Studio | заявка `crm_studio_subscription` + Activate | новая оплата Studio | абонементы/прайс начинают писаться |
| Lite → Pro | `crm_subscription` или `crm_license` | как сейчас | всё открывается |
| Studio → Pro | SKU Pro; month Studio canceled | полная цена Pro в v1 | финансы/аренда оживают |
| Studio → Lite (режим) | ceiling ещё Studio | месяц жив | продажи скрыты, потолок Studio — «Вернуть Studio» без оплаты до expire |
| Studio → Lite (cancel/expire) | `owner_cancel` или конец grace | месяц не продлевается | продажи закрыты; остатки абонементов **списываются журналом**; licenses-строка subscription удалена |
| Pro month → Lite (режим) | lifetime нет, month **active** | месяц жив | Mini App/GCal выкл, ceiling Pro; «Вернуть Pro» без оплаты |
| Pro month → Lite (grace) | `period_end` | ещё можно renew | auto-режим Lite; «Вернуть Pro» **без оплаты нельзя** (только renew/Activate) |
| Pro month → Lite (cancel/expire) | cancel/конец grace | как Studio | + Mini App выкл, GCal пауза; licenses delete если нет lifetime |
| Pro lifetime → Lite | только `owner_mode` | lifetime **не** сгорает | ceiling `pro`; возврат мгновенный |
| Pro → Studio (режим) | `owner_mode`, rank(studio) ≤ ceiling | не покупка Studio | финансы freeze; **не** продавать SKU Studio при ceiling Pro; если потолок держит **`pro_monthly`**, renew/T−7 и `purchaseSkuLock` остаются **Pro** (`crm_subscription`), не Studio (F72) |
| Pro month → Studio (оплата) | v1: сначала cancel Pro, потом купить Studio (иначе два месяца / бесплатный Pro) | новая оплата Studio | — |
| любая → выше при raising **phase=active** (lifetime / active month; **не** один `past_due`) | без оплаты | — | мгновенно (lifetime сидел в Lite). Grace: вверх только Activate/renew |

Активировать Studio, когда уже Pro lifetime → `already_pro_lifetime`.

### 5.3. Сценарий-якорь по шагам

1. Регистрация → демо Pro 30д (`trial_pro`, Mini App выкл).
2. Не купил → `licensed` + Lite. Журнал через roster. Purge **нет**.
3. Купил Studio → продажа абонементов и персоналок. Старые отметки roster остаются в истории.
4. Купил Pro → финансы, аренда, Mini App, GCal.
5. Банкротство: **Отменить подписку** + режим Lite (или одна кнопка-комбо cancel). Арендаторы не бронируют. Будущие confirmed слоты видны. Ученики с остатком абонемента ходят, журнал списывает. Денег в «Финансах» не принимают; **операционная оплата абонемента тоже закрыта**. Остаток уроков «дохаживается».
6. Через год снова Pro month/lifetime → все разделы и история платежей на месте; Mini App включается; GCal — ручной reconcile.

---

## 6. План реализации

Линейно. Следующий этап после DoD предыдущего. Код не начинать, пока закрыт §11 (E0). v1-канон противоречий уже записан в §3.1 / §3.5 / §4.6 / §4.7 — не блокирует E0 по именам и expire.

| Этап | Что | DoD |
|---|---|---|
| **E0** | Закрыть §11 письменно (цены Studio — единственный жёсткий блокер денег; остальное = дефолты этого файла) | нет споров про имена, expire→Lite, **фазы grace §3.1**, журнал Lite, lifetime, режим vs cancel, dual-write licenses DELETE **не во время grace** |
| **E1** | SQL: entitlements/state/events, хелперы **time-aware**, RLS, backfill **каждой** non-purged org (нет state-строки = дыра), `organization_allows_writes` для Lite **обёрнут флагом** (при off = тело 2.11), expire→Lite (persist только при флаге on), dual-write зеркал (`period_*` → `current_period_*`), капы INSERT **и UPDATE restore/reactivate** + advisory lock **bigint** + accept invite, `edition_allows` согласован с капом `multi_*` (F71), триггеры PostgREST **INSERT≠UPDATE** (F98) + wrap флагом (F91), XOR raising (F94), `platform_runtime_flags`, **purge F70/F79**, review-hold + Studio SKU (F80), **Activate/preview month `IN` двух SKU** (F109/F118), wrap `dev_console_adjust_organization_subscription` + `extend_one_month` (F113), notification CASE Studio (F114) | SQL-тесты: 3 редакции × write deny/allow **через RPC и JWT INSERT**; grandfather Pro; демо→Lite без purge; lifetime не затирается month; повторная покупка Studio после cancel; **cancel month → нет licenses-строки → isReadOnly false**; cap PostgREST INSERT + restore client + accept invite + concurrent insert; grace **без ожидания cron** (`period_end` в прошлом, status ещё active → касса forbidden) **только при флаге on**; при флаге off тот же фикстур = поведение 2.11 (writes закрыты / не Lite); **licensed Lite purge forbidden**; `suspended`+`force_anti_abuse` с note; первый зал Lite ok, второй cap; `studio_monthly`+`pro_lifetime` → unique violation; UPDATE имени зала на Lite ok; `mark_attendance` leftover на Lite не `edition_forbidden`; `preview_activate` Studio ≠ `preview_month_only`; Activate Studio ≠ lifetime-ключ; `extend_one_month` пишет entitlement `period_end` |
| **E2** | Каталог capabilities в TS + merge modules; nav/route/CTA; починить `/prices` и `/renters`; accountant/reception fallback **Lite и Studio** (F110/F123); **early-return payroll / rental-inbox + `canAccessFinanceNav` + settings-index (F124)**; `useFinanceRentalScreensEnabled` ⊂ `hall_rent` (F117); **`isReadOnly` без month-lock** + grace-баннер вне `ReadOnlyBanner` (F108/F122) | скрытые маршруты редирект; прямой URL `/finance` на Lite **и Studio** → upsell, не 500 и не петля; accountant → upsell Pro, не `/renters`/`/prices`/`/clients`/`/settings/hall-rent`; teacher Lite (JSONB `finance_basic` true) → не `/finance/payroll`; live Studio/Pro month и licensed Lite после cancel — **не** серая вся CRM (`isReadOnly` false); grace CTA виден без isReadOnly |
| **E3** | Гейт write-RPC **и** триггеры таблиц (продажи, платежи, аренда, цены, export, GCal enqueue, caps, expenses, personal_lessons INSERT); убрать leftover `useSubscriptions.insert` (F120); leftover pair-cron не гейтить как продажу (F112); `create_renter` + карточка (F115) | teacher REST на Lite не продаёт абонемент и не INSERT `personal_lessons` / `prices` / `expenses` (как S36, но edition) |
| **E4** | `schedule_group_roster` + `roster_attendance` + RPC | Lite: отметить клиента на слот; Studio: старый путь; даунгрейд: оба вида строк на одном уроке; payroll с roster = 0 |
| **E5** | Occupancy read-only чипы + запрет create | сетка не падает, если есть rental на Lite |
| **E6** | Payment config v3 + Studio override-поля формы DC (F90) + quote SKU Studio (`parsePurchaseQuoteSku`, F118) + Inbox Activate/`rowKind`/`isMonthly` (F76/F93) + **SQL preview/Activate `IN`** (F109) + Billing create-manual SKU + `extend_one_month` + убрать canned note и Stripe-option (F82/F100/F113/F121) + Tenants/Metrics + Orgs purge UI (F73/F79) + Keys generate+issue (F119) + notification CASE (F114) + renter bootstrap (F74) | round-trip fixtures как 2.11; Inbox Studio ≠ lifetime **и** preview не `preview_month_only`; Dev Console = entitlements |
| **E7** | UI лицензии: три карточки, режим vs cancel, lifetime «вернуться в Pro», Lite может открыть покупку | сценарий-якорь руками |
| **E8** | Джобы: Mini App, GCal (включая webhook skip), expire cron, purge demo; TZ не менять при живых Mini App слотах без CTA (F111) | fail-closed Mini App на Lite/Studio; webhook не пишет CRM |
| **E9** | Демо lifecycle: trial_end → Lite; retention только abandoned (не v1) | регистрация 31-й день = Lite writes; `data_purge_at` NULL |
| **E10** | Лендинг, i18n ru/en/vi, docs | architecture + VER-1 2.12 |
| **E11** | Нагрузочный смоук: якорь + 2 роли (owner, teacher) + accountant на Lite **и Studio** | нет белого экрана, нет «0 учеников» из-за абонементов; accountant → upsell Pro, не петля на `/finance`/`/renters`/`/prices`/`/clients`/`/settings/hall-rent`; teacher Lite не `/finance/payroll`; grace-баннер без isReadOnly |

Нарезка агента — **§16**. Этап **E1** = промпты E1a→E1b→E1c; этап **E6** = E6a→E6b→E6c. Этап N+1 не начинать, пока все промпты этапа N не `[x]`.

Оценка порядка: E1–E3 — каркас; E4 — самый рискованный продукт; E6–E7 — деньги; E9 — ломает текущий purge.

Рекомендуемый production cutover: entitlements + backfill Pro **до** включения expire→Lite / demo→Lite. Флаг **`editions_lifecycle`** хранить **не** в `platform_payment_methods.config` (save цен делает CAS `pricingRevision` и легко включит lifecycle чужим деплоем — F46). Канон: таблица `platform_runtime_flags(key text PK, value jsonb, updated_by uuid, updated_at)` или эквивалент рядом с `platform_notification_settings`. UI-галка — **Billing** (developer), не Payment methods. Default false на prod, true на staging. Включение — `platform_audit_log`.

Пока false: licensed org ведёт себя как сейчас (ceiling Pro для платящих **на write-path**, демо ещё purge, expire ещё suspend). CRM уже может **показывать** бейдж редакции после E1 backfill (read-only Metrics/Tenants), но **write-гейт и cron — старые**. При off: `organization_allows_writes` и силовые `edition_allows`/триггеры = тело 2.11 (early-return, F91) — **не** открывать licensed Lite writes. **`isReadOnly` (E2/F108)** деплоить до флага можно и нужно: снять month-lock, иначе Studio month и licensed Lite после cancel упрётся в серую CRM; это не то же самое, что включить Lite write-path.

**Не включать флаг**, пока не закрыты **E1–E9** (E2: `isReadOnly` + grace-баннер F122; E4: журнал; E5: occupancy leftover; E6: Inbox/SKU; E7: витрина режим/cancel; E8: джобы; E9: demo→Lite). Иначе Lite без журнала / серая CRM / Mini App от старого хелпера / сетка падает на leftover аренде. **E10** (лендинг/docs) флаг на prod не блокирует. **E11** смоук на staging — до prod-включения. Runbook — **§22**.

Между деплоем E2 и включением флага: истёкший Pro month может видеть **не** серый UI, пока SQL writes ещё 2.11-закрыты — зазор не растягивать; Activate Studio в этом окне **запрещён**.

---

## 7. Рекомендации (сжато)

1. Коды `lite` / `studio` / `pro`, в UI «Lite / Studio / Pro».
2. Ceiling ≠ active edition. Lifetime Pro переживает «режим Lite». **Режим ≠ отмена месяца.**
3. Истечение месяца → **Lite**, не `suspended`.
4. Демо → Lite, **не удалять базу** по таймеру 30 дней. Purge — только явно abandoned / антифрод.
5. Не использовать `modules` JSONB как тариф.
6. Журнал Lite — **новые** таблицы roster, не nullable `attendance.subscription_id`.
7. Даунгрейд не каскадит DELETE. Occupancy важнее чистоты меню.
8. На даунгрейде **дохаживать** оплаченные абонементы и персоналки (write журнала/отметки), но **не** продавать новые и **не** принимать новые деньги.
9. Один рельс оплаты, новый SKU Studio, schemaVersion 3 с **обратным чтением v2**.
10. Гейт Mini App и GCal — SQL, не надежда на скрытое меню. Webhook тоже.
11. Accountant на Lite **и Studio**: роль остаётся; landing = upsell Pro (нет `clients.read`). Не удалять member. Не слать на `/renters` / `/prices` / `/settings/hall-rent`. Учитель на Lite/Studio: не `/finance/payroll` (F124).
12. Капы Lite с первого дня после демо (1 зал, 1 направление, 200 клиентов, 8 членов) на INSERT; overs с демо не режем.
13. Dual-write `organization_licenses` / `organization_subscriptions`; истина в entitlements.
14. `free_lifetime` живёт всегда рядом с платным правом — expire не создаёт Lite с нуля.
15. После cancel месяца без lifetime — **нет** строки `organization_licenses` (CHECK не знает `none`).
16. Grace ≠ касса и ≠ «вернуть редакцию без оплаты».
17. Капы — триггер INSERT **и** restore/reactivate; pending invites без expired; advisory lock **один bigint**. `isReadOnly` 2.11 не использовать для edition.
18. Purge: licensed Lite с `free_lifetime` **нельзя** (F70); `suspended` антифрод — только `force_anti_abuse` + note, не `force_licensed` (F79).
19. Хелперы редакции **time-aware**; cron персистит, не является единственным гейтом кассы — **после** включения флага. До флага write-path = 2.11.
20. Inbox `rowKind` fail-closed; фильтр Studio отдельно от Pro month; UI `isMonthly` включает Studio kind.
21. Триггеры не режут consume и UPDATE не-каповых полей (§18.12).
22. XOR одного raising-instrument; Studio SELECT `payments` не отбирать.
23. Имена SQL/Edge = 2.11.48: adjust = `dev_console_adjust_organization_subscription` + `extend_one_month`; preview/Activate month = `IN` двух SKU. Activate Studio при флаге off → `editions_lifecycle_off`.
24. Accountant fallback на Studio так же, как на Lite: **upsell Pro**, не клиенты/касса (F123).
25. Leftover pair-cron и `correct_attendance` на Lite — consume, не продажа.
26. Payroll/venue skip на Studio; TZ не менять при живых Mini App слотах.
27. `ReadOnlyBanner` после E2 — только dead org; grace CTA не внутри `isReadOnly` (F122).
28. **Якоря реализации** (не плодить ещё один чеклист — F85): fallback ролей — §4.5, **§16 #### E2** шаг 5, F123, **F124**; cutover — §22; матрица write-path — §18.9; карта «где правда» — шапка после канона.

---

## 8. Где сломается: сбои, ошибки, что делать

Каждый пункт: **симптом → причина → путь**.

### F1. Журнал Lite пустой

- **Симптом:** «на занятие некого отмечать», хотя клиенты есть.
- **Почему:** `computeSubsForDate` / журнал завязан на абонемент группы; в `attendance` нет `client_id`.
- **Путь:** E4 roster; empty-state «добавьте ученика на занятие», не «продайте абонемент».

### F2. Скрыли меню — учитель продал абонемент через REST

- **Симптом:** на Lite появляются `subscriptions` / `personal_lessons` / `prices` / `expenses`.
- **Почему:** S36, модуль не в RLS. Канон продажи группы — RPC `create_group_subscription`, но персоналки и расходы — **PostgREST INSERT** (`useAddPersonalLessons`, `useCreateExpense`, `usePrices`). Гейт «только в RPC» дырявый (F75).
- **Путь:** `edition_allows` внутри RPC **и** BEFORE INSERT/UPDATE триггеры §18.9. Тест: JWT teacher + Lite + POST `personal_lessons` / `prices` / `expenses` → `edition_forbidden`; `create_group_subscription` → `edition_forbidden`.

### F3. После даунгрейда с Pro зал вечно занят арендой

- **Симптом:** нельзя поставить группу на слот, арендатор «висит».
- **Почему:** occupancy считает confirmed rental; на Lite нельзя ни отменить, ни видеть карточку.
- **Путь:** карточка read-only + действие **«Снять будущие слоты»** (`cancel_rental`, pack-from-date). Прошедшие слоты не трогать. Mini App новые брони — отказ. То же для **будущих** персоналок и мероприятий (§4.8).

### F4. Mini App жив на Lite

- **Симптом:** арендатор бронирует, worker шлёт Telegram, кошелёк двигается.
- **Почему:** `renter_miniapp_addon_is_active` смотрит только licensed+lifetime/month, не edition.
- **Путь:** licensed ∧ `organization_active_edition() = pro` ∧ `edition_allows(renter_miniapp)` ∧ нет live `trial_pro`. Демо/trial = false. Тест SQL. Исходящий бот не ставить в очередь.

### F5. Истёк Pro month — вся студия read-only / suspended

- **Симптом:** нельзя отметить журнал, owner на `/license-required`.
- **Почему:** текущий канон 2.11: `past_due` → `isReadOnly`; после grace `suspended`.
- **Путь:** expire → Lite writes (фазы §3.1); баннер «Studio/Pro закончились». `LicenseRequiredPage` не для штатного expire. `isReadOnly` не от `isCrmSubscriptionWriteClosed`.

### F6. Lifetime «съели» даунгрейдом

- **Симптом:** работал в Lite, «Купить Pro» просит деньги повторно.
- **Почему:** одна колонка `license_type` 1:1, перезапись в `subscription`/`none`.
- **Путь:** entitlement `pro_lifetime` status=active всегда; зеркало `organization_licenses.license_type` **не** даунгрейдить. Кнопка «Вернуть Pro» без Inbox.

### F7. Активация Studio поверх Pro lifetime

- **Симптом:** две подписки, Billing врёт, sync вешает org (урок 2.11 про month→lifetime).
- **Путь:** RPC Activate: если `pro_lifetime` — отказ `already_pro_lifetime`. Month Studio не создавать.

### F8. `organization_settings.modules.finance_basic = true` на Lite

- **Симптом:** пункт Финансы всплыл / наоборот persist выключил абонементы Studio навсегда.
- **Путь:** effective = catalog ∩ settings. Сохранение настроек **не** пишет ключи вне каталога. При апгрейде старые флаги владельца оживают как есть.

### F9. Дашборд и дебиторка на Lite

- **Симптом:** KPI «долги», запросы `financial_debtors_v`, accountant-хуки, 403, вечный skeleton.
- **Путь:** дашборд Lite без финансовых виджетов и без финансовых query. Не звать `useFinance*` если `!editionAllows('finance')`.

### F10. Карточка клиента: «Продать», долг, абонемент

- **Симптом:** CTA ведёт в закрытый раздел / ошибка RPC.
- **Путь:** CTA по capability. Блок «архив абонементов» read-only, если строки есть.

### F11. Прайс и продажа персоналки с расписания

- **Симптом:** deep link `?action=sell`, «Оплатить» в `LessonInfoPopup`.
- **Путь:** те же гейты, что nav. На Lite popup без кассы; персоналка с Pro — просмотр + отметка посещения, без доплаты.

### F12. Бесплатный Lite × тысячи баз

- **Симптом:** диск, cron, support.
- **Путь:** капы §3.5. Abuse: `suspended`. Опционально purge **только** орг без логина N дней и без данных — не v1, не путать с демо-30.

### F13. Онбординг пресет vs редакция

- **Симптом:** визард включил персоналки, SQL отказ.
- **Путь:** clamp пресета; после демо→Lite выключить недоступные модули **в effective**, не затирая JSONB (чтобы апгрейд вернул выбор).

### F14. Quote / schemaVersion

- **Симптом:** Studio берёт цену Pro month или fail-open 0; либо Pro-покупка падает, пока нет цены Studio.
- **Путь:** нет `crmStudioMonthly` → submit/quote Studio fail-closed. Pro SKU резолвятся с v2. Contract test parse/resolve v2 и v3. Не угадывать сумму с клиента. **Синхронные артефакты (F14):** канон `tangodb/src/lib/platformPaymentContract.ts` ↔ `supabase/functions/_shared/platformPaymentContract.ts` (Edge резолв через re-export `_shared/paymentQuote.ts`); обёртки `tangodb/src/lib/paymentConfig.ts` и `tangodb-dev-console/src/lib/paymentConfig.ts` (форма + parse/save, не дублировать логику резолва SKU вручную). Тесты: `tangodb` `platformPaymentContract.test.ts`, Edge `purchaseQuotePolicy_test.ts` / `create-purchase-quote`.

### F15. Две заявки Studio и Pro в Inbox

- **Симптом:** Activate не в том порядке, org на Studio после оплаты Pro.
- **Путь:** сериализация по org; вторая активация смотрит уже записанный ceiling. Inbox показывает обе `new`.

### F16. `sync_organization_subscription` ставит suspended

- **Симптом:** cancel month при живом Lite entitlement → орг мёртвая.
- **Путь:** cancel month **не** трогает `organizations.status`, если есть любой живой ceiling (`free_lifetime` всегда после демо). DELETE `organization_licenses`, если нет lifetime. Не копировать ветку 2.11 «canceled и не lifetime → suspended» без правки.

### F17. Teacher scope и персоналки на сетке Lite

- **Симптом:** чужие персоналки пропали / наоборот открылись.
- **Путь:** RBAC не менять. Edition режет create, не SELECT scope.

### F18. Офлайн IndexedDB после даунгрейда

- **Симптом:** очередь `sync_offline_mark_attendance` шлёт списания абонементов с Lite-телефона.
- **Путь:** capability `offline_attendance` только Pro; на Lite/Studio не копить очередь. При даунгрейде — reconciliation: не применять sell-операции.

### F19. i18n «план» vs абонемент

- **Симптом:** ключи `license.plan.*` путают кассу ученика.
- **Путь:** префикс `edition.*` / `license.edition.*`. Не reuse `subscription`.

### F20. Export и Storage

- **Симптом:** Lite выгрузил всю базу включая платежи (H8-класс).
- **Путь:** `can_export_data` ∧ `export_operational`; финансовый export ∧ `export_financial`. На Lite кнопки нет; RPC тоже.

### F21. Google watch истекает, потом апгрейд

- **Симптом:** после возврата в Pro календарь молчит.
- **Путь:** при апгрейде enqueue `reconcile` + renew watches. UI «Синхронизировать» на Integrations (раздел виден только Pro).

### F22. Payroll / venue-cost pending на даунгрейде

- **Симптом:** `pending_unpriced`, баннеры на дашборде Lite.
- **Путь:** баннеры финансовых дыр только при `finance`. Начисления не пересчитывать без Pro. Roster-отметки не должны создавать accruals.

### F23. Роль accountant без Финансов

- **Симптом:** пустой шелл, редирект-петля. Сейчас accountant имеет `prices` и `hall-rent` (NAV-1) — на Lite оба закрыты редакцией.
- **Почему:** `canReadScopedCrm(accountant)=false` — нет клиентов/абонементов/журнала. После `/finance` fallback бьёт в `/renters` (F123).
- **Путь:** F123. Экран «раздел доступен на Pro». Не выкидывать из org. Не слать на `/prices`. Не расширять `can()` (F40).

### F24. Миграция backfill ошибочно дала Lite платным клиентам

- **Симптом:** завтра у lifetime-школы нет финансов.
- **Путь:** backfill только по `organization_licenses` + subscription status. SQL-тест на фикстуре lifetime. Сначала staging. Dev Console список ceiling. Feature flag lifecycle.

### F25. Конфликт deep links и модулей

- **Симптом:** `/personal/sell`, `/finance/debtors`, `/settings/hall-rent`, `/renters`, `/prices`.
- **Путь:** `PanelAccessRoute` + settings section keys завязать на capability. Не 404.

### F26. Демо purge убивает заявку Inbox

- **Уже лечили в 2.11 (review-hold).** При модели «демо→Lite без purge» CASCADE-риск **падает**. Не включать старый purge для Lite-licensed.

### F27. Параллельный owner: один покупает Pro, другой жмёт Lite

- **Симптом:** гонка active_edition.
- **Путь:** `UPDATE … WHERE` + lock org row в RPC. Побеждает транзакция Activate (покупка) над даунгрейдом, если ceiling вырос в той же секунде.

### F28. Клиентская «оптимизация»: выключить модули = сэкономить

- **Симптом:** поддержка «у нас пропали абонементы, мы не даунгрейдились».
- **Путь:** настройки модулей подписать «скрывает меню, тариф не меняет». Смена редакции — только `/settings/license`.

### F29. Лендинг обещает Studio финансы / Lite абонементы

- **Путь:** матрица §3.2 = источник копирайта. Не копировать Features.tsx как есть (там уже «финансы» и «персоналки» как у Pro).

### F30. `pair_subscriptions` / `trio_lessons`

- **Симптом:** на Studio нет парного тарифа, хотя прайс есть.
- **Путь:** эти ключи — фильтр прайса внутри Studio/Pro, не отдельный SKU. На Lite прайса нет целиком.

### F31. Licensed Lite не может купить (дырявый 2.11 helper)

- **Симптом:** нет CTA, `ManualPurchasePanel` не открывается, quote 403.
- **Почему:** `isManualPurchaseEligible` / `purchaseCtaKind` заточены под demo / month / suspended / lifetime.
- **Путь:** Lite licensed = eligible на Studio+Pro; CTA `buy`. Прогнать `crmLicensePurchase.test.ts`.

### F32. Повторная покупка Studio после cancel падает на UNIQUE

- **Почему:** unique `(org, edition, instrument)` на все статусы, включая `canceled`.
- **Путь:** partial unique только `active|past_due` (§4.3).

### F33. Dev Console Billing поправил месяц — CRM всё ещё Pro/Lite не то

- **Почему:** adjust пишет только `organization_subscriptions`.
- **Путь:** тот же RPC должен писать entitlements + state + audit (§17).

### F34. `/prices` виден на Lite, `/renters` спрятан вместе с вторым залом

- **Почему:** prices без moduleKey; renters = `locations`.
- **Путь:** §19. Тест nav на Lite/Studio/Pro.

### F35. Демо наплодило 4 зала — Lite не даёт открыть сетку / режет данные

- **Путь:** кап только на INSERT. Существующие залы работают. Баннер апселла.

### F36. GCal webhook двигает уроки на Lite

- **Путь:** worker/webhook проверяет `edition_allows(google_calendar)` до мутации CRM.

### F37. Dual-write drift: licenses.lifetime, entitlements уже month

- **Путь:** Activate/adjust/expire только через RPC; запретить authenticated UPDATE зеркал (уже column-GRANT). SQL-инвариант: если `pro_lifetime` live → `license_type = lifetime`.

### F38. `create-purchase-quote` отвергает Studio как invalid_sku

- **Путь:** CHECK quotes + TS `PlatformPaymentSku` + Edge allowlist + Dev Console kind filter одним контрактом.

### F39. Transfer owner Lite-арендатора требует lifetime factor

- **Почему:** `lifetime_license_verified` в Dev Console Orgs.
- **Путь:** для Lite без lifetime не предлагать этот фактор; остальные факторы живы.

### F40. Accountant / reception и hall-rent на Lite (константные тесты NAV-1)

- **Симптом:** unit-тесты `permissions.ts` ждут prices/hall-rent у accountant; edition сломает ожидание.
- **Путь:** тесты permissions оставить про роль; edition — отдельный слой. Не ломать NAV-1 внутри `can()`, резать выше.

### F41. Flag `editions_lifecycle=false` на prod, expire уже новый

- **Путь:** expire-cron и purge читают `editions_lifecycle_enabled()` из `platform_runtime_flags`, **не** из payment config. Пока выкл — поведение 2.11 (past_due/suspend + demo purge). **Write-path тоже 2.11** (канон r6 / F91), не time-aware clamp. Runbook §22.

### F42. Roster-отметка ушла в `mark_attendance` с фейковым subscription

- **Путь:** запретить. Отдельный RPC. Нет «технического абонемента» на всю группу.

### F43. Cancel месяца оставил `license_type=subscription` — Lite read-only

- **Симптом:** журнал и сетка серые, хотя статус `licensed`.
- **Почему:** `OrganizationProvider.isReadOnly` зовёт `isCrmSubscriptionWriteClosed`; при `license_type=subscription` и не-active → true на **всю** CRM. Типа `none` в CHECK нет.
- **Путь:** dual-write cancel/expire без lifetime = **DELETE** `organization_licenses`. `isReadOnly` больше не смотрит month. Тест: licensed Lite, `isReadOnly=false`, `mark_roster_attendance` ok.

### F44. Grace: владелец жмёт «Вернуть Studio» без оплаты

- **Почему:** `past_due` входит в ceiling, `set_organization_active_edition` поднимает active.
- **Путь:** фазы §3.1. Вверх только Activate или живой `active`/`pro_lifetime`.

### F45. `mark_attendance` на дохаживаемом абонементе начислил payroll на Lite

- **Путь:** skip accruals если `!edition_allows(payroll|hall_rent)`. Не бэкфилл при апгрейде.

### F46. Флаг lifecycle в payment config включился вместе с ценой

- **Почему:** `formStateToConfig` пишет весь JSON, CAS `pricingRevision`.
- **Путь:** `platform_runtime_flags`, галка Billing. Expire-cron читает тот же ключ.

### F47. Activate во время демо оставил `trial_pro` live

- **Симптом:** Mini App вкл/выкл непредсказуемо; unique live `trial_pro` мешает trial_end.
- **Путь:** cancel trial в той же TX, что paid entitlement.

### F48. 20 pending-инвайтов обходят кап 8 членов

- **Путь:** `create_organization_invite` считает active members + pending **non-expired** invites (F81). Expired слот не занимает.

### F49. Billing / Tenants не различают Lite и «licensed без зеркала»

- **Симптом:** в Billing org есть, но колонки как у пустой лицензии; в Tenants бейдж **Licensed**, не Lite.
- **Почему:** список уже от `organizations`, но нет JOIN `organization_edition_state` / entitlements; фильтр Billing `none` = нет month **и** не lifetime, не то же самое, что `active_edition=lite`.
- **Путь:** §17.3–17.4 — колонки ceiling/active, фильтр по edition; Tenants badge из `active_edition`, не только `license_type`.

### F50. Кошелёк арендатора заморожен на Lite без payout

- **Путь:** payout RPC разрешён; create booking / topup — нет.

### F51. T−24 worker создаёт новые холды на Lite

- **Путь:** новые холды/брони — нет; already confirmed self-hold доигрывают T−24.

### F52. Dual-write Studio → старый `renter_miniapp_addon_is_active` открыл Mini App

- **Почему:** хелпер 2.11 = licensed ∧ (lifetime ∨ month). Studio month выглядит как month. При `editions_lifecycle=off` wrap E1b **возвращает тело 2.11** — патч хелпера сам по себе Mini App не закрывает.
- **Путь:** патчить хелпер **в той же миграции**, что первое Activate Studio. **Activate Studio при флаге off → `editions_lifecycle_off`** (канон п.13). Не продавать Studio на prod, пока флаг off (§22).

### F53. Backfill снял `suspended` с антифрод-орга

- **Путь:** эвристика §4.3 + очередь «needs review» в Tenants. Сомнительные не трогать.

### F54. PostgREST INSERT 201-го клиента мимо RPC

- **Путь:** BEFORE INSERT trigger → `edition_cap_exceeded`. Тест: JWT INSERT, не только RPC.

### F55. Issue key сжёг ключ, entitlements пустые

- **Путь:** `dev-console-issue-key` / `activate_access_key` пишут `pro_lifetime` + state `pro` + `free_lifetime` если нет.

### F56. `/prices?section=hall-rent` и accountant fallback на Lite

- **Путь:** вкладка `hall_rent`. **`findFirstEnabledAccessiblePanelPath`** + `PanelAccessRoute`: accountant → upsell finance, не `/prices`. Reception → `/attendance`.

### F57. Freebusy / Integrations OAuth на Lite

- **Путь:** Edge `google-calendar-freebusy` и connect — `edition_allows(google_calendar)`. Пункт Integrations: upsell, не живой OAuth.

### F58. Renew grace создал второй live-row месяца (UNIQUE)

- **Путь:** Activate того же SKU при `past_due` обновляет строку, не INSERT. Тест SQL.

### F59. Сгенерированные типы без новых таблиц

- **Симптом:** TS в CRM/Dev Console не компилируется после E1; Edge `as any` на entitlements.
- **Путь:** после миграции `npm run db:gen-types` в `tangodb/`; обновить ручные union-типы в Dev Console (`PurchaseRequestKind`, `PlatformPaymentSku`). Не править только SPA.

### F60. Кап Lite обошли прямым INSERT

- **Симптом:** 201-й клиент через PostgREST, не через RPC.
- **Путь:** BEFORE INSERT триггеры §3.5 / §18.4; тест JWT INSERT (уже в тест-плане §9).

### F61. Кап членов обошли через accept invite

- **Симптом:** 9-й член после 8 pending-инвайтов или при полном штате.
- **Почему:** кап на `create_organization_invite` недостаточен — `accept_organization_invite` делает INSERT в `organization_members`.
- **Путь:** та же `organization_within_edition_cap(..., 'members')` в **accept** (и триггер INSERT members как страховка).

### F62. Freebusy / OAuth на не-Pro

- **Путь:** §4.8, §19; Edge `google-calendar-freebusy`, connect integrations — `edition_allows(google_calendar)`.

### F63. Platform bot / digest не знает Studio SKU

- **Симптом:** outbox/digest пишет «CRM monthly» для Studio или не шлёт T−7 Studio.
- **Путь:** шаблоны notification worker + `enqueue_platform_crm_subscription_digest` по `request_kind` / plan зеркала `studio` \| `pro` (§17.7).

### F64. Backfill unsuspend антифрод-org

- **Путь:** эвристика §4.3 + очередь needs review Tenants; не трогать сомнительные. *(Дублирует F53 — один чеклист в runbook §22.)*

### F65. Billing filter `none` приняли за «все Lite»

- **Путь:** отдельный фильтр `edition=lite` по `organization_edition_state`, не переиспользовать `license_type=null` alone.

### F66. Tenants `expiring_soon` не ловит month T−7

- **Симптом:** Studio/Pro на исходе месяца не в фильтре «скоро истекает».
- **Путь:** расширить `dev-console-list-tenants`: `expiring_soon` OR по `organization_subscriptions.current_period_end` (и после E1 — live `studio_monthly`/`pro_monthly` entitlements). Не путать с demo-only.

### F67. Quote policy тесты не покрывают Studio

- **Путь:** расширить Edge `purchaseQuotePolicy_test.ts` + CRM `platformPaymentContract.test.ts` на v3 и `studio_not_configured`.

### F68. Adjust subscription пишет только зеркало month

- **Путь:** wrap существующий SQL `dev_console_adjust_organization_subscription` (F113), не отдельный UI-save в `organization_subscriptions` без entitlements и не второе имя `_edition` (F33).

### F69. Studio цена подтянулась с Pro `monthlyAmount`

- **Путь:** резолв SKU: канон `crmStudioMonthly`, override `studioMonthlyAmount` — **никогда** fallback на `crmMonthly` / `monthlyAmount` (§20).

### F70. Dev Console purge удаляет licensed Lite

- **Симптом:** вечная бесплатная база стёрта «как демо».
- **Почему:** `purge_single_organization` не смотрит `organizations.status=licensed` и не знает `free_lifetime` entitlement — только lifetime license row и active month.
- **Путь:** в `_purge_demo_organization_core` / `purge_single_organization`: запрет purge при `status = 'licensed'` **или** live `free_lifetime` (и по-прежнему lifetime/month зеркала). `status = 'suspended'` **не** то же самое, что Lite: это антифрод/ручной бан — см. F79. Dev Console: убрать `force_licensed` для Lite; UI copy «licensed org нельзя». Тест SQL: licensed + только `free_lifetime` → `licensed_org_purge_forbidden`.

### F71. Кап-триггер разошёлся с `edition_allows(multi_*)`

- **Симптом:** первый зал на Lite 403 в RPC, но триггер капа пропускает; или наоборот — второй зал прошёл INSERT.
- **Почему:** в §4.2 «—» для Lite читали как «залы запрещены целиком».
- **Путь:** §3.5 — первый ресурс через cap; capability = «ещё один» (см. r4). Один хелпер `organization_within_edition_cap` вызывать из триггера и из `edition_allows` для `multi_location` / `multi_discipline`.

### F72. `owner_mode` Studio при оплате Pro month

- **Симптом:** владелец в режиме Studio, T−7 и Inbox предлагают `crm_studio_subscription`; продление режет доступ.
- **Почему:** UI смотрит только `active_edition`, не live instrument.
- **Путь:** renew-баннер, `purchaseSkuLock`, digest и quote lock — по **живому** `studio_monthly` \| `pro_monthly` (приоритет Pro month, если оба не могут сосуществовать — XOR §4.3). `active_edition=studio` при `pro_monthly` active — допустим режим, не смена SKU.

### F73. Tenants UI purge при том же SQL F70

- **Симптом:** кнопка Purge активна у licensed Lite (`OrgsPage.tsx`: `canPurge = status !== 'purged'`); `force_licensed` чекбокс для любого licensed.
- **Почему:** SQL F70 закрывает только часть org; UI не синхронизирован.
- **Путь:** `canPurge` = `demo_active`/`demo_retention` без review-hold **или** явный anti-abuse для `suspended` (F79). Для `licensed` / live `free_lifetime` — disabled + tooltip. `force_licensed` **не** использовать для Lite. `force_anti_abuse` — отдельный флаг + обязательная note + `platform_audit_log` (`org.purged_abuse`); SQL без note → отказ.

### F74. Mini App (`tangodb-renter`) без edition-гейта

- **Симптом:** арендатор видит кабинет на Studio/Lite, пока JWT жив; staff RPC отказывают — плохой UX и лишние запросы.
- **Почему:** bootstrap Edge не знает `active_edition` / `renter_miniapp_addon_is_active` после патча SQL.
- **Путь:** `fetchBootstrap` / `renter_miniapp_*` read model: флаг `addon_active` уже есть — привязать к **новому** SQL-хелперу §4.4; на false — экран «аренда недоступна», не очередь бронирования. Патч **в той же волне**, что F52 (до продажи Studio на prod). Типы Mini App: после `db:gen-types` не оставлять `as any` на edition (как F59 в CRM/консоли).

### F75. Time-aware vs cron; PostgREST INSERT в обход RPC

- **Симптом:** после `period_end` касса ещё продаёт, пока не прошёл expire-cron; либо на Lite teacher делает `insert` в `personal_lessons` / `expenses` / `prices`.
- **Почему:** r4 clamp'ил `active_edition` только в cron; список гейтов был «RPC» с вымышленным `sell_subscription` / `add_personal_lessons`.
- **Путь:** §3.1 time-aware функции; §18.9 триггеры. Тест: monthly `status=active`, `period_end` вчера → `edition_allows(group_subscriptions)=false` **до** вызова expire. JWT INSERT `personal_lessons` на Lite → `edition_forbidden`.

### F76. Inbox `rowKind` превратил Studio в lifetime

- **Симптом:** заявка `crm_studio_subscription` в UI как «CRM lifetime», Activate без period preview, ключ/lifetime-ветка.
- **Почему:** `PurchaseInboxPage.rowKind` и `kindToRequestKind("monthly")` не знают Studio; default = `crm_license`.
- **Путь:** §4.6 / §17.2. Тест консоли: list+activate Studio fixture.

### F77. Restore клиента / реактивация члена обошли кап

- **Симптом:** 200 активных + архив; restore → 201. Или 8 active + выключенный → `update_team_member(is_active=true)` = 9.
- **Путь:** §3.5 UPDATE-триггеры + проверка в `update_team_member`. Тест JWT restore.

### F78. Два параллельных INSERT проскочили кап

- **Путь:** `pg_advisory_xact_lock` в `organization_within_edition_cap` до count. Тест: два сеанса INSERT 200-го/201-го.

### F79. F70 запретил purge `suspended`, F73 разрешил anti-abuse — конфликт

- **Канон:** `licensed` + live `free_lifetime` → purge **запрещён** всегда. `suspended` (антифрод, не штатный expire) → purge **только** `force_anti_abuse=true` + note + audit. Не reuse `force_licensed`. Штатный expire 2.12 **не** пишет `suspended`, поэтому очередь Tenants «needs review» = старые 2.11 suspend / ручной бан.

### F80. Studio-заявка не держит demo purge (review-hold)

- **Почему:** `_organization_has_eligible_purchase_review_new` IN (`crm_license`,`crm_subscription`).
- **Путь:** добавить `crm_studio_subscription` в той же миграции, что CHECK kind. Пока `editions_lifecycle=off`, старый purge демо иначе сотрёт org с неоплаченной Studio-заявкой.

### F81. Просроченные инвайты занимают кап 8

- **Путь:** pending = `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`.

### F82. Billing `createManualSubscription` всегда Pro month без entitlements

- **Путь:** UI выбор SKU Studio/Pro/lifetime → тот же `dev_console_adjust_organization_subscription` (F113). Не оставлять быстрый `adjustStatus` без note на prod (уже note в submitEdit; quick status — либо убрать, либо та же RPC).

### F83. Два имени ошибки lifetime

- **Путь:** SQL Activate поднимает `already_pro_lifetime`; **также** `RAISE ... 'month_on_lifetime_forbidden'` как синоним на один релиз **или** Edge мапит оба. Не ломать 2.11 тесты Inbox до замены.

### F84. `upsert_renter` / invoices / `staff_renter_wallet_adjust` на Lite

- **Путь:** создание арендатора, счета, аванс, adjust баланса = `hall_rent` (Pro). Payout/preview — исключение §3.2. `HallRentalDashboardBlock` на `/` ⊂ `hall_rent`.

### F85. Дубли рисков (не плодить ещё один чеклист)

- F53 ≡ F64 (backfill unsuspend). F54 ⊂ F60 (INSERT кап). F33 ≡ F68 (adjust). F57 ⊂ F62 (freebusy). F41 ⊂ F91 (флаг vs write-path; канон — F91). F82 ⊂ F100 (canned note). F38 ⊂ F118 (quote SKU union). F76/F93 ⊂ F109 (preview/Activate SQL). F55 ⊂ F119 (keys consume). F63 ⊂ F114 (notification CASE). F23/F110 ⊂ F123 (accountant RBAC + fallback). F108 ⊂ F122 (баннер grace vs isReadOnly). F124 **дополняет** F123 (early-return payroll/rental-inbox + settings-index; F56 hall-rent tab — тот же слой E2). Канон — младший номер + runbook §22; старшие оставляем как ярлыки.

### F86. `organization_edition_state` нет строки после backfill

- **Путь:** backfill **каждой** org со `status <> 'purged'`. `get_organization_edition` без строки → fail-closed `lite` + log, не 500. После E1 — NOT NULL 1:1 (INSERT при create org).

### F87. `personal_lessons` INSERT с `subscription_id` (пакет персоналок) на Lite

- **Путь:** это **продажа/создание**, не consume. Trigger `edition_allows(personal_lessons)`. Consume = `mark_personal_lesson_attendance` на уже существующей строке.

### F88. Metrics / Tenants badge «Licensed» после E1

- **Путь:** §17.4–17.5. Пока lifecycle off бейдж из state допустим; не считать Studio по `organization_subscriptions.plan` без entitlements.

### F89. `sync_offline_mark_attendance` и `enqueue_calendar_sync` триггеры на таблицах

- **Путь:** capability в RPC sync/enqueue **и** не ставить новые outbox-стро, если `!edition_allows`. Существующие outbox-строки drain по правилам §4.9 (не создавать холды; GCal delete не слать).

### F90. Dev Console `paymentConfig` без полей Studio override

- **Симптом:** save v3 теряет `studioMonthlyAmount` / подставляет Pro `monthlyAmount`.
- **Путь:** типы `CryptoPaymentMethod` / bank / MIR / VN в `tangodb-dev-console/src/lib/paymentConfig.ts` + CRM обёртка; parse/save через канон `platformPaymentContract`. Тест F14/F69 на форме консоли, не только unit CRM.

### F91. Cutover whiplash: time-aware write при флаге off

- **Симптом:** после деплоя E1–E2 с `editions_lifecycle=false` истекший Pro month видит Lite-журнал, через 7 дней cron 2.11 ставит `suspended` → `LicenseRequiredPage`.
- **Почему:** r5 §17.8 велел time-aware `edition_allows` даже при off («касса по entitlements»), а persist-cron оставлял 2.11 suspend. Runbook при этом обещал «платящие ничего не заметили».
- **Путь:** при off **весь SQL write-path = 2.11**: `organization_allows_writes` не открывает licensed без lifetime/month; триггеры/`edition_allows` в RPC early-return. Backfill entitlements — только бейдж/Metrics. Time-aware clamp + Lite writes + expire→Lite — **только on**. **E2 (F108)** снимает month-lock в SPA `isReadOnly` **до** флага — это не открывает Lite SQL-writes и не time-aware кассу; откат только деплоем SPA. До E2 `isReadOnly` остаётся 2.11. Тест: флаг off, `period_end` вчера, status active → SQL writes как 2.11 (закрыты), UI после E2 без серого month-lock, журнал roster — ещё нет до E4+on.

### F92. Advisory lock с двумя `hashtextextended`

- **Симптом:** миграция капа не применяется: `function pg_advisory_xact_lock(bigint, bigint) does not exist`.
- **Почему:** r5 писал `pg_advisory_xact_lock(hashtextextended(org), hashtextextended(resource))`. В PG: один аргумент `bigint` **или** два `integer`. Код 2.11 (venue/payroll) — **один** `hashtextextended(org::text || ':…', 0)`.
- **Путь:** §3.5 / §18.11 — один bigint. Тест concurrent INSERT как F78.

### F93. Inbox UI `isMonthly` только `crm_subscription`

- **Симптом:** `rowKind` уже знает Studio, но Activate без period preview, кнопка как lifetime (ключ).
- **Почему:** `PurchaseInboxPage.tsx` ~368: `const isMonthly = kindRow === "crm_subscription"`; preview грузится только для этого kind; `kindToRequestKind` / `InboxKindFilter` в Edge не содержат `studio`.
- **Путь:** `isMonthly` = Pro month **или** Studio. Edge: `InboxKindFilter` + `"studio"`; activate Studio = та же ветка, что `crm_subscription` (не addon, не license). Тест: fixture Studio → preview + Activate с period.

### F94. `studio_monthly` + `pro_lifetime` проходят unique r5

- **Симптом:** admin adjust / гонка Activate оставляет месяц Studio при живом lifetime; Billing врёт; Mini App-хелпер смотрит month.
- **Почему:** unique `(org, instrument)` и XOR только двух month. Разная instrument-пара не конфликтует.
- **Путь:** partial unique `one_raising` §4.3. Activate/adjust в той же TX cancel'ит лишнее. Тест: INSERT второй raising → unique_violation.

### F95. Venue-ack блокирует кассу Studio после даунгрейда

- **Симптом:** `record_subscription_payment` → ошибка venue rule / баннер «подтвердите правило зала», хотя редакция Studio.
- **Почему:** 2.11 payment RPC требуют ack, если на дату нет покрывающей accepted-версии. Правила с Pro остаются.
- **Путь:** `!edition_allows(hall_rent)` → ack не обязателен, accruals не писать. UI ack-диалог на Studio/Lite не показывать.

### F96. `enqueue_calendar_sync` на Studio плодит outbox

- **Симптом:** после продаж персоналок на Studio растёт `calendar_sync_outbox`; апгрейд в Pro внезапно синкает старьё или worker жрёт квоту.
- **Путь:** enqueue no-op если `!edition_allows(google_calendar)`. Worker и так skip; **не создавать** строки.

### F97. Сняли `can_read_financial` на Studio — карточка абонемента без оплат

- **Симптом:** 403 на `payments` SELECT, skeleton кассы, teacher/owner не видит «оплачено».
- **Почему:** «финансы = Pro» прочитали как RLS. Платежи абонемента живут в той же таблице `payments`.
- **Путь:** роль не трогать. Edition режет expenses/payroll/rental **write** и UI `/finance` виджетов, не SELECT операционных платежей.

### F98. Слепой `BEFORE INSERT OR UPDATE` ломает consume и сетку Lite

- **Симптом:** на Lite `mark_attendance` leftover → `edition_forbidden`; нельзя переименовать единственный зал; отметка персоналки не пишется.
- **Почему:** `mark_attendance` делает UPDATE `subscriptions.lessons_left`; UPDATE `locations.name` при count≥1; attendance-RPC трогает `personal_lessons`.
- **Путь:** §18.12. Триггер капа/edition — INSERT (и точечный UPDATE restore/reactivate). Consume и rename — нет.

### F99. Неполный §18.9: `subscription_groups`, partner, payroll, rental invoices

- **Симптом:** teacher JWT INSERT `subscription_groups` после дырявого `subscriptions.insert`; `replace_subscription_partner` на Lite; `save_teacher_pay_rate` / `accept_venue_cost_rule_version` / `create_rental_invoice` / `record_rental_payment` / `close_group_lesson_occurrence` (venue close) без гейта.
- **Путь:** матрица §18.9 дополнена. `finish_subscription` без refund на leftover Lite — **да** (закрыть пакет, не продажа). Refund / partner replace — Studio+.

### F100. Billing `adjustStatus` с canned note

- **Симптом:** в `platform_audit_log` «Quick status change from Dev Console» без причины; случайный click active→canceled режет потолок.
- **Почему:** `BillingPage.adjustStatus` **шлёт** note, но зашитый. r5 F82 читался как «без note».
- **Путь:** убрать quick-кнопки **или** модалка с обязательной человеческой note. Create manual — выбор SKU Studio/Pro/lifetime, не молчаливый Pro month.

### F101. `onboardingStarterData` INSERT зала после trial_end

- **Симптом:** визард/чеклист на 31-й день пытается создать второй зал → cap; или отрабатывает на Lite.
- **Почему:** `lib/onboardingStarterData.ts` PostgREST INSERT `locations` / `disciplines`. Демо = Pro, после trial — Lite с уже 1+1.
- **Путь:** starter только пока `demo_active` / trial. На Lite чеклист не создаёт ресурсы. Кап-триггер — страховка.

### F102. `client_notes` / `price_*` junction / `teacher_pay_rates`

- **Путь:** `client_notes` INSERT — `clients` (Lite да). `price_teacher_members` / `price_disciplines` — `prices` (Studio+). `teacher_pay_rates` / `save_teacher_pay_rate` / `save_teacher_pay_rule` — `payroll` (Pro). Не оставлять PostgREST INSERT без триггера.

### F103. Edge `dev-console-purchase-inbox` activate не знает Studio kind

- **Симптом:** list пропускает фильтр, activate идёт в lifetime-ветку RPC (`crm_license` default) или 400 invalid kind.
- **Почему:** `request_kind` уходит в `activate_platform_purchase_request` как есть; SQL CHECK 2.11 не знает Studio, пока не миграция; UI default lifetime.
- **Путь:** одна миграция: CHECK kind + review-hold + Activate SQL + Edge filter + map ошибок. До этого Studio на prod не продавать (§22).

### F104. `purge_single_organization` сигнатура без `force_anti_abuse`

- **Сейчас:** `(p_org_id, p_actor_user_id, p_reason, p_force_licensed)`. Edge `dev-console-purge-org` шлёт `force_licensed`.
- **Путь:** добавить `p_force_anti_abuse boolean DEFAULT false`; без note/`p_reason` → `abuse_purge_note_required`. `force_licensed` **не** открывает licensed Lite (F70). Edge: новое поле, не алиас.

### F105. Digest / expire-cron читает только `organization_subscriptions`

- **Симптом:** Studio month не в T−7 digest; expire не clamp'ит entitlement, только зеркало.
- **Путь:** `expire_crm_organization_subscriptions` и `enqueue_platform_crm_subscription_digest` — live `studio_monthly` **и** `pro_monthly` (и зеркало). Тексты Studio ≠ «CRM monthly». Пока флаг off — SQL 2.11 (только зеркало Pro).

### F106. `schema_version_locked` vs Lite writes

- **Путь:** `organization_allows_writes` 2.12 по-прежнему `NOT schema_version_locked` первым. Edition не обходит locked. Тест: locked licensed Lite → writes false.

### F107. Dev Console Metrics без `suspended_count` / edition

- **Сейчас:** `DashboardPage` + `dev-console-metrics`: org/licensed/demo_active/demo_retention/keys/members/db size. Нет suspended, нет lite/studio/pro.
- **Путь:** §17.5. Пока E1 без UI — RPC может уже считать; карточки консоли в E6.

### F108. Dual-write Studio → `license_type=subscription` и 2.11 `isReadOnly`

- **Симптом:** после Activate Studio, до выключения `isCrmSubscriptionWriteClosed`, `period_end` красит **всю** CRM (как Pro month).
- **Путь:** E2 обязан снять `isReadOnly` с month **в том же релизе**, что первая продажа Studio. До флага on Studio не активировать. Зеркало `subscription` на live Studio month — норма; DELETE только после cancel/expire без lifetime. **Следствие F122:** снять isReadOnly без переноса grace-баннера = пропавший CTA renew.

### F109. `preview_activate` / Activate SQL режут Studio равенством `crm_subscription`

- **Симптом:** Inbox UI уже знает Studio (`isMonthly` оба kind), но preview 400 `preview_month_only`; Activate пишет lifetime-ключ / `crm_license` ветку.
- **Почему:** `preview_activate_platform_purchase_request`: `IF v_req.request_kind <> 'crm_subscription'`. `activate_platform_purchase_request`: month только `= 'crm_subscription'` (миграция `20261114000001`). F76/F93 закрывали UI/Edge filter, не это равенство.
- **Путь:** оба SQL — `IN ('crm_subscription','crm_studio_subscription')`. `_preview_crm_month_activation_period` — live month из entitlements. Тест: fixture Studio → preview period + Activate без ключа.

### F110. Accountant / reception fallback указан только для Lite

- **Симптом:** accountant на Studio → `/finance` (петля/upsell) или `/prices?section=hall-rent`. Reception → `/subscriptions/sell` если роль пускает.
- **Почему:** `PANEL_FALLBACK_PATHS` начинается с `finance`, затем `clients` (accountant miss), затем `renters`. `canAccessPanel` — RBAC, не edition. F23/F56 писали Lite и обещали «клиенты».
- **Путь:** канон — **F123**. **`findFirstEnabledAccessiblePanelPath`** (`PanelAccessRoute`, redirect с `/`) **и** **`findFirstAccessiblePanelPath`** (NAV-1) — пересечь с edition (общий хелпер). Accountant → upsell Pro. Reception → `/attendance`. Тесты NAV-1 роли не ломать внутри `can()`.

### F111. Смена TZ на Lite/Studio падает из-за leftover Mini App слотов

- **Симптом:** Настройки → TZ → `timezone cannot change while Mini App slots are awaiting_payment/active/prepaid_charged`, хотя Mini App уже выкл.
- **Почему:** триггер 2.11 на `organization_settings` смотрит строки `rentals`/`rental_series`, не addon helper.
- **Путь:** не ослаблять триггер. Occupancy CTA «снять будущие слоты» **до** смены TZ. Copy в UI при ошибке. Тест: Lite + leftover hold → TZ fail; после cancel → TZ ok.

### F112. `apply_scheduled_subscription_member_changes` закрыли как продажу

- **Симптом:** на Lite leftover парный абонемент не меняет состава в назначенную дату; журнал врёт.
- **Почему:** RPC вызывается из `mark_attendance` и хуков. Гейт `group_subscriptions` = edition_forbidden на consume-пути.
- **Путь:** как leftover `mark_attendance` — **разрешён**, если строка абонемента уже есть. `replace_subscription_partner` (новый график) — Studio+. Тест: Lite + scheduled change due → apply ok.

### F113. Billing `extend_one_month` и вымышленное имя adjust-RPC

- **Симптом:** поддержка продлила месяц в Billing — entitlements не сдвинулись / второй live-row / Studio стал Pro.
- **Почему:** факт 2.11.48 — SQL `dev_console_adjust_organization_subscription(..., p_extend_one_month)` + Edge `dev-console-adjust-subscription`. Спека r6 звала новую `dev_console_adjust_organization_edition`. `extend_one_month` не было в dual-write §18.3.
- **Путь:** **не** второе имя. Обернуть существующую функцию: внутри entitlements + XOR + dual-write + `add_calendar_month` на live instrument (Studio или Pro). Create manual — SKU picker. Note обязателен.

### F114. Platform notification CASE ELSE = Lifetime для Studio

- **Симптом:** новая заявка Studio в Telegram/email: «Lifetime» / «полная версия TangoDB».
- **Почему:** `enqueue` из `20261119000001`: `CASE request_kind WHEN crm_subscription THEN 'Месяц' ELSE 'Lifetime'`.
- **Путь:** явная ветка `crm_studio_subscription` → «Studio / месяц». Не оставлять ELSE = lifetime. Digest T−7 — отдельные тексты (F63/F105).

### F115. `create_renter` и запись карточки арендатора на Lite

- **Симптом:** на Lite появляется новый арендатор / договор / QR / бот, хотя касса аренды закрыта.
- **Почему:** §18.9 упоминал `upsert_renter` create. Legacy `create_renter` всё ещё GRANT authenticated. Contacts/contracts/documents/communications/QR/`commit_organization_renter_bot` не в матрице.
- **Путь:** INSERT нового = `hall_rent`. UPDATE имени/телефона **существующего** — да (карточка + payout). Остальное — Pro. Тест JWT `create_renter` на Lite → forbidden.

### F116. Дыры матрицы §18.9: события, close personal, venue draft, advances, export

- **Симптом:** `record_calendar_event_payment` / `update_calendar_event*` на Studio; `close_personal_lesson_occurrence` пишет venue на Studio; `save_venue_cost_rule_draft` / `confirm_venue_cost_rule_gap`; `record_rental_advance` / `allocate_rental_advance` / `correct_rental_payment` / `upsert_rental_tariff`; `can_export_data` + storage; `renter_create_recurring_pack` / `renter_quote_booking`.
- **Путь:** матрица **§18.9** (имена — §18.15). Events money ⊂ `calendar_events` (Pro). Personal/group close без accruals на non-Pro (как mark). Venue drafts/gap ⊂ `hall_rent`. Export: operational Studio+, financial Pro. Mini App pack/quote ⊂ `renter_miniapp`.

### F117. `useFinanceRentalScreensEnabled` смотрит `addonActive`, не edition

- **Симптом:** на Studio после патча SQL-хелпера Mini App выкл, но `/finance` вкладки аренды/topup ещё живы (или наоборот).
- **Почему:** хук читает `useLocationRentalHourRates` → `addonActive` (bundle 2.11), не `edition_allows(hall_rent)`.
- **Путь:** enabled ⊂ `hall_rent` ∧ Pro. Не использовать hour-rates как прокси редакции.

### F118. Quote/Activate контракт знает только два SKU

- **Симптом:** Studio quote → `invalid_sku`; submit не создаёт request; Activate не входит в month-ветку.
- **Почему:** `PurchaseQuoteSku` / `parsePurchaseQuoteSku` / `PlatformPaymentSku` = `crm_license` \| `crm_subscription`. CHECK `platform_purchase_quotes.sku` тот же. `create-purchase-quote` зовёт парсер до SQL.
- **Путь:** одна волна с CHECK kind/sku + review-hold (F80/F38/F103): TS union, парсер, quotes CHECK, Activate/preview SQL `IN`. До этого Studio на prod не продавать.

### F119. Keys: `dev-console-generate-key` vs `issue-key`

- **Симптом:** ключ сгенерирован на `/keys`, org активировала — entitlements пустые (только licenses 2.11).
- **Почему:** спека §17.6 писала issue-key. На `/keys` два режима: `dev-console-generate-key` (ещё не привязан к org) и `dev-console-issue-key`. Consume = `activate_access_key` в CRM.
- **Путь:** generate сам entitlements **не** пишет (ключа нет у org). `activate_access_key` и issue-на-орг (`OrgsPage`) пишут `pro_lifetime` + state + `free_lifetime` (F55). Тест: activate сгенерированного ключа → ceiling pro.

### F120. Leftover `useSubscriptions.insert` остаётся «на всякий случай»

- **Путь:** E3 **удаляет** PostgREST insert из `useSubscriptions.ts` (строки ~205/235) в пользу `create_group_subscription`. Триггер на `subscriptions`/`subscription_groups` — страховка, не замена починки хука (S36).

### F121. Billing UI всё ещё предлагает `provider=stripe`

- **Симптом:** adjust ставит `provider=stripe` на зеркале Studio/Pro; webhook Stripe заморожен — drift.
- **Путь:** v1 только `manual`. Опцию stripe в `<select>` убрать или disabled + copy «заморожен».

### F122. E2 снял `isReadOnly` — пропал баннер grace

- **Симптом:** month истёк, CRM не серая, нет CTA «продлите N дней»; `ReadOnlyBanner` = null.
- **Почему:** `ReadOnlyBanner` (`App.tsx`) весь внутри `if (!isReadOnly) return null`. T−7 живёт в `CrmSubscriptionRenewalBanner` (не isReadOnly) — grace туда не входил. `useCrmSubscriptionUi.graceDaysLeft` считается только при `writeClosed`.
- **Путь:** E2 — `ReadOnlyBanner` только demo retention / expired demo. **`suspended` — через `LicenseRequiredPage` / `OrgAccessRoute`, не через month-lock.** Grace / expire-Lite баннер (copy §3.1) — тот же слой, что T−7, от `get_organization_edition().phase` / live month, не от `isReadOnly`. `purchasePath` — Studio vs Pro (F72). Тест: licensed + `period_end` вчера + флаг off → UI не серый, баннер renew виден, SQL writes как 2.11.

### F123. Accountant fallback обещает клиенты/кассу — RBAC не даёт

- **Симптом:** accountant на Lite/Studio → `/renters` или `/prices` (hall-rent), петля, или спека велит `/clients`.
- **Почему:** `canReadScopedCrm(accountant)=false` (permissions.ts) → нет `clients.read`, `subscriptions.read`, `schedule.read`, журнала. `PANEL_FALLBACK_PATHS`: finance → clients (miss) → **renters (hit, Pro)** → … → prices (NAV-1 `canReadRentalTariffs` true, поэтому `canAccessPanel('prices')` true несмотря на поздний `role==='accountant' return false`). В SPA redirect идёт через **`findFirstEnabledAccessiblePanelPath`** (`PanelAccessRoute`), не только NAV-1-хелпер.
- **Путь:** не менять `can()` (F40). Intersection fallback ∩ edition в **обоих** fallback-хелперах **и early-return payroll/rental-inbox** + edition-aware `PanelAccessRoute` и `findFirstAccessibleSettingsSection`; если пусто — экран upsell Pro, роль жива. Не обещать операционную кассу accountant без нового `PanelId` (вне v1). Reception → `/attendance`. Тест: accountant Lite и Studio не на `/finance`/`/renters`/`/prices`/`/clients`/`/settings/hall-rent`. Teacher Lite не на `/finance/payroll` (F124).

### F124. Teacher payroll-only / rental-inbox-only / settings-index обходят edition

- **Симптом:** учитель на Lite (JSONB `finance_basic` ещё true — F13) с `/` попадает в `/finance/payroll`; admin с кассой аренды без `finance.read` — в `/finance/rental-inbox`; accountant на `/settings` — в hall-rent; в меню жив пункт «Финансы».
- **Почему:** `findFirstEnabledAccessiblePanelPath` **до** цикла `PANEL_FALLBACK_PATHS` (2.11.48): `isTeacherPayrollOnly` → `/finance/payroll`; `isRentalInboxOnly` → `/finance/rental-inbox`. `canAccessFinanceNav` открывает finance-nav тем же ролям. `findFirstAccessibleSettingsSection`: accountant без `settings.manage` пропускает general/org/subscriptions и первым хитом берёт `hall-rent` (`canReadRentalTariffs`). `license.view` только owner/director — accountant на license не сядет.
- **Путь:** E2. Early-return и `canAccessFinanceNav` ∩ `editionAllows`: payroll ⊂ `payroll` (Pro); rental-inbox ⊂ `hall_rent`. Settings-index ∩ edition: `hall-rent` ⊂ `hall_rent`; `data` ⊂ export_*; `integrations` ⊂ `google_calendar`; пусто у accountant → **тот же upsell Pro, что F123**, не Integrations. **Не** расширять `license.view` / `can()` (F40). NAV-1 assert'ы роли не ломать. Тест: teacher Lite + `finance_basic` JSONB true → home schedule/attendance/journal, не payroll; accountant `/settings` → не hall-rent.

---

<details>
<summary><strong>Карта F1–F124 по темам</strong> (ярлыки; канон — младший номер + §3–§5 / §17–§22)</summary>

| Тема | F |
|---|---|
| Журнал / roster | F1, F42, F45 |
| S36 / PostgREST / триггеры | F2, F75, F87, F98, F99, F102, F116, F120 |
| Occupancy / TZ / Mini App leftover | F3, F111 |
| Mini App / кошелёк | F4, F50, F51, F52, F74, F84, F115 |
| Expire / grace / isReadOnly | F5, F16, F43, F44, F91, F108, F122 |
| Lifetime / XOR / Activate | F6, F7, F32, F47, F58, F83, F94 |
| Modules / nav / accountant | F8, F23, F25, F34, F40, F56, F110, F123, **F124** |
| Касса Studio vs Pro | F9, F10, F11, F95, F97 |
| Капы | F12, F35, F48, F54, F60, F61, F71, F77, F78, F81, F92, F101 |
| Quote / SKU / Inbox | F14, F15, F38, F67, F69, F76, F80, F90, F93, F103, F109, F118 |
| GCal / webhook | F21, F36, F57, F62, F89, F96 |
| Dual-write / Billing / Keys | F33, F37, F55, F68, F82, F100, F113, F119, F121 |
| Purge / flag / cutover | F26, F41, F46, F53, F64, F70, F73, F79, F91, F104, F106 |
| Dev Console UI | F49, F65, F66, F73, F88, F107 |
| Notifications | F63, F105, F114 |
| Прочее | F13, F17–F20, F22, F24, F27–F31, F39, F59, F72, F85, F86, F112, F117 |

</details>

---

## 9. Тест-план (минимум)

SQL:

1. Lite owner: `create_group_subscription` → forbidden; JWT INSERT `personal_lessons` / `prices` / `expenses` → `edition_forbidden`; `mark_roster_attendance` → ok; INSERT clients → ok; 201-й клиент → `edition_cap_exceeded`; restore 201-го активного → cap.
2. Studio: `create_group_subscription` / `record_subscription_payment` ok; `expenses` INSERT / `create_rental` → forbidden.
3. Pro: как сейчас.
4. Lifetime + active=lite: finance RPC forbidden; `set_organization_active_edition('pro')` без новой заявки → ok; `license_type` остался `lifetime`.
5. **Флаг on.** Expire Pro month → time-aware: `period_end` в прошлом, `status` ещё `active` → касса forbidden, журнал ok, Mini App false, **не** suspended. После cron: `past_due` + колонка lite. Зеркало licenses `subscription` живо до конца grace. После grace: monthly `canceled`, **нет** licenses-строки без lifetime, isReadOnly false.
6. Backfill существующей licensed org → pro **и** строка `organization_edition_state`. Org без state → fail-closed lite, не exception-500.
7. Dual Activate studio vs pro_lifetime → отказ второй (`already_pro_lifetime` и/или алиас 2.11).
8. Cancel Studio, купить Studio снова → второй live-row, старый canceled (нет unique-conflict).
9. **Флаг on.** Демо 31-й день: `trial_pro` canceled, `licensed`, `data_purge_at` IS NULL.
10. **Флаг on.** `organization_allows_writes` на licensed Lite = true. **Флаг off** → false, как 2.11.
11. Dual-write: activate Studio → `organization_subscriptions.plan='studio'` и entitlement `studio_monthly`; licenses `subscription`.
12. Webhook/GCal enqueue на Lite → no-op.
13. Grace: `set_organization_active_edition('studio')` → `edition_active_above_ceiling` / запрет; Activate renew того же SKU → ok, один live-row, `change_reason=renew`.
14. PostgREST INSERT 201-го клиента на Lite → cap. 9-й pending (non-expired) invite → cap. Expired invite не занимает слот.
15. `mark_attendance` leftover на Lite → нет новых `teacher_settlement` / venue accruals.
16. Activate Studio на demo → нет live `trial_pro`, Mini App false; review-hold учитывает Studio kind.
17. `purge_single_organization` на licensed + только `free_lifetime` → forbidden (F70). `suspended` без `force_anti_abuse` → forbidden; с флагом+note → ok (F79).
18. Два сеанса INSERT клиента на границе капа → один ok, второй cap (F78).
19. `update_team_member(is_active=true)` при 8 active → cap.
20. Флаг off: тот же фикстур expire → writes как 2.11, **не** Lite journal (F91). Флаг on → Lite journal + касса forbidden.
21. Unique: live `studio_monthly` + `pro_lifetime` → violation (F94).
22. Lite: UPDATE `locations.name` ok; `mark_attendance` leftover ok (не edition_forbidden) (F98).
23. Studio: `record_subscription_payment` без venue ack при дырке правил → ok, accruals 0 (F95).
24. Studio: INSERT `personal_lessons` → 0 новых строк `calendar_sync_outbox` (F96).
25. `finish_subscription` leftover на Lite → ok; `finish_subscription_with_refund` / `replace_subscription_partner` → forbidden.
26. JWT INSERT `subscription_groups` на Lite → forbidden (F99).
27. `save_teacher_pay_rate` / `create_rental_invoice` / `accept_venue_cost_rule_version` на Studio → forbidden.
28. `preview_activate` Studio-заявки → period, не `preview_month_only`. Activate Studio → нет `access_key_id` / не lifetime (F109).
29. `dev_console_adjust_organization_subscription(..., p_extend_one_month=>true)` на Studio month → entitlement `period_end` сдвинут `add_calendar_month`, один live-row (F113).
30. Lite leftover: `apply_scheduled_subscription_member_changes` due → applied; `replace_subscription_partner` → forbidden (F112).
31. JWT `create_renter` на Lite → `edition_forbidden`; `upsert_renter` UPDATE существующего → ok (F115).
32. Studio: `close_personal_lesson_occurrence` / `close_group_lesson_occurrence` → accruals 0; `record_calendar_event_payment` → forbidden (F116).
33. Lite + leftover Mini App hold: UPDATE timezone → ошибка 2.11; после cancel hold → ok (F111).
34. Quote Studio до v3 конфига → `studio_not_configured`; `parsePurchaseQuoteSku('crm_studio_subscription')` не null после E6 (F118).
35. `activate_access_key` сгенерированного ключа → `pro_lifetime` + state pro (F119).
36. Notification outbox Studio-заявки: kind_label не «Lifetime» (F114).
37. **Флаг off:** `preview_activate` / Activate Studio → `editions_lifecycle_off`; Activate Pro month пишет entitlements, writes как 2.11 (F52).

UI (owner):

1. Регистрация → 31-й день: журнал жив, `/finance` и `/prices` upsell, данные демо на месте, покупка открывается.
2. Купить Studio (Inbox) → касса абонемента.
3. Купить Pro → финансы.
4. Режим Lite при живом Pro month: разделы скрыты, «Вернуть Pro» без оплаты; затем Cancel → потолок lite.
5. Cancel + Lite → сетка с серой арендой, журнал списывает старый абонемент, Mini App 403.
6. Вернуть Pro (lifetime) одной кнопкой.
7. Teacher на Lite: нет пунктов продажи.
8. Прямой URL закрытого раздела — не белый экран.
9. Accountant на Lite — не петля, не `/prices`, не `/renters`, не `/clients` (нет `clients.read`); upsell Pro (F123).
10. Reception на Lite — журнал, не `/subscriptions`.
11. Licensed Lite после cancel: нет серого `isReadOnly`, покупка открывается.
12. Accountant на **Studio** — не `/finance`, не hall-rent, не `/prices` как home; upsell Pro (F110/F123).
13. Смена TZ при висящей аренде Mini App — понятная ошибка + CTA снять слоты (F111).
14. Grace без isReadOnly: баннер renew виден (`CrmSubscriptionRenewalBanner` / edition banner), `ReadOnlyBanner` не показывается (F122).
15. Teacher на Lite при JSONB `finance_basic=true`: home не `/finance/payroll`; пункт «Финансы» скрыт (`canAccessFinanceNav`, F124).
16. Accountant `/settings` на Lite и Studio — не hall-rent и не Integrations как home; upsell Pro (F124). Не расширять `license.view`.

Dev Console:

1. Payment methods: сохранить v3 с пустым Studio → Pro quote жив, Studio quote fail-closed (`studio_not_configured`). Не меняет `editions_lifecycle`.
2. Inbox Activate Studio; фильтр kind **studio** отдельно от Pro month; label не «CRM monthly»; `rowKind` не lifetime; Activate на демо cancel'ит trial; ошибка lifetime с 2.11 алиасом.
3. Billing: LEFT JOIN entitlements; Lite без licenses виден; adjust edition с note; create manual = выбор SKU; строка зеркала = entitlements; галка lifecycle **не** в Payment methods.
4. Tenants: бейдж Lite; purge licensed Lite → отказ; needs-review для сомнительного suspended; Purge disabled (F73); `force_anti_abuse` только suspended.
5. Metrics: счётчики по `active_edition` **и** отдельно demo/suspended/live instruments; не только licensed vs demo (сейчас `DashboardPage` только licensed/demo).
6. Keys: generate **не** пишет entitlements; issue-на-орг и `activate_access_key` пишут `pro_lifetime` (F119).
7. Transfer: Lite без lifetime-фактора.
8. Purge licensed org только с `free_lifetime` → отказ (F70).
9. Tenants `expiring_soon` находит org с month T−7 (после F66).
10. Payment methods form: пустой Studio override **не** берёт `monthlyAmount` Pro (F90).
11. Inbox list filter `monthly` не возвращает Studio-заявки.
12. Inbox Studio: период preview + Activate как month, не генерация ключа (F93, F109).
13. Billing: нет quick-status с canned note; create manual спрашивает SKU; **нет** `provider=stripe` (F100, F121); extend month двигает entitlement (F113).
14. Metrics: карточки lite/studio/pro + suspended (F107).
15. Platform bot / outbox: заявка Studio ≠ текст Lifetime (F114).
16. Quote Edge: `crm_studio_subscription` парсится; v2 конфиг → `studio_not_configured` (F118).

---

## 10. Вне скоупа v1

- Stripe / автосписание.
- Пожизненная Studio, год, пакет «Pro на 3 месяца».
- Посадка функций: «докупить только финансы».
- Смена major `crm_product_versions` на v3.
- Миграция данных *между организациями*.
- Белые лейблы / отдельные деплои на редакцию.
- Автоудаление исторических платежей «чтобы было как Lite».
- Пересчёт цены при апгрейде mid-cycle.
- Бэкфилл payroll/venue-cost за дни Lite-режима.
- Purge заброшенных Lite по 180 дням без логина.
- Выбор «основного зала» при over-cap.
- Новые ключи JSONB-модулей под hall-rent/GCal.
- Гостевой vi-копирайт лендинга, если не успевает E10 (CRM i18n vi — да).
- Офлайн-журнал для Studio/Lite (roster-offline).
- Капы в Dev Console без миграции.
- Кредит mid-cycle Studio→Pro.
- Авто-unsuspend всех `suspended` без очереди review.

---

## 11. Открытые решения владельца

**E0 закрыт 2026-09-21.** Код E1a можно начинать. Смена решений ниже — явная правка этого файла, не молчаливый «другой дефолт в голове».

| # | Вопрос | v1-канон (если нет ответа) | Блокирует |
|---|---|---|---|
| 1 | Имена витрины | **Закрыто:** Lite / Studio / Pro латиницей | — |
| 2 | Цена Studio (USD/VND) и нужна ли пожизненная Studio позже | только month Studio; сумму задаёт Dev Console до первой продажи; lifetime Studio нет | E6 продажа (не SQL-каркас) |
| 3 | Демо 30д Pro → Lite без удаления | да, 30д | E9 |
| 4 | Капы Lite | 1 зал, 1 направление, **200** клиентов, **8** членов. (Предложение 100/5 отклонено как дефолт кода, пока владелец не сменит) | E1 константы |
| 5 | Списывать остатки абонементов на даунгрейде | **дохаживать** | E4 |
| 6 | Отмена месяца | две кнопки: режим (потолок жив) и «перейти на Lite и отменить» (сразу режет month). T−7 только предупреждает. **Grace:** auto-Lite, renew без «вернуть без оплаты» | E7 |
| 7 | Будущая аренда на Lite | карточка read-only + снять будущие слоты | E5 |
| 8 | Accountant на Lite | роль жива; landing = **upsell Pro** (нет `clients.read`, F123). То же на Studio — п.21 | E2 |
| 9 | Purge заброшенных Lite (180д) | нет в v1 | — |
| 10 | Онбординг сразу Lite без демо | демо Pro обязателен | E9/E10 |
| 11 | Офлайн на Studio | нет, только Pro (`sync_offline_mark_attendance`) | E3/E8 |
| 12 | Payout кошелька на Lite | **да** (исключение) | E3 |
| 13 | Где флаг cutover | `platform_runtime_flags` + Billing, не payment config | E1/E6 |
| 14 | Dual-write licenses после cancel | DELETE строки после cancel / **конца grace**, если нет lifetime; **во время grace** licenses не трогать (§3.1) | E1 |
| 15 | Purge `suspended` | только `force_anti_abuse` + note; licensed Lite нельзя никогда | E1/E6 |
| 16 | Time-aware хелперы | да, как 2.11 `period_end`; cron персистит. **Write-path только при флаге on** (F91) | E1 |
| 17 | Триггеры INSERT ≠ UPDATE | consume/rename не режем (F98) | E1/E3 |
| 18 | XOR raising-instrument | один live trial/month/lifetime (F94) | E1 |
| 19 | SELECT `payments` на Studio | роль жива (F97); venue-ack skip (F95) | E3 |
| 20 | Имена adjust/preview SQL | wrap `dev_console_adjust_organization_subscription`; preview/Activate `IN` двух SKU (F109/F113) | E1/E6 |
| 21 | Accountant на Studio | тот же fallback, что Lite: **upsell Pro**, не клиенты/касса (F110/F123). Teacher payroll-only / settings-index — F124 (E2, не отдельное продуктовое решение) | E2 |
| 22 | Leftover pair-cron / TZ Mini App | consume pair; TZ после снятия слотов (F112/F111) | E3/E5 |
| 23 | Grace-баннер после E2 | не внутри `ReadOnlyBanner`/`isReadOnly` (F122) | E2 |
| 24 | Activate Studio при флаге off | отказ `editions_lifecycle_off` (F52) | E1c |

### 11.1 Имена витрины

Как §2: **Lite / Studio / Pro** латиницей в UI и i18n; в коде редакции не `basic` / `free`.

**Решение E0 (2026-09-21):** оставляем v1-канон §2; владелец не возразил.

### 11.2 Цена Studio

Только месячная Studio; пожизненной Studio в v1 нет. Сумма не блокирует E1 (SQL-каркас).

**Решение E0 (2026-09-21):** цену задаёт Dev Console до первой продажи **E6**; lifetime Studio нет. Конкретные USD/VND владелец не назвал — ориентир только в DC, не в коде.

### 11.3 Демо 30 дней Pro → Lite

После демо — `licensed` + Lite, tenant-данные не удаляем (§5, E9).

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.4 Капы Lite

1 зал, 1 направление, **200** активных клиентов, **8** членов команды (pending invite не просроченные считаются в кап members). Константы в SQL (§3.5).

**Решение E0 (2026-09-21):** числа как в таблице; владелец не сменил капы (100/5 не принимаем как дефолт кода).

### 11.5 Остатки абонементов и журнал Lite

На даунгрейде **дохаживать** уже купленные абонементы (consume в журнале). Журнал на Lite — **roster** (`schedule_group_roster` / `roster_attendance`, §4.7), **не** nullable `attendance.subscription_id` и не «продайте абонемент» как единственный путь.

**Решение E0 (2026-09-21):** остатки — дохаживать; журнал Lite = roster по §4.7; дефолт спеки, владелец не возразил.

### 11.6 Режим, отмена месяца, expire → Lite

- **Режим** (`owner_mode`) ≠ **отмена месяца** (`owner_cancel`) — §3.1, §4.6.
- **Pro lifetime** не сгорает от режима Lite; ceiling жив отдельно от `active_edition`.
- Штатный **expire** месяца Studio/Pro → **Lite** (`licensed`), **не** `suspended`. Фазы grace §3.1: касса Studio/Pro закрыта с `period_end`; во grace — renew того же SKU, **без** «вернуть Studio/Pro без оплаты»; после grace — buy/renew по оплате.
- T−7 только предупреждает, ceiling не режет.

**Решение E0 (2026-09-21):** оставляем v1-канон §3.1 / §4.6 / §4.7; владелец не возразил.

### 11.7 Будущая аренда на Lite

Карточка аренды read-only; будущие слоты Mini App снимаются через occupancy (E5); смена TZ блокируется живыми слотами (§11.22).

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.8 Accountant на Lite

Роль жива; нет `clients.read` — home не клиенты и не «операционная касса» без panel. Landing = **upsell Pro** (F123).

**Решение E0 (2026-09-21):** upsell Pro, RBAC не расширять; дефолт спеки, владелец не возразил.

### 11.9 Purge заброшенных Lite (180 дней)

Автоматический purge «заброшенных» licensed Lite по таймеру — **нет в v1** (abuse → `suspended`, не silent purge).

**Решение E0 (2026-09-21):** **нет в v1**; дефолт спеки, владелец не возразил.

### 11.10 Онбординг без демо

Новый self-service org = демо Pro 30 дней, затем Lite; сразу Lite без демо — нет.

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.11 Офлайн-журнал

`sync_offline_mark_attendance` — только **Pro**; Studio/Lite — онлайн.

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.12 Payout кошелька на Lite

Исключение: payout арендаторского кошелька на Lite **разрешён** (write-path по capability, не «вся касса»).

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.13 Флаг cutover `editions_lifecycle`

`platform_runtime_flags` + переключатель в Dev Console Billing; **не** в `platform_payment_methods.config` (F46).

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.14 Dual-write `organization_licenses`

Зеркало месяца/lifetime в `organization_licenses` (§18.3). **Во время grace** (`past_due`) строку licenses **не трогать**. **DELETE** строки licenses — только после `owner_cancel` или **конца grace** без live `pro_lifetime` (F43). Lifetime-строку не удалять.

**Решение E0 (2026-09-21):** как §3.1 п.6–7 и §18.3; владелец не возразил.

### 11.15 Purge `suspended` и licensed Lite

Licensed Lite purge **запрещён** (F70). `suspended` — только `force_anti_abuse` + note, не кнопка Purge «как у Lite».

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.16 Time-aware хелперы

Как 2.11 по `period_end`; cron персистит `status` / state / события. Полный write-path редакций и Lite-writes SQL — **только при** `editions_lifecycle=on` (F91). При off — тело `organization_allows_writes` 2.11.

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.17 Триггеры INSERT ≠ UPDATE

Consume (`mark_attendance`, roster, leftover pair-cron) и rename зала — **не** `edition_forbidden` (§18.12, F98).

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.18 XOR raising-instrument

Не больше одного live среди `trial_pro` | `studio_monthly` | `pro_monthly` | `pro_lifetime` (+ всегда `free_lifetime`) (F94).

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.19 SELECT `payments` на Studio

Owner/accountant сохраняют чтение `payments` на Studio (F97); venue-ack в record_* на не-Pro — skip, оплату не блокировать (F95).

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.20 Имена SQL / Edge adjust и preview

Adjust Billing — wrap `dev_console_adjust_organization_subscription` (Edge `dev-console-adjust-subscription`), не отдельная `_edition` (F113). Preview/Activate month — `request_kind IN ('crm_subscription','crm_studio_subscription')` (F109).

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.21 Accountant на Studio

Тот же fallback, что на Lite: **upsell Pro**, не `/finance`, `/clients`, `/renters`, `/prices`. Teacher payroll-only / rental-inbox early-return и settings `hall-rent` — пересечение с edition в **E2** (F124), не отдельное продуктовое решение.

**Решение E0 (2026-09-21):** upsell Pro, RBAC не расширять; дефолт спеки, владелец не возразил.

### 11.22 Leftover pair-cron и TZ

`apply_scheduled_subscription_member_changes` на leftover Lite = **consume** (F112). Смена TZ org — после снятия будущих Mini App слотов (F111).

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.23 Grace-баннер и `isReadOnly`

После E2 баннер grace/expire-Lite **вне** `ReadOnlyBanner` / флага `isReadOnly` (F122). `isReadOnly` — dead org (demo retention, expired demo), **не** month и **не** `suspended`.

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

### 11.24 Activate Studio при `editions_lifecycle=off`

Activate `crm_studio_subscription` при флаге off → отказ `editions_lifecycle_off` (F52). Activate Pro month/lifetime при off может писать entitlements (анти-drift); write-path остаётся 2.11.

**Решение E0 (2026-09-21):** дефолт спеки, владелец не возразил.

---

## 12. Карта кода (куда смотреть при реализации)

| Тема | Где |
|---|---|
| Модули UI | `tangodb/src/lib/orgModules.ts`, `types/organization.ts` `OrgModules` |
| Nav / mobile | `lib/i18n/navHelpers.ts`, `App.tsx`, `auth/routeGuards.tsx` `PanelAccessRoute` |
| Покупка | `lib/crmLicensePurchase.ts` (`isManualPurchaseEligible`, `purchaseSkuLock` тип `"choice"\|"studio_month"\|"pro_month"`, `parsePurchasePlanParam`), `hooks/useCrmLicensePurchaseUi.ts`, `hooks/useCrmSubscriptionUi.ts` (T−7 / grace — расширить на Studio + F72), `lib/platformPaymentContract.ts`, `lib/crmSubscriptionState.ts`, `settings/pages/LicenseSettingsPage.tsx`, `components/license/SubscriptionWaitlistCard.tsx` (Stripe waitlist ≠ group waitlist) |
| Writes org | SQL `organization_allows_writes`, `organization_has_active_subscription` (уже time-aware), `organization_has_lifetime_license` |
| isReadOnly | `organization/OrganizationProvider.tsx` (~503), `components/ui/ReadOnlyBanner.tsx` (весь баннер под `isReadOnly` — F122), `components/license/CrmSubscriptionRenewalBanner.tsx` (T−7, не isReadOnly), `auth/LicenseRequiredPage.tsx`, `auth/routeGuards.tsx` |
| Mini App гейт | `renter_miniapp_addon_is_active` |
| Inbox | `activate_platform_purchase_request` (month = **равенство** `crm_subscription`, F109), `preview_activate_platform_purchase_request` (`preview_month_only`), `_preview_crm_month_activation_period`; Dev Console `/inbox` `rowKind` / `kindLabel` / `isMonthly`; Edge `dev-console-purchase-inbox` `InboxKindFilter` без `studio`; `mapRpcActivateError` |
| Billing DC | `dev-console-search-billing`; Edge `dev-console-adjust-subscription` → SQL **`dev_console_adjust_organization_subscription`** (`p_extend_one_month`) — **не** выдумывать `_edition` (F113); `BillingPage.tsx` (`createManualSubscription` всегда Pro, `adjustStatus` canned note F100, `<option stripe>` F121, колонка `plan` в row не показана) |
| Касса группы | RPC `create_group_subscription`; leftover `useSubscriptions.ts` `.insert` **удалить в E3** (F120); `subscription_groups.insert`; `replace_subscription_partner`; `apply_scheduled_subscription_member_changes` (Lite leftover = consume, F112); `finish_subscription` / `finish_subscription_with_refund` |
| Quote SKU | `parsePurchaseQuoteSku` / `PurchaseQuoteSku` (`_shared/purchaseQuotePolicy.ts`) только 2 SKU (F118); CHECK `platform_purchase_quotes.sku`; `create-purchase-quote` |
| Notifications | `20261119000001` CASE `crm_subscription` ELSE Lifetime (F114); digest `enqueue_platform_crm_subscription_digest` |
| Онбординг | `lib/onboardingStarterData.ts` INSERT locations/disciplines (F101) |
| Заметки клиента | `useClientNotes` INSERT `client_notes` (Lite да) |
| Payroll write | `save_teacher_pay_rate` / `save_teacher_pay_rule` |
| Venue / close | `accept_venue_cost_rule_version`, `save_venue_cost_rule_draft`, `confirm_venue_cost_rule_gap`, `close_group_lesson_occurrence`, `close_personal_lesson_occurrence` (accruals ⊂ Pro) |
| Аренда деньги | `create_rental_invoice`, `record_rental_payment`, `record_rental_advance` / `allocate_rental_advance`, `correct_rental_payment`, `upsert_rental_tariff`; `staff_renter_wallet_topup` / `_adjust` / `_payout`; legacy `create_renter` (F115) |
| События | `create_calendar_event_with_cancellations`, `update_calendar_event*`, `record_calendar_event_payment` ⊂ Pro |
| Finance rental UI | `useFinanceRentalScreensEnabled` (`addonActive` hour rates — F117) |
| Прайс junction | `usePrices` INSERT `price_teacher_members` / `price_disciplines` |
| Tenants DC | `dev-console-list-tenants` (`expiring_soon`, `awaiting_payment`), `dev-console-purge-org`, `OrgsPage.tsx` (`license_badge`, `canPurge` F73, `force_licensed`, `lifetime_license_verified`) |
| Metrics DC | `DashboardPage.tsx` + Edge `dev-console-metrics` — сейчас только licensed/demo |
| Mini App | `tangodb-renter/` bootstrap `0.1.26`, Edge renter RPC; §17.10; `renter_create_recurring_pack` / `renter_quote_booking` |
| Keys DC | `/keys`: `dev-console-generate-key` **и** `dev-console-issue-key` (F119); consume = `activate_access_key` |
| Залы / направления | `useLocations` INSERT/DELETE, `useDisciplines` DELETE — кап = live count, DELETE разрешён |
| TZ | триггер Mini App слотов на `organization_settings.timezone` (F111) |
| Payment config DC | `tangodb-dev-console/src/lib/paymentConfig.ts` (нет Studio override-полей — F90), Edge `dev-console-payment-methods`; канон `platformPaymentContract.ts`; Edge `_shared/paymentQuote.ts` (**нет** `tangodb/src/lib/paymentQuote.ts`) |
| Журнал | `AttendancePanel`, RPC `mark_attendance`, `lib/attendanceSubs.ts`; персоналки — `useAddPersonalLessons` **INSERT** `personal_lessons`, `mark_personal_lesson_attendance` |
| Расходы | `useExpenses` PostgREST `expenses` |
| Клиенты / команда | `useRestoreClient` UPDATE `archived_at`; `update_team_member` `p_is_active` |
| Сетка | `components/schedule/SchedulePageContainer.tsx` (`locationsModuleEnabled`, `canAddRental`), rental/personal chips |
| Settings sections | `permissions.ts` `canAccessSettingsSection` (integrations = любой role) |
| Nav fallback | `findFirstEnabledAccessiblePanelPath` (в т.ч. **early-return** `isTeacherPayrollOnly` / `isRentalInboxOnly`) + `findFirstAccessiblePanelPath` + `canAccessFinanceNav` + `findFirstAccessibleSettingsSection` + `PanelAccessRoute` — edition ∩ RBAC (§4.5, #### E2, F123, **F124**). 2.11 баг: accountant → renters/prices/hall-rent; teacher → payroll; 2.12: upsell Pro / не payroll |
| Expire | Edge `expire-crm-subscriptions`, SQL `expire_crm_organization_subscriptions`, digest `enqueue_platform_crm_subscription_digest` |
| Демо | `create-self-service-demo-org`, `purge_expired_demo_organizations`; review-hold `_organization_has_eligible_purchase_review_new` |
| Purge | `purge_single_organization`, Edge `dev-console-purge-org`, `OrgsPage.tsx` `force_licensed` |
| Инвайты | `create_organization_invite`, `accept_organization_invite`, `organization_invites` |
| Waitlist группы | `add_group_waitlist_entry`, `update_group_waitlist_status` |
| Аренда отмена | `cancel_rental`, `renter_cancel_bookings_from_date`, `renter_cancel_pack_from_date` |
| Payment contract | `platformPaymentContract.ts` (CRM + Edge), `paymentConfig.ts`, `purchaseQuotePolicy_test.ts` |
| Лендинг | `tangodb-landing/src/components/Features.tsx` / pricing i18n |
| Урок S36 | `architecture.md` Org modules |
| Quote CHECK | миграция `20261114000001_crm_monthly_subscription_s2a.sql`; хвост 2.11: `20261217000001` |

Не класть логику Supabase в компоненты. Не дублировать `permissions.ts` каталогом редакции — edition **выше** роли.

---

## 13. Риски продукта (не баги, но решения)

- Lite без кассы может быть «слишком мало» для школы — это **задумано**; апселл в журнале («чтобы списывать занятия — Studio»), не в каждом тосте.
- Pro lifetime в режиме Lite выглядит как «мы заплатили за воздух». UI: «у вас Pro пожизненно, сейчас упрощённый режим» + кнопка вернуть.
- Бесплатный вечный Lite конкурирует со Studio. Капы и отсутствие прайса — основная защита, не paywall журнала.
- Поддержка будет путать «модуль выключен» и «тариф». Один экран лицензии с крупной подписью редакции.
- Демо 30 дней с 4 залами, потом кап 1 зал — если резать сетку, школа уйдёт. Поэтому overs живы. DELETE лишнего зала на Lite не запрещаем (кап = live count).
- Dual-write два месяца будут врать, если хоть один путь (Keys **generate consume** / issue, **extend_one_month**, adjust, expire, **Inbox Activate**, **preview_activate**, **review-hold**, notification CASE) забудет entitlements.
- Бесплатный Lite навсегда: без капов на restore/параллельный INSERT поддержка получит «безлимит клиентов».

---

## 14. Что считается успехом

1. Текущие платящие клиенты ничего не заметили (все Pro).
2. Новый пользователь может жить в Lite без оплаты и без удаления базы.
3. Сценарий-якорь §0 проходит без ручного SQL.
4. Нет пути записать деньги/аренду/GCal в обход редакции.
5. Возврат на Pro показывает ту же историю платежей и тех же клиентов.
6. Dev Console показывает ту же редакцию, что CRM, после Inbox/Billing/Keys.
7. Licensed Lite нельзя удалить purge из Dev Console (F70).
8. После `period_end` касса закрыта **до** cron (при флаге on). PostgREST/JWT: teacher не INSERT `personal_lessons` / `prices` / `expenses` на Lite; RPC продаж — `edition_forbidden` (§18.9, E3). UI-гейт без SQL недостаточен (F75).
9. Teacher на Lite не home `/finance/payroll`; accountant на Lite/Studio не `/settings/hall-rent` и не `/prices` (F123/F124).

---

## 15. Документы после кода

- `architecture.md` — слой edition, expire→Lite, гейт Mini App, dual-write.
- `decision_log.md` — VER-1 строка 2.12; закрытые пункты §11.
- `changelog.md` + `APP_VERSION` 2.12.0 на первом коде (E1), далее 2.12.y.
- Этот файл: чекбоксы очереди в шапке и §16. Риски F1–F124, гейты §21, runbook §22.

Код **не** начинать до закрытого E0. Промпты §16 готовы к копированию; первый чат = **E0**.

---

## 16. Промпты агента

Готовые блоки для нового чата. Источник истины — **этот файл** (§0–§15, §17–§22, канон r7–r14, сверка с кодом **2.11.48**), не память модели и не спека 2.11 как шаблон продукта. Раздел **не меняет** продукт: только нарезка работ по §6. Если короткий блок и длинный `#### E*` расходятся — **длинный + §0–§15 / §17–§22**. Имена таблиц/RPC/Edge — из длинного блока и **§18.15**, не из памяти (не выдумывать `sell_subscription`, `dev_console_adjust_organization_edition`, `tangodb/src/lib/paymentQuote.ts`).

Карта версий: текущая CRM на момент промптов = **2.11.48**. **E0** без бампа. **E1a** (первый код) → **2.12.0**. Каждый следующий код-промпт → `2.12.y` +1 от **фактического** `APP_VERSION`. Dev Console semver — отдельно, первая поставка экранов = **E6c** (например `0.2.0`), не равнять с CRM `2.12.0`. Timestamp миграции — следующий после фактического последнего файла в `tangodb/supabase/migrations/` (хвост 2.11: `20261217000001_ux16_show_beginner_hints.sql`), не дата из промпта.

### Как запускать

1. Новый чат / новый контекст на **один** номер (E0, затем E1a, … E11).
2. Скопировать целиком короткий блок из **«Последовательность промптов»**. Длинный `#### E*` агент читает сам и выполняет буквально.
3. Шаги внутри длинного блока — **сверху вниз**. Не перескакивать. Не «доделывать» соседний E*, даже если файл тот же.
4. Не начинать промпт N, пока N−1 не закрыт (DoD в конце длинного блока). После DoD поставь `[x]` в чеклисте **шапки** и в **«Последовательность промптов»** ниже (и `- [x] DoD закрыт` у длинного блока).
5. Не объединять промпты «за один прогон, быстрее». Не писать «сделай E1–E11» / «сделай весь E1». «Этап E1/E6» — только группировка длинных блоков, не разрешение запускать E1a–E1c параллельно.
6. Если упираешься в правило из §0–§15 / §17–§22, которого нет в текущем E* — остановись и напиши, какой промпт его закрывает. Не выдумывай продукт.
7. Короткий блок — только вход в чат. Шаги, DoD и исключения — в длинном `#### E*`. Не копируй длинный блок в чат целиком.
8. Повтор чата / частичный код: если **один** артефакт шага уже есть — проверь тестом и **продолжи остальные шаги этого же E***. Стоп всего номера только если DoD закрыт или контур 2.12 уже чужой (E1a: `APP_VERSION` уже 2.12.x не из этого файла).
9. **E0 обязателен.** Нет строк `Решение E0` в §11 по обязательным пунктам длинного блока — не начинать E1a.
10. **`editions_lifecycle` на prod не включать** из промпта. Cutover — §22, руками в Billing после **E1–E9**. Промпты оставляют флаг **off**, кроме локальных SQL-тестов, которые включают его в фикстуре и **обязаны выключить** в конце теста.

### Общие правила (все промпты с кодом)

- Сначала `.cursor/docs/ai/AI_CONTEXT.md`, затем этот файл (указанные § + длинный `#### E*`) и `codegraph_explore` по символам задачи (`projectPath`: `D:\cursor_dev\TangoDB\tangodb`; для Dev Console — `tangodb-dev-console`; Mini App — `tangodb-renter`; лендинг E10 — без codegraph, читать `tangodb-landing`).
- Логика Supabase — только `tangodb/src/hooks/` и `tangodb/src/lib/` (+ Edge `_shared`). Не в компонентах. Не дублировать хуки/компоненты.
- RLS не ослаблять и не обходить. RLS менять **только** если длинный блок явно велит (новые таблицы §18.2; не трогать политики 2.11 «заодно»).
- Stripe UI не включать. Не удалять `create-subscription-checkout` / `stripe-webhook`.
- Не писать `editions_lifecycle` в `platform_payment_methods.config` (F46).
- Имена = факт 2.11.48 (§18.15). Канон продукта в шапке этого файла (п.1–14) — не нарушать.
- i18n CRM: `ru.ts` / `en.ts` / `vi.ts` / `keys.ts`. Витринные имена **Lite / Studio / Pro** латиницей, без склонения (§2). Не слово `basic` в коде редакции.
- После кода: `.cursor/docs/ai/changelog.md`. Бамп `APP_VERSION` + `tangodb/package.json` (правило версий выше). Архитектуру / VER-1 2.12 — **E10** (E1a может короткую строку VER-1 «открыт узел 2.12»).
- В конце прогона: `npx tsc --noEmit` в затронутых приложениях. Новых ошибок tsc не добавлять.
- Клиентские типы после миграции: `tangodb/src/types/database.ts` (`npm run db:gen-types` если linked; иначе точечный патч). Не `as any` на `organization_entitlements` (F59).
- Патч SQL: **ALTER / CREATE OR REPLACE текущего тела**. Не `CREATE OR REPLACE` с нуля из старой миграции.
- Карта работ по промптам (не тащить «весь §18» в текущий шаг): **E1a** — DDL+backfill+flags, не wrap writes; **E1b** — хелперы/капы/триггеры, не Activate UI; **E1c** — purchase/purge/adjust SQL + тесты, не Dev Console экраны; **E2** — SPA каталог/nav/`isReadOnly`, не RPC-гейты продаж; **E3** — write-RPC + leftover insert, не roster; **E4** — roster; **E5** — occupancy чипы; **E6a** — config v3 + quote parse; **E6b** — Inbox; **E6c** — остальные экраны DC; **E7** — `/settings/license`; **E8** — Edge/cron jobs; **E9** — demo→Lite persist; **E10** — лендинг+docs; **E11** — смоук, не новый код кроме дыр смоука.

### Ловушки нарезки (не повторять)

| Путаница | Правильно |
|---|---|
| «Сделай E1 целиком» | Один чат = один E1*. E1a не wrap'ает `organization_allows_writes` |
| Флаг on в миграции prod | Seed `{"enabled": false}`. On — только SQL-тест и §22 |
| `isReadOnly` оставить 2.11 до E7 | **E2** (F108): снять month-lock. **F122:** grace-баннер вынести из `ReadOnlyBanner`. Studio на prod не Activate до флага |
| Accountant fallback «на клиенты/кассу» | Accountant не имеет `clients.read` (F123). Upsell Pro. Reception → `/attendance`. Teacher payroll-only / settings hall-rent — **F124**. Всё — **E2** |
| Activate Studio при флаге off | Отказ `editions_lifecycle_off` (F52) — **E1c** |
| Триггер `BEFORE INSERT OR UPDATE` на всю строку | §18.12: INSERT ≠ UPDATE. Consume `mark_attendance` / rename зала — не `edition_forbidden` (F98) |
| Два аргумента `hashtextextended` в advisory lock | Один `bigint`: `hashtextextended(org::text \|\| ':edition-cap:' \|\| resource, 0)` (F92) |
| `dev_console_adjust_organization_edition` | Запрещено. Wrap `dev_console_adjust_organization_subscription` (F113) |
| preview/Activate «UI знает Studio» без SQL `IN` | Оба SQL: `IN ('crm_subscription','crm_studio_subscription')` (F109) — **E1c**, не только E6b |
| Inbox `rowKind` else → `crm_license` | Явный switch 4 kind (F76) — **E6b** |
| `isMonthly === "crm_subscription"` | Оба month kind (F93) — **E6b** |
| Фильтр `monthly` глотает Studio | `monthly` = только Pro; Studio — отдельный kind — **E6b** |
| `useSubscriptions.insert` «на всякий случай» | Удалить в **E3** (F120). Триггер — страховка, не замена |
| `apply_scheduled_subscription_member_changes` как продажа | Leftover consume на Lite, гейт `group_subscriptions` запрещён (F112) — **E3** |
| `create_renter` забыть | GRANT жив; гейт `hall_rent` (F115) — **E3** |
| `useFinanceRentalScreensEnabled` = `addonActive` | ⊂ `hall_rent` (F117) — **E2** |
| Кап только INSERT | Restore client + reactivate member + accept invite (F77/F61) — **E1b** |
| Expired invite в кап members | Не считать (F81) — **E1b** |
| Purge licensed Lite как demo | Forbidden (F70). `suspended` ≠ Lite (F79) — **E1c** + UI **E6c** |
| Notification CASE ELSE = Lifetime | Явная ветка Studio (F114) — **E1c** |
| Studio override = `monthlyAmount` Pro | Свои поля `studioMonthlyAmount` (F90) — **E6a** |
| `parsePurchaseQuoteSku` без Studio | `invalid_sku` до SQL (F118) — **E6a** |
| Keys generate пишет entitlements | Нет. Consume = `activate_access_key` (F119) — **E6c** |
| Billing canned note / `provider=stripe` | Убрать (F100/F121) — **E6c** |
| Roster = nullable `attendance.subscription_id` | Запрещено. Новые таблицы — **E4** |
| Журнал Lite в E1 | Без E4 Lite выпускать нельзя, но E1 не делает roster |
| Гейт Mini App в UI | SQL `renter_miniapp_addon_is_active` (E1b wrap, поведение 2.12 при флаге on; Edge skip — **E8**) |
| `enqueue_calendar_sync` на Studio | no-op (F96) — триггер **E1b/E3**, worker **E8** |
| Venue-ack блокирует кассу Studio | skip если `!hall_rent` (F95) — **E3** |
| Снять SELECT `payments` на Studio | Запрещено (F97) — **E3** |
| Онбординг INSERT зала на Lite | Только demo/trial (F101) — **E9** |
| Лендинг копирует `Features.tsx` Pro | Три карточки §3.2 — **E10** |
| Бамп 2.12.0 в E10 | Открывает **E1a** |
| Включить флаг «чтобы проверить E2» | Смоук флага — **E11** на staging, потом снова off |

### Последовательность промптов (для владельца)

Ставь `[x]` в чекбокс **после закрытия DoD** этого номера (и ту же галочку в шапке файла). Не отмечай заранее. Следующий номер — только когда предыдущий закрыт.

Как запускать: новый чат → скопировать **только** fenced-блок под номером → агент сам читает длинный `#### E*` в этом файле.

- [x] **E0** — закрыть блокеры §11 (только документ; код запрещён)

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md: шапка «Очередь §16», канон продукта, §3.1, §3.5, §4.6, §4.7, §11, §16 «Общие правила» / «Ловушки» и #### E0.

Задача: только E0. Выполни блок E0 буквально. Код не писать. Зафиксируй ответы владельца в §11 строками «Решение E0». Без обязательных пунктов длинного блока — стоп и перечисли, чего не хватает.

Не переходи к E1a. DoD закрыт — стоп.
```

- [x] **E1a** — SQL: таблицы + flags + backfill + **2.12.0**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §4.3, §4.12, §18.1–§18.3, §18.8, §18.10, §16 #### E1a. codegraph: create-self-service-demo-org organization_licenses organization_subscriptions.

Задача: только E1a. Предшественник E0 (строки Решение E0 в §11). Выполни блок E1a буквально. Не wrap organization_allows_writes (E1b). Не Activate/CHECK Studio SKU (E1c). Не nav (E2). Флаг editions_lifecycle seed false.

Не переходи к E1b. DoD закрыт — стоп.
```

- [x] **E1b** — SQL: хелперы time-aware, wrap writes, капы, триггеры

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md канон продукта п.1–3, §3.1, §3.5, §4.4, §18.4, §18.9, §18.11–§18.12, §21, §16 #### E1b. codegraph: organization_allows_writes renter_miniapp_addon_is_active create_organization_invite accept_organization_invite update_team_member mark_attendance.

Задача: только E1b. Предшественник E1a. Выполни блок E1b буквально. При флаге off тело writes = 2.11 (F91). Lock капа = один bigint (F92). Триггеры INSERT≠UPDATE (F98). XOR индекс one_raising уже из E1a — писатели dual-write §18.14. Не Activate SQL (E1c). Не удалять useSubscriptions.insert (E3).

Не переходи к E1c. DoD закрыт — стоп.
```

- [x] **E1c** — SQL: Activate/preview `IN`, purge, adjust, notification, тесты

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md канон продукта п.4–8 и п.13, §4.6, §9 (SQL), §18.1, §18.3, §18.5, §18.13–§18.15, §16 #### E1c. codegraph: activate_platform_purchase_request preview_activate_platform_purchase_request purge_single_organization dev_console_adjust_organization_subscription expire_crm_organization_subscriptions.

Задача: только E1c. Предшественник E1b. Выполни блок E1c буквально. preview/Activate month = IN двух SKU (F109). Не создавать …_edition (F113). Не Inbox UI (E6b). Не включать флаг на prod.

Не переходи к E2. DoD закрыт — стоп.
```

- [x] **E2** — каталог TS + nav/route + `isReadOnly` + fallback

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §4.2, §4.5, §19, F23/F56/F108/F110/F117/F122/F123/F124, §16 #### E2. codegraph: orgModules findFirstEnabledAccessiblePanelPath findFirstAccessiblePanelPath PANEL_FALLBACK_PATHS isTeacherPayrollOnly isRentalInboxOnly canAccessFinanceNav findFirstAccessibleSettingsSection PanelAccessRoute OrganizationProvider isReadOnly ReadOnlyBanner canReadScopedCrm canAccessSettingsSection useFinanceRentalScreensEnabled.

Задача: только E2. Предшественник E1c. Выполни блок E2 буквально. Новые файлы orgEdition.ts + useOrgEdition. isReadOnly = dead org, не month (F108). Grace-баннер вне ReadOnlyBanner (F122). Accountant/reception fallback на Lite И Studio: accountant = upsell Pro, не /clients (F123). Early-return payroll/rental-inbox ∩ edition (F124). Не гейтить RPC продаж (E3). Не roster (E4). Не витрина трёх карточек (E7).

Не переходи к E3. DoD закрыт — стоп.
```

- [x] **E3** — гейт write-RPC + leftover insert + pair-cron + `create_renter`

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §18.4, §18.9, §18.12, F95/F96/F97/F112/F115/F116/F120, §16 #### E3. codegraph: create_group_subscription useSubscriptions useAddPersonalLessons usePrices useExpenses create_renter upsert_renter record_subscription_payment enqueue_calendar_sync apply_scheduled_subscription_member_changes.

Задача: только E3. Предшественник E2. Выполни блок E3 буквально. Матрица §18.9 — факт имён 2.11.48. Удалить leftover .insert (F120). pair-cron = consume (F112). SELECT payments на Studio не снимать (F97). Не roster UI (E4).

Не переходи к E4. DoD закрыт — стоп.
```

- [x] **E4** — журнал Lite: roster + RPC + UI

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §4.7, F1/F42/F45, §16 #### E4. codegraph: AttendancePanel mark_attendance attendanceSubs teacher_can_mark_group_attendance.

Задача: только E4. Предшественник E3. Выполни блок E4 буквально. Новые таблицы, не nullable attendance.subscription_id. Payroll с roster = 0. Не occupancy чипы аренды (E5).

Не переходи к E5. DoD закрыт — стоп.
```

- [x] **E5** — occupancy: серые чипы + запрет create + TZ

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §4.8, F3/F111, §16 #### E5. codegraph: SchedulePageContainer canAddRental cancel_rental delete_personal_lesson organization_settings timezone.

Задача: только E5. Предшественник E4. Выполни блок E5 буквально. Сетка не падает при rental на Lite. Не ломать триггер TZ Mini App — CTA снять слоты (F111). Не джобы worker (E8).

Не переходи к E6a. DoD закрыт — стоп.
```

- [x] **E6a** — payment config v3 + quote SKU Studio

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §17.1, §20, F14/F69/F90/F118, §16 #### E6a. codegraph: platformPaymentContract parsePurchaseQuoteSku formStateToConfig configToFormState create-purchase-quote (CRM + tangodb-dev-console; в CRM нет src/lib/paymentQuote.ts).

Задача: только E6a. Предшественник E5. Выполни блок E6a буквально. schemaVersion 3 + обратное чтение v2. Studio override ≠ monthlyAmount Pro. Не Inbox UI (E6b). Не галка lifecycle в Payment methods (F46).

Не переходи к E6b. DoD закрыт — стоп.
```

- [x] **E6b** — Inbox: rowKind / isMonthly / Activate Studio

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §17.2, §17.13, F76/F83/F93/F103/F109, §16 #### E6b. codegraph: PurchaseInboxPage rowKind isMonthly kindToRequestKind InboxKindFilter mapRpcActivateError preview_activate_platform_purchase_request.

Задача: только E6b. Предшественник E6a. Выполни блок E6b буквально. SQL IN уже из E1c — не откатывать. monthly фильтр не глотает Studio. Не Billing/Tenants (E6c).

Не переходи к E6c. DoD закрыт — стоп.
```

- [x] **E6c** — Billing / flag UI / Tenants / Metrics / Keys / bot / renter

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §17.3–§17.14, F70/F73/F74/F79/F82/F100/F107/F113/F114/F119/F121, §16 #### E6c. codegraph: BillingPage OrgsPage canPurge DashboardPage activate_access_key renter_miniapp_addon_is_active fetchBootstrap.

Задача: только E6c. Предшественник E6b. Выполни блок E6c буквально. Adjust = то же SQL-имя. generate-key не пишет entitlements. Не витрина CRM лицензии (E7). Не включать флаг на prod.

Не переходи к E7. DoD закрыт — стоп.
```

- [x] **E7** — UI лицензии: три карточки, режим vs cancel

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §2, §3.1, §4.5–§4.6, §5, F6/F7/F31/F44/F72, §16 #### E7. codegraph: LicenseSettingsPage ManualPurchasePanel useCrmLicensePurchaseUi purchaseSkuLock parsePurchasePlanParam set_organization_active_edition.

Задача: только E7. Предшественник E6c. Выполни блок E7 буквально. Режим ≠ отмена месяца. Lite licensed может открыть покупку. Не Activate Studio на prod (флаг off). Не джобы (E8).

Не переходи к E8. DoD закрыт — стоп.
```

- [x] **E8** — джобы: expire persist, Mini App, GCal, webhook

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §4.9, §18.6, F4/F16/F21/F36/F51/F52/F91/F96/F105, §16 #### E8. codegraph: expire_crm_organization_subscriptions renter-booking-worker calendar-sync-worker google-calendar-webhook enqueue_calendar_sync.

Задача: только E8. Предшественник E7. Выполни блок E8 буквально. При флаге off persist-cron = 2.11. Не demo→Lite convert (E9), кроме того что expire уже умеет ветку флага.

Не переходи к E9. DoD закрыт — стоп.
```

- [x] **E9** — демо lifecycle: trial_end → Lite

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §3.3, §4.10, F26/F47/F80/F101, §16 #### E9. codegraph: purge_expired_demo_organizations create-self-service-demo-org onboardingStarterData _organization_has_eligible_purchase_review_new.

Задача: только E9. Предшественник E8. Выполни блок E9 буквально. При флаге on: 31-й день = licensed Lite, data_purge_at NULL. При off — старый purge демо. Не лендинг (E10).

Не переходи к E10. DoD закрыт — стоп.
```

- [x] **E10** — лендинг + i18n + docs

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §2, §3.2, §4.11, §15, §16 #### E10. Файлы: tangodb-landing, architecture.md, decision_log.md.

Задача: только E10. Предшественник E9. Выполни блок E10 буквально. Три карточки Lite/Studio/Pro. Не выдумывай E12. Не включать флаг.

Не переходи к E11. DoD закрыт — стоп.
```

- [x] **E11** — смоук якоря + роли

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_product_editions.md §0, §5.3, §9 (UI + Dev Console), §14, §22, §16 #### E11.

Задача: только E11. Предшественник E10. Выполни блок E11 буквально. Смоук, не новая фича. Флаг on только на staging/копии, в конце теста снова off. Дыру чини в том слое, где она живёт; не открывай соседний контур «заодно».

DoD закрыт — стоп.
```

---

### Этап 0

#### E0 — закрыть продуктовые блокеры §11

- [x] DoD закрыт

```
Задача: E0. Только документ. Код, миграции, бамп версии — запрещены.

Предшественник: нет. Если в §11 уже есть строки «Решение E0» — проверь полноту, не дублируй, допиши только пробелы.

Прочитай: канон продукта в шапке, §3.1 (фазы grace), §3.5 (капы), §4.6, §4.7, §11.

Делай строго по шагам:

1. Получи от владельца явные ответы (или письменное «оставляем v1-канон») на:
   - имена Lite/Studio/Pro (§11.1 — уже закрыто в §2; подтвердить);
   - expire месяца → Lite, не suspended; фазы grace §3.1 (не касса, не «вернуть без оплаты»);
   - журнал Lite = roster, не nullable attendance;
   - Pro lifetime не сгорает от режима;
   - режим (owner_mode) ≠ отмена месяца (owner_cancel);
   - dual-write: после cancel / конца grace без lifetime — DELETE строки organization_licenses (F43); **во время grace licenses не трогать**;
   - капы 1 зал / 1 направление / 200 клиентов / 8 членов (§11.4), если владелец не сменил числа;
   - accountant Lite/Studio = upsell Pro, не расширять RBAC (§11.21/F123);
   - Activate Studio при флаге off запрещён (§11.24/F52);
   - grace-баннер не внутри isReadOnly (§11.23/F122).
2. По цене Studio (§11.2): сумма не блокер E1. Зафиксируй: «цену задаёт Dev Console до первой продажи E6; lifetime Studio нет». Если владелец назвал числа — впиши их как ориентир, не в код.
3. По остальным строкам §11 (3, 5–24, **включая п.9 «нет в v1»**): если владелец молчит — запиши «дефолт спеки, владелец не возразил»; если возразил — поправь согласованно тело спеки (не молчаливый другой дефолт в одном абзаце).
4. Впиши под каждым пунктом §11 строку `Решение E0 (YYYY-MM-DD): …`.
5. Шапка: статус «E0 закрыт, можно E1a». Чеклист шапки и §16 «Последовательность промптов»: [x] E0. Ревизию r* не поднимай без смены продукта.
6. Не менять код. Не бампить версию. Не включать Stripe. Не продавать Studio.

DoD:
- §11 содержит явные Решение E0 по п. 1, **3–24** и по деньгам п. 2 (хотя бы «цена в DC до E6»). П.9 = подтверждение «нет в v1».
- Нет противоречия между §3.1 / §4.6 / §4.7 и этими ответами.
- Код не тронут.

Стоп. Не переходи к E1a.
```

---

### Этап 1

#### E1a — SQL: entitlements, state, events, flags, backfill, 2.12.0

- [x] DoD закрыт

```
Задача: E1a. DDL источника истины редакции + backfill каждой non-purged org + platform_runtime_flags seed false + 2.12.0. Write-path 2.11 не трогать.

Предшественник: E0 закрыт в §11. Если APP_VERSION уже 2.12.x чужой (нет organization_entitlements) — стоп и скажи, что в коде. Если частичный E1a — доделай шаги.

Прочитай: §4.3, §4.12, §18.1 (только то, что не Activate), §18.2, §18.3 (таблица dual-write — хелпер можно заготовить, вызывать ещё не из Activate), §18.8 п.1–4, §18.10, backfill-таблица в §4.3, F24/F53/F59/F64/F91.

Делай строго по шагам:

1. Миграция после 20261217000001 (префикс ≥ 20261218). Таблицы:
   - organization_entitlements по §4.3 (CHECK instrument↔edition, past_due только monthly, lifetime без period_end).
   - UNIQUE live_instrument, one_paid_month, **one_raising** (F94: trial|studio_monthly|pro_monthly|pro_lifetime — не больше одного live; free_lifetime в индекс не входит).
   - индекс expire по monthly period_end.
   - organization_edition_state (PK org, change_reason CHECK включая trial_start/trial_end/expire_grace/owner_mode/owner_cancel/admin_adjust/purchase/renew/expire).
   - organization_edition_events append-only + индекс (org, created_at DESC).
   - platform_runtime_flags по §18.10. Seed key=editions_lifecycle value={"enabled": false}. RLS ENABLE, политик authenticated нет. GRANT только service_role.
2. RLS новых tenant-таблиц — §18.2. authenticated SELECT entitlements/state членам org; INSERT/UPDATE/DELETE authenticated нет. events — не светить учителю сырым SELECT (чтение через RPC в E1b).
3. Backfill **каждой** non-purged org в одной TX на org (§4.3 таблица). Нет строки state = дыра (fail-closed lite в E1b, не 500). suspended: эвристика F64, не авто-unsuspend антифрод. demo_retention → licensed Lite, purge NULL. licensed без license/month → free_lifetime + lite. Grandfather lifetime/month → pro + free_lifetime. organization_subscriptions.plan: standard читать как pro; не добавлять CHECK plan, пока backfill не прогнан.
4. create-self-service-demo-org: в той же TX, что INSERT org — trial_pro + free_lifetime + edition_state pro / trial_start. Не включать Mini App. Не менять 30 дней демо.
5. Хелпер-заготовка dual-write зеркал можно положить в SQL, но **не** патчить organization_allows_writes, purge, Activate, expire в этом промпте.
6. npm run db:gen-types (или точечный патч database.ts). Не as any.
7. Бамп APP_VERSION + tangodb/package.json → 2.12.0. decision_log: короткая строка VER-1 «узел 2.12 открыт E1a». changelog.md.

DoD:
- Каждая non-purged org имеет entitlements + edition_state.
- Флаг off. Платящие write-path = 2.11 (этот промпт их не менял).
- one_raising существует: studio_monthly + pro_lifetime → unique violation (можно SQL-тест фикстурой).
- 2.12.0 в обоих файлах версии.
- tsc чистый.

Стоп. Не переходи к E1b.
```

#### E1b — SQL: time-aware хелперы, wrap writes, капы, триггеры INSERT≠UPDATE

- [x] DoD закрыт

```
Задача: E1b. Функции редакции time-aware; organization_allows_writes / renter_miniapp / edition_allows / капы / триггеры таблиц — все с early-return при флаге off (F91). RPC get/set/cancel edition.

Предшественник: E1a (таблицы+backfill).

Прочитай: канон продукта п.1–3, §3.1 time-aware, §3.5, §4.4, §18.4 (RPC get/set/cancel/invite), §18.9 (триггеры + wrap), §18.11, §18.12, §21, F43/F71/F75/F77/F78/F81/F91/F92/F98/F106.

Делай строго по шагам:

1. editions_lifecycle_enabled() → COALESCE((value->>'enabled')::boolean, false).
2. organization_entitlement_phase / effective_ceiling / active_edition / edition_allows — §3.1 и §4.4. SPA/RPC читают **функцию**, не сырую колонку state. edition_allows(multi_location|multi_discipline) согласован с капом: первый ресурс Lite ок, второй — cap (F71).
3. organization_allows_writes: при флаге **off** — тело 2.11 без изменений. При **on** — §4.4 (licensed + live free_lifetime; past_due месяца не закрывает org-writes; NOT schema_version_locked первым — F106). JWT-ветка auth_organization_id() остаётся.
4. renter_miniapp_addon_is_active: при off — тело 2.11. При on — licensed ∧ active_edition=pro ∧ ¬ live trial_pro (§4.4). Не открывать Mini App на Studio month зеркале (F52).
5. organization_within_edition_cap: advisory lock **один bigint** F92; формулы §3.5; expired invite не в кап (F81); early-return true если флаг off.
6. Триггеры §18.12 + §18.9. Каждый: IF NOT editions_lifecycle_enabled() THEN RETURN NEW. Запрещён слепой INSERT OR UPDATE на всю строку (F98). Обязательно: personal_lessons INSERT; prices + junctions; expenses; subscriptions INSERT не UPDATE lessons_left; subscription_groups INSERT; clients INSERT + restore archived_at NULL; locations/disciplines INSERT only; members INSERT + is_active false→true. client_notes не гейтить редакцией.
7. create_organization_invite + accept_organization_invite + update_team_member(p_is_active=true) — кап members до INSERT/UPDATE (F61/F77).
8. RPC (GRANT authenticated): get_organization_edition (time-aware ceiling/active/phase/caps usage/live instruments; **не** отдавать editions_lifecycle и полный events учителю), set_organization_active_edition (owner/director; не поднимать по одному past_due), cancel_organization_monthly_entitlement (режет month, dual-write DELETE licenses если нет lifetime — F43). Dual-write протокол §18.14 (lock org FOR UPDATE, XOR cancel other raising, free_lifetime не трогать).
9. SQL-тесты этого слоя (флаг on в фикстуре, в конце off): grace без cron (period_end в прошлом, status ещё active → active_edition lite, касса edition_allows finance/group_subscriptions false, журнал attendance true); флаг off тот же фикстур = 2.11; первый зал Lite ok, второй cap; restore 201-го клиента cap; dual-session insert на границе капа; UPDATE locations.name на Lite ok; mark_attendance leftover не edition_forbidden; schema_version_locked → writes false.

DoD:
- Флаг off: поведение writes/кап/триггеров = 2.11.
- Флаг on: time-aware касса закрыта до cron; Lite writes журнала открыты; капы ловят INSERT и restore.
- get_organization_edition не 500 на org без строки state (fail-closed lite) и не отдаёт сырую колонку выше time-aware clamp.
- tsc + gen-types если сигнатуры новых RPC.

Стоп. Не переходи к E1c.
```

#### E1c — SQL: purchase IN, purge, adjust wrap, notification CASE, тесты E1

- [x] DoD закрыт

```
Задача: E1c. Закрыть SQL-контур денег и purge так, чтобы E6 UI не врал. Dev Console экраны не делать.

Предшественник: E1b.

Прочитай: канон продукта п.4–8 и п.13, §4.6, §9 SQL п.1–37 (только SQL, не UI), §18.1 (CHECK sku/kind, review-hold, preview/Activate, adjust, notification, purge), §18.3, §18.5, §18.13–§18.15, F7/F32/F47/F52/F70/F79/F80/F83/F104/F105/F109/F113/F114/F118.

Делай строго по шагам:

1. CHECK platform_purchase_quotes.sku и platform_purchase_requests.request_kind + crm_studio_subscription. _organization_has_eligible_purchase_review_new включает Studio (F80).
2. preview_activate_platform_purchase_request и activate_platform_purchase_request: month-ветка IN ('crm_subscription','crm_studio_subscription') (F109). Иначе Studio = preview_month_only или lifetime-ключ. _preview_crm_month_activation_period читает live month из entitlements. Activate пишет entitlements + dual-write §18.3 в одной TX; XOR raising; на демо cancel trial_pro (F47); renew past_due того же SKU = один live-row, change_reason=renew; already_pro_lifetime + алиасы 2.11 (F83). Повтор activated = 200 без сдвига. **Флаг off:** preview/Activate crm_studio_subscription → editions_lifecycle_off (F52). Activate Pro month/lifetime при off всё равно пишет entitlements (анти-drift).
3. Wrap dev_console_adjust_organization_subscription (то же имя, F113): entitlements + dual-write + XOR. p_extend_one_month сдвигает period_end live month через add_calendar_month и зеркало current_period_end; без SKU picker не превращать Studio в Pro.
4. expire_crm_organization_subscriptions: при флаге off — тело 2.11 (зеркало Pro → past_due/suspended). При on — Studio+Pro entitlements, persist past_due + clamp lite expire_grace, после grace canceled + DELETE licenses если нет lifetime, org licensed не suspended (F16/F105). Cron персистит, не является единственным гейтом кассы.
5. purge_single_organization: сигнатура + p_force_anti_abuse (F104). licensed или live free_lifetime → licensed_org_purge_forbidden, force_licensed игнорируется (F70). suspended только force_anti_abuse + note≥8 (F79).
6. Notification SQL CASE: явная ветка crm_studio_subscription, не ELSE Lifetime (F114). Digest source: studio_monthly и pro_monthly.
7. activate_access_key: пишет pro_lifetime + state pro + free_lifetime если нет (F55/F119) — SQL в этом промпте, UI Keys в E6c.
8. SQL-тесты §9 п.1–37, которые не требуют SPA/DC UI. Обязательны: preview Studio ≠ preview_month_only; Activate Studio ≠ ключ; **флаг off Activate Studio = editions_lifecycle_off**; extend_one_month; licensed Lite purge forbidden; force_anti_abuse; повторная покупка Studio после cancel (F32); dual Activate studio vs lifetime отказ.

DoD:
- DoD этапа E1 из §6 закрыт на SQL (три редакции × RPC/JWT; grandfather; cancel licenses DELETE; cap; grace time-aware on/off; purge; XOR; INSERT≠UPDATE; preview/Activate IN; extend).
- Inbox/Billing UI ещё 2.11 — это E6. На prod Studio не Activate (SQL `editions_lifecycle_off` при флаге off).
- tsc чистый. changelog + микропатч 2.12.y.

Стоп. Не переходи к E2.
```

---

### Этап 2

#### E2 — каталог capabilities, nav, isReadOnly, fallback ролей

- [x] DoD закрыт

```
Задача: E2. Клиентский слой редакции. Write-RPC продаж не гейтить (E3). Витрину трёх карточек не делать (E7).

Предшественник: E1c.

Прочитай: §4.2, §4.5, §19, F8/F9/F10/F23/F25/F34/F40/F56/F108/F110/F117/F122/F123/F124.

Делай строго по шагам:

1. tangodb/src/lib/orgEdition.ts: типы edition/capability/rank, editionAllows(), merge catalog ∩ normalizeOrgModules. Не дублировать permissions.ts. WRITE_ACTIONS не подменяют edition. license.purchase / license.activate вне write-lock.
2. Хук useOrgEdition() рядом с useOrgModules: данные с RPC get_organization_edition, не из organization_licenses.
3. Nav / PanelAccessRoute / canAccessPanel: пункт виден если editionAllows ∩ module ∩ canAccessPanel. Закрытый прямой URL → экран «доступно в Studio/Pro» + CTA, не 500 и не голый /.
   - /prices гейт prices (сегодня всегда в меню).
   - /prices?section=hall-rent ещё hall_rent (Studio: вкладка скрыта).
   - /renters: снять moduleKey locations, гейт hall_rent.
   - тулбар «Аренда»: hall_rent, не modules.locations.
   - /settings/integrations: не любой role; create/connect ⊂ google_calendar / Pro.
   - /settings/hall-rent, /settings/subscriptions, /settings/data — §19.
4. isReadOnly в OrganizationProvider: `demo_retention`, просроченное `demo_active`, `purged` (если UI). **Не** `isCrmSubscriptionWriteClosed`. **Не** `suspended` (recovery — `OrgAccessRoute` → `/license-required`, как 2.11). Licensed Lite / grace / owner_mode Lite → не read-only (F108). `LicenseRequiredPage` — `suspended` и legacy retention.
   ReadOnlyBanner: demo retention / expired demo only. Grace/expire-Lite баннер вынести в слой CrmSubscriptionRenewalBanner (или рядом): виден при phase past_due/canceled month, **не** требует isReadOnly (F122). purchasePath по живому instrument (F72). useCrmSubscriptionUi.graceDaysLeft — от phase, не только от writeClosed.
5. Fallback accountant и reception на Lite **и Studio** (F110/F123/**F124**): общий хелпер — пересечь `PANEL_FALLBACK_PATHS` с `editionAllows` в **`findFirstEnabledAccessiblePanelPath`** и **`findFirstAccessiblePanelPath`**; **те же гейты на early-return** `isTeacherPayrollOnly` → `/finance/payroll` ⊂ `payroll` и `isRentalInboxOnly` → `/finance/rental-inbox` ⊂ `hall_rent`; `canAccessFinanceNav` ⊂ edition. `PanelAccessRoute` — edition-aware redirect/upsell, не голый `/`. Accountant не имеет clients.read — не слать на /clients, /renters, /prices, /finance, /settings/hall-rent. Пустой intersection → экран upsell Pro, роль жива (не 500, не петля). Reception → /attendance. `findFirstAccessibleSettingsSection` ∩ edition (hall-rent/data/integrations); accountant без секции → upsell Pro, **не** расширять `license.view` (F40). `rbac-regression-check.mjs` (NAV-1) проверяет **чистый RBAC** без edition — не ломать assert'ы внутри `can()`; edition-fallback accountant/teacher Lite/Studio — отдельный тест/смоук (E11), не подмена NAV-1.
6. useFinanceRentalScreensEnabled ⊂ hall_rent ∧ Pro, не addonActive hour-rates (F117). HallRentalDashboardBlock ⊂ hall_rent. useFinance* на Lite не звать (F9).
7. PurchaseSkuLock расширить: "choice"|"studio_month"|"pro_month" (§4.5 таблица). "monthly" только как синоним тестов 2.11, в UI не оставлять. parsePurchasePlanParam + ?plan=studio. ?plan=monthly не переназначать. CTA покупки на licensed Lite жив (F31) — панель SKU можно ещё не рисовать как три карточки (E7), но скрывать покупку из-за «нет demo/month/lifetime» запрещено.
8. Сохранение organization_settings.modules не персистит ключи вне каталога (F8); JSONB при даунгрейде не затирать.
9. i18n ключи бейджа/upsell §2. FirstDayChecklist «продайте абонемент» скрыть если !group_subscriptions.

DoD:
- Прямой /finance на Lite и Studio → upsell, не петля, не 500.
- Accountant Lite и Studio не падает на /finance, /renters, /prices, /clients, /settings/hall-rent — upsell Pro (F123/F124).
- Teacher Lite при finance_basic JSONB true не на /finance/payroll; пункт Финансы скрыт (F124).
- /prices и /renters закрыты на Lite.
- isReadOnly не серит всю CRM на live Studio/Pro month.
- Grace CTA виден без isReadOnly (F122).
- tsc чистый. 2.12.y.

Стоп. Не переходи к E3.
```

---

### Этап 3

#### E3 — гейт write-path: RPC, leftover insert, pair-cron, create_renter

- [x] DoD закрыт

```
Задача: E3. Каждый write-path §18.9 проверяет edition_allows (RPC и/или уже созданные триггеры E1b). Имена только из §18.9 / §18.15.

Предшественник: E2.

Прочитай: §3.2 (касса Studio vs Pro, payroll skip, venue-ack, GCal enqueue, карточка арендатора), §18.4 «не гейтить», §18.9, §18.12, F2/F30/F45/F95/F96/F97/F99/F112/F115/F116/F120.

Делай строго по шагам:

1. Пройди матрицу §18.9 строка за строкой. В начале каждого listed RPC — edition_allows. Не выдумывать sell_subscription / add_personal_lessons / record_expense.
2. Удалить leftover PostgREST insert из useSubscriptions.ts (F120). Продажа группы = create_group_subscription. Триггер INSERT subscriptions/subscription_groups — страховка.
3. apply_scheduled_subscription_member_changes leftover на Lite = consume, не гейтить group_subscriptions (F112). replace_subscription_partner / finish_subscription_with_refund / create_subscription_refund — Studio+. finish_subscription без refund на leftover Lite — да.
4. mark_attendance / mark_personal_lesson_attendance / close_*_occurrence: skip **независимо** — `!payroll` → нет payroll accrual; `!hall_rent` → нет venue-cost (F45). Не edition_forbidden на leftover consume.
5. record_subscription_payment / record_personal_lesson_payment / record_single_visit: при !hall_rent venue-ack не обязателен, accruals не писать (F95).
6. enqueue_calendar_sync: no-op если !google_calendar (F96). Не drain-delete Google.
7. SELECT payments / can_read_financial на Studio не снимать (F97). Режем write expenses, payroll, venue, rental, UI /finance.
8. create_renter + upsert_renter create = hall_rent. upsert_renter UPDATE существующего + staff_renter_wallet_payout — да на Lite/Studio (F115). Contacts/contracts/QR/bot/invoices/advance/topup — Pro.
9. freeze RPC / waitlist группы — group_subscriptions (Studio+).
10. Export operational Studio+; financial Pro. offline_attendance только Pro; на даунгрейде очередь IndexedDB не применять (F18) — skip sync, не молчаливый mark.
11. pair_subscriptions / trio_lessons не capabilities (F30).

DoD:
- Teacher JWT на Lite: create_group_subscription / INSERT personal_lessons / prices / expenses / subscription_groups / create_renter → edition_forbidden.
- Studio: продажа абонемента/персоналки ok; expenses / create_rental / save_teacher_pay_rate forbidden; INSERT personal_lessons не плодит calendar_sync_outbox.
- Lite leftover mark_attendance ok, payroll 0.
- tsc чистый. 2.12.y.

Стоп. Не переходи к E4.
```

---

### Этап 4

#### E4 — журнал Lite: schedule_group_roster + roster_attendance

- [x] DoD закрыт

```
Задача: E4. Продуктовый узел журнала без абонемента. Старый mark_attendance не ломать.

Предшественник: E3. Без этого этапа Lite выпускать нельзя (F1).

Прочитай: §4.7, F1/F17/F42/F45.

Делай строго по шагам:

1. DDL schedule_group_roster и roster_attendance (§4.7). Не nullable attendance.subscription_id. RLS как attendance / teacher_has_schedule_group_access. GRANT authenticated нет на INSERT — только RPC.
2. RPC: add_group_roster_client, remove_group_roster_client, mark_roster_attendance (идемпотентность как mark). Teacher-scope = teacher_can_mark_group_attendance. Не вызывать payroll / venue-cost / freeze. add: только clients.archived_at IS NULL своей org; кап клиентов на INSERT клиента, не на roster. UNIQUE (org, group, client). remove не CASCADE roster_attendance.
3. UI AttendancePanel: Lite без абонементов = roster + «добавить ученика на занятие», не «продайте абонемент». Studio/Pro = абонементы ∪ roster ∪ разовые. Даунгрейд: живой абонемент → только mark_attendance, не фейковый subscription (F42). Тот же клиент в roster и в абонементе — один раз.
4. Freeze UI на Lite скрыт даже у leftover пакета.
5. SQL-тест: Lite отметить клиента на слот; Studio старый путь жив; оба вида строк на одном уроке после даунгрейда; payroll с roster = 0.

DoD:
- На Lite журнал не пустой: можно добавить ученика на занятие и отметить.
- Leftover абонемент списывается старым mark_attendance.
- Нет фейкового subscription_id.
- tsc + gen-types. 2.12.y.

Стоп. Не переходи к E5.
```

---

### Этап 5

#### E5 — occupancy после даунгрейда

- [x] DoD закрыт

```
Задача: E5. Сетка не падает, если на Lite осталась аренда/персоналка/событие. Create скрыт capability.

Предшественник: E4.

Прочитай: §4.8, F3/F111.

Делай строго по шагам:

1. SchedulePageContainer: единая occupancy. Чипы аренды/персоналки/мероприятия/отпуска на Lite/Studio (где create закрыт) — серые read-only + «доступно в Pro/Studio». Клик → карточка просмотра без Оплатить / удалить прошедшее.
2. Исключения, чтобы зал не был вечно занят: отмена **будущей** аренды (cancel_rental / series / renter_cancel_bookings_from_date / renter_cancel_pack_from_date); удаление **будущей** персоналки; отмена **будущего** мероприятия. Прошедшие и деньги не трогать.
3. «+ Аренда / Мероприятие / Персональный» скрыты по hall_rent / calendar_events / personal_lessons. Не modules.locations.
4. Freebusy Google в формах не звать на не-Pro (F62).
5. Смена TZ организации: триггер Mini App слотов не ослаблять. Если живы awaiting_payment/active/prepaid_charged — понятная ошибка + CTA снять будущие слоты, потом TZ (F111). Occupancy «снять будущие» — тот же путь, что п.2.

DoD:
- Сетка Lite с leftover rental не падает и не показывает «создать аренду».
- Будущий слот можно снять; прошедший нельзя вычистить ради чистоты меню.
- TZ при живом Mini App hold — ошибка 2.11, не silent success.
- tsc. 2.12.y.

Стоп. Не переходи к E6a.
```

---

### Этап 6

#### E6a — payment config v3 + quote SKU Studio

- [x] DoD закрыт

```
Задача: E6a. Цены Studio в контракте и форме Payment methods. Quote parse знает третий SKU. Inbox/Billing экраны не делать.

Предшественник: E5. SQL CHECK sku уже из E1c.

Прочитай: §17.1, §20, F14/F38/F46/F67/F69/F90/F118.

Делай строго по шагам:

1. platformPaymentContract.ts (CRM + Edge _shared, один канон): schemaVersion 3, crmStudioMonthly {amount, currency}. parse v2 без Studio-цены валиден. resolveSkuPrice('crm_studio_subscription') на v2 = fail-closed studio_not_configured, не цена Pro, не invalid_sku.
2. Per-method override studioMonthlyAmount / studioMonthlyCurrency на каждом способе (как monthlyAmount). Нет поля → канон crmStudioMonthly, **не** monthlyAmount этого способа (F14/F69/F90).
3. Dev Console PaymentMethodsPage + formStateToConfig / configToFormState + Edge dev-console-payment-methods: секция «Studio / месяц»; hint QR общие на три SKU; пустой Studio при save — предупреждение, не блокер Pro-цен. **Не** писать editions_lifecycle в этот JSON.
4. parsePurchaseQuoteSku / PurchaseQuoteSku / PlatformPaymentSku + Studio (F118). Edge create-purchase-quote: allowlist; нет канона Studio → studio_not_configured; lifetime-орг + любой month → already_pro_lifetime.
5. Тесты platformPaymentContract.test.ts и Edge purchaseQuotePolicy_test.ts: v3 round-trip, v2 backward, override VND vs Pro monthly, битый SKU.
6. renterMiniappAddon поле формы оставить, в v1 не продаём.

DoD:
- Save v3 из DC читается CRM. Pro quote на v2 жив. Studio quote на v2/пустом каноне = studio_not_configured.
- Флаг lifecycle формой цен не меняется.
- tsc в tangodb и tangodb-dev-console. 2.12.y CRM.

Стоп. Не переходи к E6b.
```

#### E6b — Inbox: rowKind, isMonthly, Activate Studio

- [x] DoD закрыт

```
Задача: E6b. Dev Console /inbox не мапит Studio в lifetime и не прячет month-preview.

Предшественник: E6a. SQL preview/Activate IN уже E1c — только проверить, не откатывать, допатчить если дыра.

Прочитай: §17.2, §17.13 таблица Inbox, F76/F80/F83/F93/F103/F109.

Делай строго по шагам:

1. PurchaseInboxPage.rowKind: явный switch crm_license | crm_subscription | crm_studio_subscription | renter_miniapp_addon; else не Activate, unknown_request_kind (F76).
2. isMonthly / preview loop / override period = оба month kind (F93). Не тащить Studio в lifetime-ветку ключа.
3. Edge InboxKindFilter + "studio"; kindToRequestKind("studio") → crm_studio_subscription; "monthly" по-прежнему только crm_subscription.
4. kindLabel: «Studio / месяц», «Pro / месяц», «Pro / пожизненно».
5. mapRpcActivateError: already_pro_lifetime и алиасы 2.11; studio_not_configured; ceiling_blocks_sku; preview_month_only; unknown_request_kind.
6. Activate на demo_active — тот же RPC (trial cancel в SQL E1c).
7. В строке заявки: ceiling / active org (list JOIN entitlements).
8. Addon pause/resume не документировать как гейт Mini App.
9. Support-вкладка без изменений.

DoD:
- Фикстура Studio-заявки: rowKind не license; preview период, не preview_month_only; Activate без access_key; фильтр monthly не возвращает Studio.
- tsc консоли. 2.12.y CRM если трогал shared типы.

Стоп. Не переходи к E6c.
```

#### E6c — Billing, lifecycle flag, Tenants, Metrics, Keys, bot, renter bootstrap

- [x] DoD закрыт

```
Задача: E6c. Остальные экраны Dev Console + bootstrap Mini App. Витрина CRM /settings/license — E7.

Предшественник: E6b.

Прочитай: §17.3–§17.14, §17.8, F33/F49/F55/F63/F65/F66/F70/F73/F74/F79/F82/F100/F107/F113/F114/F119/F121.

Делай строго по шагам:

1. Billing: корень organizations + entitlements/state (не license_type alone). Колонки ceiling/active/instruments/plan зеркала. Фильтр active_edition; none ≠ Lite (F49). createManualSubscription — выбор SKU Studio month / Pro month / lifetime (F82). Adjust через dev_console_adjust_organization_subscription (не новое имя). extend_one_month двигает entitlement. Убрать quick adjustStatus canned note (F100) или модалка с человеческой note. provider=stripe убрать/disabled (F121). Блок Lifecycle flag: чтение/запись platform_runtime_flags.editions_lifecycle + audit platform.runtime_flag. Не в Payment methods.
2. Tenants OrgsPage: бейдж Lite/Studio/Pro/Demo из active_edition+status; over-cap; needs review suspended; canPurge: licensed/Lite disabled (F73); suspended только force_anti_abuse+note, не force_licensed (F79). expiring_soon += month T−7 (F66). Transfer: lifetime_license_verified disabled без pro_lifetime (F39). awaiting_payment включает Studio-заявки.
3. Metrics DashboardPage + dev_console_edition_metrics: status counts включая suspended; licensed broken down lite/studio/pro; live instruments; over-cap (F107).
4. Keys: generate-key entitlements не пишет; issue-на-орг и activate_access_key пишут pro_lifetime (F119). Тест: ключ с /keys → activate в CRM → ceiling pro.
5. Edge purge: прокинуть p_force_anti_abuse; 403 licensed Lite.
6. Platform bot / notification-worker copy: Studio vs Pro; expire «режим Lite / продлите», не suspended (F63/F114). SQL CASE уже E1c — проверить тексты Edge.
7. tangodb-renter bootstrap: addon_active после патча хелпера (F74). Версию miniapp бампить по своим правилам, не путать с APP_VERSION CRM.
8. Migrations page: hint «edition backfill в миграции X».
9. Бамп tangodb-dev-console package.json (например 0.2.0). Типы PurchaseRequestKind / Billing row без as any.
10. changelog.

DoD:
- DoD этапа E6 из §6: Inbox Studio ≠ lifetime; DC = entitlements; purge licensed Lite 403; generate≠issue; flag галка на Billing; renter bootstrap Mini App false на Lite/Studio.
- Флаг на prod не включать.
- tsc CRM + DC + renter если трогал. 2.12.y.

Стоп. Не переходи к E7.
```

---

### Этап 7

#### E7 — UI лицензии: три карточки, режим vs cancel

- [x] DoD закрыт

```
Задача: E7. /settings/license для владельца. Первая продажа Studio на prod запрещена, пока флаг off (§22). Код витрины всё равно пишем.

Предшественник: E6c.

Прочитай: §2, §3.1 действия владельца, §4.5 lock-таблица, §4.6, §5.1–§5.2, F6/F7/F27/F28/F31/F44/F72.

Делай строго по шагам:

1. Три карточки Lite / Studio / Pro. Имена латиницей. CTA §2. Не SubscriptionWaitlistCard как замена Studio (Stripe waitlist ≠ group waitlist; карточку «Stripe скоро» не возвращать).
2. Две кнопки, не одна: owner_mode (потолок жив, raising phase=active) и «перейти на Lite и отменить подписку». Confirm: данные не удаляются; чеклист что заморозится.
3. Lifetime в режиме Lite: «у вас Pro пожизненно» + «Вернуть Pro» без оплаты. Месяц не затирает lifetime (F6).
4. Grace: CTA = renew того же SKU, не «Вернуть Studio» без оплаты (F44). set_organization_active_edition вверх с одним past_due — ошибка.
5. purchaseSkuLock по таблице §4.5. При active_edition=studio и живом pro_monthly баннер T−7 и lock остаются Pro (F72). Deep link ?plan=studio → STUDIO_PURCHASE_PATH. ?plan=monthly = Pro.
6. Licensed Lite: isManualPurchaseEligible true, SKU Studio+Pro+lifetime (F31). Pro lifetime: платные SKU скрыты.
7. Апгрейд Studio→Pro mid-cycle: UI явно «кредит не считаем, полный месяц Pro».
8. Гонка: Activate побеждает owner_mode (F27) — это SQL; UI не слать set active параллельно без перечитывания get_organization_edition.
9. T−7 баннер и для Studio month; CTA на STUDIO_PURCHASE_PATH.

DoD:
- Сценарий-якорь §5.3 шаги 3–6 можно пройти на staging (без prod-флага: покупку Activate только если флаг on на копии).
- Режим Lite при живом lifetime возвращает Pro без заявки.
- Cancel без lifetime: нет licenses-строки, журнал не isReadOnly.
- tsc. 2.12.y.

Стоп. Не переходи к E8.
```

---

### Этап 8

#### E8 — джобы: expire, Mini App worker, GCal, webhook

- [x] DoD закрыт

```
Задача: E8. Фоновые Edge/cron. При флаге off persist = 2.11. Пауза Pro-воркеров только при флаге on.

Предшественник: E7.

Прочитай: §4.9, §18.6, F4/F16/F21/F36/F51/F52/F91/F96/F105.

Делай строго по шагам:

1. expire-crm-subscriptions Edge зовёт уже обёрнутый SQL E1c. Проверить тексты digest: Lite / продлите Studio|Pro, не «студия заблокирована». Studio month в очереди digest (F105).
2. renter-booking-worker: при !renter_miniapp_addon_is_active не создавать новые холды; confirmed доигрывают дату, включая T−24 prepaid_charged по уже существующим self-hold (F51). renter_create_booking → edition_forbidden. Исходящий студийный бот не enqueue новых.
3. calendar-sync-worker / kick: не enqueue новых на не-Pro; не удалять события в Google. Триггер enqueue уже no-op из E1b/E3 — проверить worker skip.
4. google-calendar-webhook: не писать в CRM если !google_calendar (F36). renew-watches не продлевать каналы на не-Pro. freebusy отказ если не Pro. reconcile/extend-group-horizon skip без Pro.
5. platform-notification-worker жив на всех редакциях; шаблон Studio уже E1c/E6c.
6. Не трогать замороженный Stripe.
7. SQL/Edge тест: флаг off + expire tick = 2.11 suspend путь; флаг on = Lite persist, не suspended. Mini App на Studio addon false (F4/F52).

DoD:
- Fail-closed Mini App на Lite/Studio. Webhook не пишет CRM на не-Pro.
- Флаг off не открывает Lite-writes и не clamp'ит persist (F91).
- tsc затронутых Edge. 2.12.y.

Стоп. Не переходи к E9.
```

---

### Этап 9

#### E9 — демо → Lite, без purge по таймеру

- [x] DoD закрыт

```
Задача: E9. trial_end. Старый demo_retention на новом пути не использовать. Флаг off = старый purge демо.

Предшественник: E8.

Прочитай: §3.3, §4.10, F13/F26/F35/F47/F80/F101.

Делай строго по шагам:

1. При флаге on: purge_expired_demo_organizations / convert_expired_demo_to_lite — не удаляет org с live free_lifetime / licensed. trial_pro canceled, status=licensed, data_purge_at NULL; колонка `active_edition`: если `rank(active_edition) ≤ rank(effective_ceiling)` после отмены trial (потолок = lite) — оставить, иначе clamp `lite`; `change_reason` = `trial_end` (§3.1).
2. При флаге off — тело 2.11 (purge демо).
3. Review-hold Inbox 2.11 сохранить; eligible kind включает Studio (уже E1c F80). Не убивать заявку cascade (F26).
4. create-self-service-demo-org уже пишет trial+free_lifetime (E1a). Проверить: Mini App выкл; owner_mode вниз во время демо разрешён (§3.1).
5. Activate любого платного SKU во время демо: SQL E1c cancel trial. E9 не дублирует, проверяет интеграцию.
6. onboardingStarterData INSERT locations/disciplines только пока demo_active/trial (F101). На Lite чеклист не создаёт второй зал. JSONB пресета clamp в effective, не затирать.
7. Overs с демо (4 зала) не режем (F35). Кап = новые INSERT.

DoD:
- Флаг on: регистрация 31-й день = Lite writes, данные на месте, data_purge_at NULL.
- Флаг off: демо по-прежнему может быть purged как 2.11.
- tsc. 2.12.y.

Стоп. Не переходи к E10.
```

---

### Этап 10

#### E10 — лендинг, i18n, architecture, decision_log

- [x] DoD закрыт

```
Задача: E10. Копирайт и документы узла. Новый код продукта не писать, кроме i18n/лендинга.

Предшественник: E9.

Прочитай: §2, §3.2, §4.11, §15, F19/F29.

Делай строго по шагам:

1. tangodb-landing: три карточки Lite / Studio / Pro. CTA «Начать бесплатно» → регистрация. Studio/Pro → #pricing. Матрица §3.2. Не копировать Features.tsx единого Pro (не обещать финансы на Studio и абонементы на Lite — F29).
2. i18n лендинга: как принято в репо (en+ru; vi лендинга — вне скоупа v1 если файла нет, не создавать). CRM i18n ru/en/vi: не путать «план/редакция» с абонементом ученика (F19). Имена Lite/Studio/Pro не склонять.
3. architecture.md: слой edition, expire→Lite, гейт Mini App, dual-write, capabilities vs modules.
4. decision_log.md: VER-1 строка 2.12 + закрытые пункты §11 (Решение E0).
5. changelog.md. Этот файл: статус «E0–E10 код готов, E11 смоук; флаг prod off».
6. Не бампить 2.12.0 заново (уже E1a). Микропатч 2.12.y если менялся код лендинга/i18n CRM.
7. Не выдумывать E12.

DoD:
- Лендинг не врёт матрицу. architecture и decision_log описывают 2.12.
- Чеклист шапки: [x] E10.

Стоп. Не переходи к E11, пока DoD закрыт.
```

---

### Этап 11

#### E11 — смоук сценария-якоря и ролей

- [x] DoD закрыт

```
Задача: E11. Приёмка, не фича. Чинить только дыры, которые ломают §14 / §9 UI. Не открывать Stripe, не включать флаг на production.

Предшественник: E10.

Прочитай: §0 якорь, §5.3, §9 UI + Dev Console, §14, §22, F122/F123/F124.

Делай строго по шагам:

1. Staging/копия. Зафиксируй флаг off: платящий Pro ничего не заметил (write-path 2.11). Бейдж DC допустим.
2. Включи editions_lifecycle на staging + audit. Прогон якоря §5.3: регистрация → 31-й день Lite (журнал roster, не 0 учеников) → Studio (касса абонемента) → Pro (финансы, Mini App) → cancel+Lite (серая аренда, leftover списание, Mini App 403) → снова Pro (история на месте).
3. Роли: owner; teacher на Lite без пунктов продажи **и без** `/finance/payroll` (F124); accountant на Lite и Studio — не петля /finance, не /prices, не /renters, не /clients, не /settings/hall-rent (upsell Pro, F123/F124); reception на Lite — журнал, не /subscriptions. Grace-баннер без isReadOnly (F122).
4. Time-aware: period_end в прошлом без ручного cron → касса закрыта, журнал открыт.
5. Dev Console §9: Inbox Studio ≠ lifetime; Billing entitlements; purge licensed Lite 403; Metrics lite/studio/pro+suspended; Keys generate vs activate; extend month двигает entitlement; bot не пишет Lifetime на Studio.
6. Флаг снова off на копии: expire снова 2.11, Lite-writes закрыты (регресс F91). Не оставлять org licensed Lite без free_lifetime.
7. Дыру чини точечно + строка changelog + lessons.md если это ошибка агента. Не начинай новый контур.
8. После зелёного смоука: [x] E11 в шапке и в последовательности. Production cutover — §22 руками владельца, не этот промпт.

DoD:
- §14 п.1–9 наблюдаемы на staging.
- Нет белого экрана. Accountant Studio — upsell Pro, не петля (F123). Teacher Lite не `/finance/payroll` (F124). Grace-баннер без isReadOnly (F122).
- Флаг prod не включён этим чатом.

Стоп. Очередь §16 закрыта. Не выдумывай E12.
```

---

## 17. Dev Console — что менять

Консоль не «показать бейдж». Без этих экранов нельзя ни выставить цену Studio, ни починить drift, ни безопасно включить lifecycle.

### 17.1. Payment methods (`/payment-methods`)

Сейчас: schemaVersion 2, поля `crmLifetime` / `crmMonthly`, per-method `amount` (lifetime) и `monthlyAmount` (Pro month), CAS `pricingRevision`, QR data-URL, подсказка «сумма разная, реквизиты общие».

Нужно (v3):

- канон `crmStudioMonthly: { amount, currency }`;
- per-method override `studioMonthlyAmount` / `studioMonthlyCurrency` **на каждом** способе (crypto, bank, VN, MIR) — тот же паттерн, что `monthlyAmount`; без поля резолв Studio не должен брать `monthlyAmount` Pro (F14/F69);
- UI-секция «Studio / месяц» рядом с Pro month; hint обновить: QR общие на **три** SKU;
- parse v2 без Studio-цены валиден; save → schemaVersion 3;
- пустой Studio при save: предупреждение, не блокировать сохранение Pro-цен (иначе нельзя пофиксить lifetime, пока не решили цену Studio);
- **не** писать `editions_lifecycle` в этот JSON;
- Edge `dev-console-payment-methods` + `formStateToConfig` / `configToFormState`;
- **типы формы консоли** сейчас знают только `amount` / `monthlyAmount` — добавить `studioMonthlyAmount` / `studioMonthlyCurrency` во все method-интерфейсы (F90), иначе save v3 молча потеряет Studio override или подставит Pro;
- тесты `platformPaymentContract.test.ts` (CRM) и Edge `purchaseQuotePolicy_test.ts` покрывают v3 и backward v2. Синхрон: `platformPaymentContract.ts` (CRM + `_shared`), обёртки `paymentConfig.ts` (CRM + Dev Console); Edge quote — re-export `_shared/paymentQuote.ts` → тот же контракт (F14, F67). **В CRM нет** `src/lib/paymentQuote.ts` (`architecture.md` 2.11 это устарело).

`renterMiniappAddon` не удалять из формы (поле живое в конфиге), в v1 не продаём.

### 17.2. Inbox (`/inbox`)

Сейчас: kind `crm_license` | `crm_subscription` | `renter_miniapp_addon`; фильтры lifetime / monthly / addon; `rowKind()` default = `crm_license`; `kindToRequestKind("monthly")` = только `crm_subscription`; Activate зовёт `activate_platform_purchase_request`; `mapRpcActivateError` знает `month_on_lifetime_forbidden` / `already_lifetime`, не `already_pro_lifetime`.

Нужно:

- kind + фильтр **Studio отдельно** (`studio` → `crm_studio_subscription`). Не класть Studio в фильтр `monthly`;
- `rowKind` / Edge list: явный switch по четырём kind; unknown → не Activate, ошибка `unknown_request_kind` (F76);
- **UI `isMonthly` / preview / override period** = `crm_subscription` **или** `crm_studio_subscription` (сейчас строго `=== "crm_subscription"` — F93). Не тащить Studio в lifetime-ветку (генерация ключа);
- Edge `InboxKindFilter`: сейчас `"lifetime" | "monthly" | "addon" | "all"` — добавить `"studio"`; `kindToRequestKind("studio")` → `crm_studio_subscription`; `"monthly"` по-прежнему **только** `crm_subscription`;
- Activate Edge: `request_kind === "crm_studio_subscription"` идёт в **ту же** SQL-ветку month, что Pro (preview_activate, period override + note), не addon и не `crm_license`;
- **обязательный патч SQL в той же миграции, что CHECK kind:** `preview_activate_platform_purchase_request` сегодня `<> 'crm_subscription'` → `preview_month_only`; `activate_platform_purchase_request` month только `= 'crm_subscription'` (F109). Без этого UI `isMonthly` бесполезен;
- `kindLabel`: «Studio / месяц», «Pro / месяц», «Pro / пожизненно», addon как сейчас;
- тип `PurchaseRequestKind` + `crm_studio_subscription`; ветка Activate Studio = **та же month-ветка**, что Pro (`preview_activate`, override period + note), не lifetime-ключ;
- в строке заявки: текущие ceiling / active org (RPC list должен JOIN entitlements);
- ошибки: `already_pro_lifetime` **и** алиасы 2.11 `month_on_lifetime_forbidden` / `already_lifetime`; плюс `ceiling_blocks_sku`, `studio_not_configured`, `preview_month_only`, `unknown_request_kind` — человеком (F83);
- Activate на `demo_active` — тот же RPC, cancel trial (§3.3);
- **Addon pause/resume** (`organization_addons`) — исторический UI. **Не** гейт Mini App (HALL-RENT-SELF-2). Не документировать pause addon как «выключить Mini App на Pro»;
- support-вкладка без изменений.

Edge: `dev-console-purchase-inbox`.

### 17.3. Billing (`/billing`)

Сейчас: поиск от `organizations` + embed licenses/subscriptions (`dev-console-search-billing`); `license_type=null` на будущем Lite; фильтр `none` = нет month и не lifetime — **не** эквивалент edition Lite; нет entitlements; adjust month пишет зеркало без edition state.

Нужно:

- тот же корень `organizations`, но JOIN/RPC entitlements + `organization_edition_state` + зеркала (не полагаться на `license_type` alone);
- колонки: `effective_ceiling`, `active_edition`, live instruments, периоды, over-cap;
- фильтр по `active_edition` и отдельно «orphan licensed» (редкий drift), не путать с Lite (F49, F65);
- **Adjust edition** (developer): set active, grant/revoke month Studio/Pro, grant lifetime, **extend one month** — всё через существующий SQL `dev_console_adjust_organization_subscription` (Edge `dev-console-adjust-subscription`). **Не** создавать вторую функцию `…_edition` (F113). Внутри: entitlements + dual-write §18.3 + XOR raising. Note обязателен → `platform_audit_log`;
- `p_extend_one_month`: сдвигает `period_end` live month через `add_calendar_month` **и** зеркало `current_period_end`. Без SKU picker не превращать Studio в Pro;
- нельзя `active > ceiling`; нельзя затереть lifetime месяцем; нельзя поднять active по одному `past_due` (time-aware);
- create manual: выбор Studio month vs Pro month vs Pro lifetime — сегодня `createManualSubscription` **всегда** Pro month без выбора (F82);
- quick `adjustStatus` — **убрать** или модалка с **человеческой** note. Сейчас шлёт canned `"Quick status change from Dev Console"` (F100), это не аудит;
- `<select> provider`: v1 только `manual`; `stripe` убрать/disabled (F121);
- колонка таблицы: показать `plan` зеркала (`studio`/`pro`/`standard`) **и** edition, не только `subscription.status`;
- после adjust перечитать CRM-истину (функции ceiling/active), не только `organization_subscriptions`;
- блок **Lifecycle flag** (§17.8) — здесь, не на Payment methods.

### 17.4. Tenants (`/orgs`)

Сейчас: `license_badge`, demo days, purge, issue key, transfer owner. `canPurge` разрешает licensed при `force_licensed`. `lifetime_license_verified` — фактор transfer.

Нужно:

- бейдж редакции (Lite / Studio / Pro / Demo) из `active_edition` + `status`; фильтр;
- индикатор over-cap (залов/клиентов > капа Lite);
- колонка/фильтр **needs review** (suspended, который backfill не тронул);
- **purge отказывать** если `status=licensed` или live `free_lifetime` (сейчас licensed **без** license-row purge **разрешён** — F70). `force_licensed` для licensed Lite **убрать**;
- **`suspended`:** не путать с Lite. Кнопка Purge disabled по умолчанию; узкий путь `force_anti_abuse` + note + audit (`org.purged_abuse`) — F79. Не reuse `force_licensed`;
- **UI `OrgsPage.tsx`:** сегодня `canPurge(t) => t.status !== 'purged'` — любой licensed Lite с кнопкой Purge (F73). После E6: licensed/Lite disabled; demo без hold — можно; suspended — только anti-abuse. Server-side F70/F79; не полагаться только на SQL;
- фильтр **expiring_soon**: добавить month Studio/Pro (T−7 / `current_period_end`), не только demo (F66);
- issue key по-прежнему = Pro lifetime (существующий поток) + запись `pro_lifetime` entitlement + `active_edition=pro` + `free_lifetime` если нет;
- transfer owner: не требовать lifetime-фактор у Lite; остальные факторы живы. Чекбокс `lifetime_license_verified` disabled если нет `pro_lifetime`.

### 17.5. Metrics (`/`)

Сейчас `DashboardPage.tsx` + `dev-console-metrics`: `org_count`, `licensed_count`, `demo_active_count`, `demo_retention_count`, keys, members, db size. **Нет** edition / instruments / over-cap / suspended.

Нужно — счётчики org:

- по `organizations.status`: demo_active / demo_retention / licensed / suspended / purged;
- по `active_edition` среди licensed: lite / studio / pro (из **функции**/state, не из `plan`);
- отдельно: live `trial_pro`, live `studio_monthly`, live `pro_monthly`, live `pro_lifetime`;
- over-cap Lite.

Не только licensed vs demo. Не считать Studio по `organization_subscriptions.plan` без entitlements. RPC `dev_console_edition_metrics` (§18.7).

### 17.6. Keys (`/keys`)

Два Edge, не один: **`dev-console-generate-key`** (ключ ещё не у org) и **`dev-console-issue-key`** (к конкретной org, с `/orgs`). Generate **не** пишет entitlements. Consume в CRM = `activate_access_key` → `pro_lifetime` + state pro + `free_lifetime` если нет (F55, F119). Issue-на-орг — тот же lifetime путь. Без нового SKU. Не оставлять «ключ прожжён, entitlements пустые».

### 17.7. Migrations / Users / Platform bot / Errors / Landing analytics

**Migrations** (`/migrations`): copy про `organization_licenses.crm_version_id` не трогать; после E1 — подсказка «edition backfill выполнен в миграции X», не ручной apply licenses.

**Platform bot / outbox (F63):** kind `crm_studio_subscription` в человекочитаемых текстах («Studio / месяц»); digest T−7 и expire — отдельные шаблоны для Studio vs Pro month; expire → «режим Lite / продлите», не «suspended».

**Errors / Landing analytics:** без обязательных полей edition в v1; при желании — тег `active_edition` в логах Edge после E6.

**Users:** без новой логики редакции (developer ≠ tenant edition).

### 17.8. Флаг cutover

Галка **только Billing**: читает/пишет `platform_runtime_flags.editions_lifecycle` + кто включил + `platform_audit_log`. Пока off — expire/purge как 2.11. Включение — не часть save Payment methods.

SQL-хелпер `editions_lifecycle_enabled()` читают: `expire_crm_organization_subscriptions`, `purge_expired_demo_organizations` / `convert_expired_demo_to_lite`, триггеры edition/cap (early-return), RPC `edition_allows` / `organization_allows_writes` (ветка 2.12), **Activate/preview Studio** (`editions_lifecycle_off` при флаге off — F52). CRM SPA флаг **не** использует для write-path: SQL истина.

**Канон r6 (меняет r5):** при флаге **off** SQL write-path = **2.11 целиком**. Не открывать licensed Lite. Не clamp'ить кассу time-aware. Не skip GCal enqueue. Expire-cron всё ещё `past_due` → `suspended`. Demo purge жив. Backfill entitlements/state **есть** — бейдж, Tenants, Metrics. `get_organization_edition` может отдавать вычисленное для DC. **Журнал Lite (roster)** — только **E4** и флаг **on**; до этого при off expire по-прежнему ведёт к suspend (F91), даже если E2 уже снял month-lock (F108).

При флаге **on**: time-aware clamp, Lite writes, expire→Lite persist, demo→Lite, enqueue skip, venue-ack skip.

**Не Activate Studio на prod**, пока флаг off (§22) — SQL отказ, не только runbook. Иначе F52 Mini App + dual-write month без полного чеклиста. **E2/F108** (снять month-lock) деплоить при off **можно** — не путать с включением флага. **F122** — grace-баннер деплоить вместе с E2.

### 17.9. Типы и контракты (CRM + Dev Console + Edge)

| Артефакт | Действие 2.12 |
|---|---|
| `tangodb/src/types/database.ts` (gen) | таблицы §4.3, §4.7 |
| `PurchaseRequestKind`, `PlatformPaymentSku` в Dev Console | + `crm_studio_subscription` |
| `tangodb/src/lib/platformPaymentContract.ts` | schemaVersion 3, `crmStudioMonthly`, коды `studio_not_configured` |
| `tangodb-dev-console` Inbox/Billing row types | ceiling, active, instruments |
| Edge `_shared/platformPaymentContract.ts` | sync с CRM; тесты policy |

Не вводить четвёртый ручной парсер цен в UI Billing — только RPC adjust.

### 17.10. Mini App (`tangodb-renter/`)

Отдельное Vite-приложение; **не** Dev Console, но тот же Supabase и те же SQL-гейты.

| Место | Сейчас | 2.12 |
|---|---|---|
| `renter_miniapp_addon_is_active` | licensed ∧ (lifetime ∨ month) | §4.4 — Pro + edition + ¬trial |
| Bootstrap / `fetchBootstrap` | `addon_active` с RPC | тот же флаг после патча хелпера (F52/F74) |
| `renter_create_booking`, topup | SQL edition gate | §18.4 |
| Версия пакета | `tangodb-renter/package.json` | при релизе 2.12 — bump по правилам miniapp, не путать с `APP_VERSION` CRM |

Staff CRM (`/renters`) и renter SPA должны согласованно показывать «Mini App выкл» на Lite/Studio/demо.

### 17.11. Версии и типы Dev Console

- `tangodb-dev-console/package.json` — semver консоли поднимать вместе с контуром 2.12 (отдельно от CRM, но в том же PR-узле E6).
- После E1: `npm run db:gen-types` в `tangodb/`; реэкспорт/копия сгенерированных типов в консоль (как сейчас для billing/inbox) — не оставлять `as any` на `organization_entitlements` (F59).
- Ручные union: `tangodb-dev-console/src` — `PurchaseRequestKind`, `PlatformPaymentSku`, строки Inbox/Billing/Tenants (ceiling, `active_edition`, `instruments[]`).
- Сейчас консоль `0.1.0` — первая поставка E6: bump (например `0.2.0`), не равнять с CRM `2.12.0`.

### 17.12. Edge-контракт консоли (сводка)

| Edge | Сейчас | 2.12 |
|---|---|---|
| `dev-console-purchase-inbox` | filter monthly = Pro; rowKind default lifetime; `InboxKindFilter` без studio; ошибки 2.11 | Studio kind + filter `studio`; preview_activate Studio; UI `isMonthly` оба month SKU; map `already_pro_lifetime` + алиасы |
| `dev-console-search-billing` | org + embed licenses/subs; filter `none`/`lifetime`/sub.status на клиенте | + entitlements/state; filter edition; не трактовать `none` как Lite |
| `dev-console-adjust-subscription` | пишет только `organization_subscriptions`; Billing canned note; `extend_one_month`; UI stripe | wrap тот же SQL `dev_console_adjust_organization_subscription` (не новое имя); SKU picker; без canned note; без stripe; extend → entitlements (F113, F121) |
| `dev-console-list-tenants` | `license_badge`, `expiring_soon` = demo | badge edition; T−7 month; `can_purge`; `needs_review` |
| `dev-console-purge-org` | `force_licensed` | F70 + `force_anti_abuse` (F79, F104); 403 licensed Lite |
| `dev-console-metrics` | licensed vs demo (нет suspended/edition) | §17.5 / F107 |
| `dev-console-payment-methods` | v2 form | v3 + Studio fields; не трогает flags |
| `dev-console-issue-key` / `dev-console-generate-key` | lifetime license row / unused key | issue + `activate_access_key` → `pro_lifetime`; generate сам entitlements не пишет (F119) |
| `dev-console-transfer-owner` | фактор lifetime | disabled без `pro_lifetime` |
| `dev-console-platform-bot` | copy «CRM monthly» | Studio vs Pro templates (F63) |
| `platform-notification-worker` | шаблоны Pro month / license | kind Studio; expire→Lite copy. Есть в §18.6 |
| `expire-crm-subscriptions` | зеркало Pro → suspend | Studio+Pro entitlements; persist Lite только при флаге on (F105, F91) |

### 17.13. Конкретные ветки 2.11.48 (не пропустить в E6)

Факт кода, без которого UI-спека снова разъедется:

| Место | Строка/факт 2.11.48 | 2.12 |
|---|---|---|
| `PurchaseInboxPage.rowKind` | addon / `crm_subscription` / **else `crm_license`** | явный switch 4 kind; else не Activate |
| `PurchaseInboxPage` `isMonthly` | `kindRow === "crm_subscription"` | `\|\| kindRow === "crm_studio_subscription"` |
| preview loop | `rowKind(r) === "crm_subscription"` | оба month kind |
| `InboxKindFilter` Edge | `"lifetime" \| "monthly" \| "addon" \| "all"` | + `"studio"` |
| `kindToRequestKind("monthly")` | `crm_subscription` | **не** расширять на Studio |
| Activate Edge | addon отдельно; иначе RPC month/lifetime по `request_kind` | Studio = month RPC; SQL CHECK уже содержит kind |
| `BillingPage.createManualSubscription` | `provider=manual, status=active`, без SKU | выбор SKU → adjust edition |
| `BillingPage.adjustStatus` | note = `"Quick status change from Dev Console"` | убрать или человеческая note |
| `BillingRow` | `license_type`, embed subscription, **нет** `plan` в UI-колонке как edition | ceiling/active/instruments |
| `OrgsPage.canPurge` | `status !== 'purged'` | F73 |
| `DashboardPage` Metrics | 7 карточек, нет edition/suspended | §17.5 |
| `paymentConfig.ts` консоли | только `amount` / `monthlyAmount` | + `studioMonthlyAmount` / `studioMonthlyCurrency` на каждом способе |
| `purge_single_organization` | нет `p_force_anti_abuse` | F104 |
| `_organization_has_eligible_purchase_review_new` | `crm_license` \| `crm_subscription` | + Studio (F80) |
| `preview_activate_platform_purchase_request` | `request_kind <> crm_subscription` → `preview_month_only` | `IN` двух month SKU (F109) |
| `activate_platform_purchase_request` | month-ветка `= crm_subscription` | `IN` двух SKU; иначе Studio = lifetime-ключ (F109/F118) |
| `parsePurchaseQuoteSku` / quotes CHECK | два SKU | + `crm_studio_subscription` (F118) |
| notification CASE | `crm_subscription` ELSE Lifetime | явная ветка Studio (F114) |

### 17.14. Экраны консоли — инвентарь v1 (ничего не забыть)

| Экран | Обязательный патч 2.12 | Можно не трогать в v1 |
|---|---|---|
| `/payment-methods` | v3 + Studio override-поля + parse v2 | `renterMiniappAddon` поле оставить, не продаём |
| `/inbox` purchases | Studio kind/filter/`isMonthly`/preview/Activate | support-вкладка |
| `/inbox` addon pause | не гейт Mini App | historical rows |
| `/billing` | edition columns, SKU picker, extend, flag, без stripe/canned | — |
| `/orgs` | badge edition, canPurge, expiring_soon month, transfer lifetime factor, awaiting_payment включает Studio-заявки | password reset |
| `/` Metrics | lite/studio/pro + suspended + instruments | db size как сейчас |
| `/keys` | generate vs issue vs `activate_access_key` | — |
| `/migrations` | hint backfill edition | copy `crm_version_id` |
| Platform bot | Studio copy | — |
| Users / Errors / Landing analytics | — | без обязательных полей edition |

---

## 18. База данных — миграции, RLS, dual-write, RPC

RLS **не** ослаблять. Новые таблицы — как tenant data + platform audit.

### 18.1. CHECK / enum-расширения существующих объектов

| Объект | Сейчас | 2.12 |
|---|---|---|
| `platform_purchase_quotes.sku` | `crm_license`, `crm_subscription` | + `crm_studio_subscription` |
| `platform_purchase_requests.request_kind` | + `renter_miniapp_addon` | + `crm_studio_subscription` |
| `_organization_has_eligible_purchase_review_new` | `crm_license` \| `crm_subscription` | + `crm_studio_subscription` (F80) |
| `platform_purchase_requests_kind_guard` | authenticated не шлёт kind | без изменений: kind из quote RPC |
| `organization_subscriptions.plan` | текст, **нет CHECK**; на практике `standard` | писать `studio` \| `pro`; читать `standard` как `pro` |
| `organization_subscriptions` 1:1 | PK `organization_id` | да; два месяца = запрет unique entitlements. Trial/Lite: строки месяца **может не быть** |
| `organization_licenses` 1:1 | да | да; Lite без строки лицензии — норма. CHECK по-прежнему только `lifetime`\|`subscription` |
| GRANT authenticated на licenses | без `access_key_id` (S24) | не расширять |
| `organization_invites` | pending инвайты | кап members: pending **и не expired** |
| `accept_organization_invite` | INSERT member | + проверка капа members (F61) |
| `update_team_member` | `p_is_active` без капа | + cap members при true (F77) |
| INSERT clients/locations/disciplines/members | RLS `organization_allows_writes` | + trigger капа INSERT |
| UPDATE `clients.archived_at` → NULL | RLS write | + cap trigger (F77) |
| INSERT/UPDATE `personal_lessons`, `prices`, `expenses`, `subscriptions` | RLS + `organization_allows_writes` | + `edition_allows` trigger (F75) |
| `purge_single_organization` / `_purge_demo_organization_core` | lifetime row или active month; сигнатура `p_force_licensed` | + **запрет** purge licensed и/или live `free_lifetime` (F70); `p_force_anti_abuse` + note для suspended (F79, F104) |
| `platform_runtime_flags` | нет | **новая** таблица, service_role + Dev Console Edge; authenticated **без** SELECT |
| Notification templates / digest SQL | Pro month copy; CASE ELSE = Lifetime | Studio month + expire→Lite copy (F63, F114); CASE явный, не ELSE |
| `preview_activate_platform_purchase_request` | `request_kind <> 'crm_subscription'` → `preview_month_only` | `IN ('crm_subscription','crm_studio_subscription')` (F109) |
| `activate_platform_purchase_request` | month-ветка `= 'crm_subscription'` | `IN` двух SKU; Studio без этого = lifetime-ключ (F109) |
| `_preview_crm_month_activation_period` | только зеркало `organization_subscriptions` | live month из entitlements |
| `dev_console_adjust_organization_subscription` | зеркало month + `p_extend_one_month` | wrap: entitlements + dual-write + XOR; **не** переименовывать (F113) |
| `parsePurchaseQuoteSku` / quotes CHECK | два SKU | + Studio (F118) |
| TZ trigger Mini App slots | блокирует смену timezone | не ослаблять; occupancy сначала (F111) |
| `organization_subscriptions.plan` CHECK | **нет** | **не** добавлять, пока backfill `standard`→`pro` не прогнан; опционально после |

### 18.2. RLS новых таблиц

| Таблица | SELECT authenticated | INSERT/UPDATE/DELETE authenticated |
|---|---|---|
| `organization_entitlements` | член org (учитель тоже: UI гейты) | **нет** — только SECURITY DEFINER RPC / service_role |
| `organization_edition_state` | член org | нет |
| `organization_edition_events` | owner/director **или** только service_role (предпочтительно не светить в SPA — читать через RPC `get_organization_edition`) | нет |
| `schedule_group_roster` | `can_read_operational` / teacher scope как у группы (`teacher_has_schedule_group_access`) | нет (RPC) |
| `roster_attendance` | как `attendance` (`teacher_can_view_attendance_row`) | нет (RPC) |
| `platform_runtime_flags` | нет authenticated | нет — service_role / Dev Console Edge |

Dev Console не ходит в таблицы JWT CRM: Edge + `service_role`, как сейчас Inbox/Billing.

`get_organization_edition` не возвращает полный `organization_edition_events` учителю (metadata admin). Events — owner/director через тот же RPC опциональным флагом или отдельный RPC.

### 18.3. Dual-write (одна TX)

Каждый писатель entitlements обновляет зеркала. **Истина — entitlements.** Зеркала нужны, пока жив код 2.11.

| Событие | entitlements | licenses | subscriptions | org.status | edition_state |
|---|---|---|---|---|---|
| trial start | `trial_pro` + `free_lifetime` | нет | нет | `demo_active` | `pro`, `trial_start` |
| trial_end | `trial_pro` canceled | нет | нет | `licensed`, purge NULL | clamp колонки `active_edition`: если `rank(active_edition) ≤ rank(effective_ceiling)` — оставить, иначе `lite` (после trial ceiling = lite → обычно `lite`); `change_reason` = `trial_end` |
| Activate Studio (вкл. с демо) | `studio_monthly` active; cancel other paid month **и trial_pro** | `license_type=subscription` **только если не lifetime** | `plan=studio`, `current_period_*` ← entitlement `period_*`, `active`, `provider=manual` | `licensed` | `studio`, `purchase` |
| Activate Pro month | `pro_monthly`; cancel studio month **и trial_pro** | как выше | `plan=pro`, `current_period_*` ← `period_*` | `licensed` | `pro`, `purchase` |
| Activate lifetime | `pro_lifetime`; cancel months **и trial_pro** | `lifetime`, ключ consumed | month `canceled` (**не** suspended) | `licensed` | `pro`, `purchase` |
| Renew того же SKU с `past_due` | та же строка → `active`, новый period | subscription если не lifetime | period, `active` | `licensed` | clamp up to edition SKU, `renew` |
| expire_grace (`period_end`) | monthly `past_due` | не трогать | `past_due` | `licensed` | **lite**, `expire_grace` |
| expire после grace / `owner_cancel` | monthly canceled | **DELETE** строки если нет live `pro_lifetime`; lifetime не трогать | `canceled` | `licensed` (**не** suspended) | `lite`, `expire` / `owner_cancel` |
| owner_mode вниз | без изменений | без изменений | без изменений | без изменений | вниз, `owner_mode` |
| owner_mode вверх | запрещён, если потолок только `past_due` | — | — | — | — |
| admin suspend | — | — | — | `suspended` | без изменений |
| issue/activate key | `pro_lifetime` + `free_lifetime` | `lifetime` | month canceled если был | `licensed` | `pro`, `admin_adjust`/`purchase` |
| Billing extend one month | та же live month-строка: новый `period_end` | не трогать тип | `current_period_end` ← entitlement | `licensed` | без смены active, `renew`/`admin_adjust` |
| Billing create manual Studio/Pro | новый/обновлённый monthly; XOR cancel other raising | `subscription` если не lifetime | `plan=studio\|pro`, period, `active` | `licensed` | купленная редакция, `admin_adjust` |

Инвариант-тесты:

- `pro_lifetime` live ⇒ `organization_licenses.license_type = 'lifetime'`.
- monthly live (`active`\|`past_due`) без lifetime ⇒ licenses `subscription`.
- нет live paid и нет lifetime ⇒ **нет** строки licenses.
- `organizations.status=licensed` после штатного expire.

`sync_organization_subscription` 2.11 ветку «canceled и не lifetime → suspended» **не вызывать** с нового пути. Старый Stripe-webhook не включать.

### 18.4. Новые / расширяемые RPC

Писать только в `hooks/` + `lib/`, не из компонентов. Имена рабочие:

| RPC | Кто | Зачем |
|---|---|---|
| `set_organization_active_edition` | owner/director (`can_manage_settings`) | режим; clamp к ceiling |
| `cancel_organization_monthly_entitlement` | owner/director | сразу режет month, clamp active |
| `get_organization_edition` | любой член | **функция** ceiling/active (time-aware), `phase` live month, capabilities, **caps usage**, live instruments (F72); сырую колонку state не отдавать, если выше clamp; `editions_lifecycle` **не** отдавать в SPA |
| `mark_roster_attendance` / add/remove roster | как mark attendance | E4 |
| `activate_platform_purchase_request` | service_role Inbox | ветка Studio + dual-write; month `IN` двух SKU |
| `preview_activate_platform_purchase_request` | service_role Inbox | то же `IN` (F109) |
| `expire_crm_organization_subscriptions` | cron | Studio+Pro, → Lite |
| `convert_expired_demo_to_lite` | cron (вместо/внутри purge) | trial_end |
| `dev_console_adjust_organization_subscription` | service_role | §17.3 / F113 — **это** имя 2.11.48, не `_edition` |
| `editions_lifecycle_enabled` | cron / RPC | читает `platform_runtime_flags` |
| `organization_allows_writes` | как сейчас | + Lite |
| `renter_miniapp_addon_is_active` | как сейчас | + edition ∧ ¬trial |
| `submit_platform_purchase_request` / quotes | как 2.11 | новый SKU |
| `create_organization_invite` | как сейчас | кап members+pending non-expired |
| `accept_organization_invite` | invitee | кап members **до** INSERT (F61) |
| `update_team_member` | owner/director | кап members при `p_is_active=true` (F77) |
| `purge_single_organization` | Dev Console / service | F70 + F79: licensed Lite не purge; suspended только anti-abuse |
| `activate_access_key` | owner | + `pro_lifetime` |
| `staff_renter_wallet_payout` / preview | finance roles | **разрешён** на Lite/Studio (исключение) |
| `renter_submit_topup` / `renter_create_booking` | Mini App | только Pro + addon helper |

Гейт `edition_allows`: **полный список — §18.9**. Неполный перечень с вымышленными именами (`sell_subscription`, `add_personal_lessons`, `record_expense`) **запрещён** — сверка с codegraph при E3.

Не гейтить (все живые редакции, при `organization_allows_writes`): `mark_attendance` consume существующего абонемента, `mark_personal_lesson_attendance` на уже существующей строке, `mark_roster_attendance`, `correct_attendance` leftover, `apply_scheduled_subscription_member_changes` leftover (F112), `assign_lesson_substitute`, `clear_lesson_substitute`, `move_group_lesson_occurrence`, `cancel_group_lesson_occurrences`, `cancel_teacher_group_vacation`, CRUD групп/слотов в рамках капов, DELETE зала/направления (кап = live count), отмена **будущей** аренды / персоналки / мероприятия (§4.8), wallet payout/preview, `finish_subscription` **без** refund на leftover, `client_notes` INSERT, UPDATE имени зала/направления, UPDATE имени/телефона **существующего** арендатора.

`mark_attendance` (старый) на Lite **разрешён**, если абонемент уже существует (consume), accruals skip; `apply_subscription_freeze_period` / `cancel_subscription_freeze_period` — только при `edition_allows(group_subscriptions)` (UI скрыт §4.7, SQL тоже). `record_*_payment` на Lite — нет. `replace_subscription_partner` / `finish_subscription_with_refund` / `create_subscription_refund` — Studio+. `finish_subscription` без refund — Lite да (F99).

BEFORE INSERT/UPDATE triggers: капы §3.5; edition §18.9 на таблицах с authenticated write.

### 18.5. Коды ошибок (стабильные)

| code | Когда |
|---|---|
| `edition_forbidden` | write вне каталога `organization_active_edition()` |
| `edition_cap_exceeded` | кап Lite (INSERT или restore/reactivate) |
| `already_pro_lifetime` | покупка month при lifetime; алиас 2.11: `month_on_lifetime_forbidden` / `already_lifetime` (F83) |
| `ceiling_blocks_sku` | SKU ниже/конфликтует с live month |
| `edition_active_above_ceiling` | попытка set active > ceiling (вкл. только past_due) |
| `studio_not_configured` | quote/submit Studio, в конфиге нет `crmStudioMonthly` |
| `editions_lifecycle_off` | preview/Activate `crm_studio_subscription` при флаге off (F52). Не для Pro month/lifetime |
| `licensed_org_purge_forbidden` | как 2.11, плюс licensed Lite / `free_lifetime` |
| `unknown_request_kind` | Inbox Activate неизвестного kind |
| `abuse_purge_note_required` | `force_anti_abuse` без note |

Не reuse `license_required` для штатного Lite.

GRANT EXECUTE: `get_organization_edition`, `set_organization_active_edition`, `cancel_organization_monthly_entitlement`, roster RPC — `authenticated`. Activate/expire/adjust/flags — `service_role`.

После E1: `npm run db:gen-types` в `tangodb/` (и консоль, если свои типы). Mini App — свои типы не плодить `as any`.

### 18.6. Edge Functions — чеклист патча

`create-purchase-quote`, `submit-purchase-request`, `expire-crm-subscriptions`, `purge-expired-demo-orgs`, `calendar-sync-worker`, `calendar-sync-kick`, `google-calendar-webhook`, `google-calendar-renew-watches`, `google-calendar-freebusy`, `google-calendar-set-freebusy-config`, `renter-booking-worker`, `renter-telegram-auth` (если режет addon), `platform-notification-worker`, `dev-console-payment-methods`, `dev-console-purchase-inbox`, `dev-console-adjust-subscription`, `dev-console-search-billing`, `dev-console-list-tenants`, `dev-console-metrics`, `dev-console-purge-org`, `dev-console-issue-key` / generate-key (lifetime → entitlements), `dev-console-transfer-owner` (фактор lifetime).

`create-self-service-demo-org`: по-прежнему демо Pro, плюс две entitlement-строки + `organization_edition_state`.

`platform-notification-worker`: шаблоны Studio vs Pro; expire copy «режим Lite».

Не трогать замороженный Stripe (`create-subscription-checkout`, `stripe-webhook`).

`create-purchase-quote`: allowlist SKU (`parsePurchaseQuoteSku` + Studio, F118) + `already_pro_lifetime`; нет канона Studio → `studio_not_configured`, не `invalid_sku` и не цена Pro.

`dev-console-adjust-subscription`: тот же SQL `dev_console_adjust_organization_subscription`; extend и create-manual пишут entitlements.

`dev-console-purge-org`: прокидывает в `purge_single_organization`; после F70 **и F73/F79** UI не должен предлагать purge licensed Lite; `force_anti_abuse` только с note.

### 18.7. Индексы и отчётность (Dev Console Metrics)

Помимо §17.5, для быстрых счётчиков без full scan:

- `organization_edition_state (active_edition)` — фильтр Metrics;
- `organization_entitlements (organization_id)` WHERE live — уже partial unique §4.3;
- опционально materialized view **не в v1** — достаточно RPC `dev_console_edition_metrics` на service_role, если PostgREST count по join тяжёлый.

### 18.8. Миграции и порядок деплоя БД

1. **Одна цепочка** в `tangodb/supabase/migrations/`. Хвост 2.11 на диске: **`20261217000001_ux16_show_beginner_hints.sql`**. Первая миграция 2.12 — префикс **после** `20261217` (например `20261218000001_editions_e1_entitlements.sql`). Порядок внутри узла: таблицы §4.3 (включая `one_raising` F94) → хелперы time-aware §4.4 → backfill **всех** non-purged org → `platform_runtime_flags` **до** патча writes (F91) → патч `organization_allows_writes` / `renter_miniapp_addon_is_active` / purge F70/F79/F104 **с веткой флага** → кап-триггеры INSERT+UPDATE + advisory lock bigint → edition-триггеры таблиц §18.9 **по правилам §18.12** + wrap флагом → CHECK SKU + review-hold Studio + **preview/Activate `IN`** (F109) + notification CASE (F114) + wrap `dev_console_adjust_organization_subscription` (F113) → `update_team_member` cap → roster E4 (можно отдельным файлом после каркаса, но **до** cutover).
2. **SQL-тесты** рядом: `tangodb/supabase/tests/editions_*_test.sql` — прогон в CI до включения lifecycle. Обязательны: time-aware до cron; JWT INSERT personal_lessons; restore client; dual-session cap; preview/Activate Studio; extend_one_month; leftover pair-cron; `create_renter` Lite.
3. **Откат:** DDL не откатывать на prod; `editions_lifecycle=false` возвращает **persist-cron** 2.11. Таблицы entitlements остаются; CRM читает edition через RPC даже при off-flag (бейдж). Пока off — **не** Activate Studio на prod (F52).
4. **Не** смешивать в одной миграции изменение `platform_payment_methods.config` и `platform_runtime_flags` — разные write-path и аудит (F46).
5. `accept_organization_invite`, `create_organization_invite`, `update_team_member` — в той же миграции, что кап members, до E1 DoD.

### 18.9. Capability × write-path (канон E3)

Триггер = **точечный** BEFORE INSERT (и точечный UPDATE restore/reactivate) по **§18.12**, не слепой `INSERT OR UPDATE` на всю строку. RPC = проверка в начале функции. SELECT истории не режем.

| Capability | Write-path 2.11.48 (факт) | Lite | Studio | Pro |
|---|---|---|---|---|
| `group_subscriptions` | RPC `create_group_subscription`; leftover `subscriptions` **и** `subscription_groups` INSERT (`useSubscriptions` — **удалить в E3**, F120); `record_subscription_payment`; freeze RPC; `finish_subscription_with_refund` / `create_subscription_refund` / `complete_subscription_refund` / `cancel_subscription_refund`; `replace_subscription_partner`; waitlist RPC | `finish_subscription` без refund **и** `apply_scheduled_subscription_member_changes` leftover — да (F112); остальное — | write | write |
| `personal_lessons` | **INSERT** `personal_lessons` (`useAddPersonalLessons` в `usePersonalLessons.ts`); RPC `update_personal_lesson`, `delete_personal_lesson` / `delete_personal_lesson_series_from_date`; `record_personal_lesson_payment`, `void_personal_lesson_payment`, `restate_personal_lesson_amount`; `close_personal_lesson_occurrence` | consume attendance + future delete occupancy; close **без** accruals | write; close без accruals | write |
| `attendance` | `mark_attendance`; `mark_personal_lesson_attendance`; `correct_attendance`; roster RPC | write consume / roster / correct leftover | write | write |
| `prices` | PostgREST `prices` INSERT/UPDATE/DELETE (`usePrices`); **junction** `price_teacher_members` / `price_disciplines` INSERT | — | write | write |
| `single_visits` | RPC `record_single_visit` | — | write | write |
| `finance` | PostgREST `expenses`; RPC `write_off_personal_lesson_debt`; `correct_payment` / `update_payment_in_place` если платёж **не** operational | SELECT `payments` по роли **жив** (F97) | SELECT жив; write expenses — | write |
| operational correct | `correct_payment` / `update_payment_in_place` если payment → subscription / personal_lesson / single_visit | — | write | write |
| `payroll` | `recalculate_teacher_settlement`, `record_teacher_settlement_payment`, `save_teacher_pay_rate`, `save_teacher_pay_rule` | — | — | write |
| `hall_rent` | `create_rental` / `create_rental_series`; `create_rental_invoice` / `record_rental_payment` / `record_rental_invoice_payment` / `correct_rental_payment`; `record_rental_advance` / `allocate_rental_advance` / `cancel_rental_advance_allocation` / `record_rental_deposit_movement` / `apply_rental_pricing_adjustment`; `upsert_rental_tariff` / `upsert_location_rental_hour_rate`; `upsert_renter` **create** + legacy `create_renter`; contacts/contracts/documents/communications/QR/`commit_organization_renter_bot`; `staff_renter_wallet_topup` / `_adjust`; `archive_renter`; `accept_venue_cost_rule_version` / `save_venue_cost_rule_draft` / `delete_venue_cost_rule_draft` / `confirm_venue_cost_rule_gap`; `close_group_lesson_occurrence` venue-close | payout + UPDATE существующего арендатора; close без accruals | payout + UPDATE существующего; close без accruals | write |
| `renter_miniapp` | `renter_create_booking`, `renter_create_recurring_pack`, `renter_quote_booking`, `renter_submit_topup`, `renter_cancel_occurrence` / `_pack` / `_delete_hold` + helper §4.4 | — (cancel future occupancy §4.8) | — | write |
| `google_calendar` | `enqueue_calendar_sync` (**триггеры** personal_lessons / slots / rentals / events / group occurrence + RPC), `enqueue_calendar_timezone_resync`, reconcile RPC, Edge freebusy/connect | — (enqueue no-op, F96) | enqueue no-op | write |
| `calendar_events` | `create_calendar_event_with_cancellations`; `update_calendar_event` / `update_calendar_event_with_cancellations`; `record_calendar_event_payment` | будущая отмена ok | будущая отмена ok | write |
| `export_operational` | `can_export_data` / storage INSERT operational | — | write | write |
| `export_financial` | `can_export_financial` | — | — | write |
| `offline_attendance` | `sync_offline_mark_attendance` | — | — | write |
| `multi_location` / `multi_discipline` / `clients` / members | INSERT + cap UPDATE §3.5; `client_notes` INSERT ⊂ clients | 1-й / кап; notes да | write | write |
| `schedule` | слоты/группы (`useSchedule` INSERT) | write | write | write |

Триггеры обязательны на: `personal_lessons` (**INSERT**; UPDATE — §18.12), `prices`, `price_teacher_members`, `price_disciplines`, `expenses`, `subscriptions` (**INSERT**, не UPDATE `lessons_left`), `subscription_groups` (INSERT), `clients` (INSERT + restore), `locations` / `disciplines` (**INSERT only**), `organization_members` (INSERT + `is_active` false→true), `client_notes` не гейтить редакцией. RPC-only таблицы (rentals через `create_rental`) — гейт в RPC достаточен, если INSERT authenticated отозван.

Каждый edition/cap-триггер: `IF NOT editions_lifecycle_enabled() THEN RETURN NEW;` (F91).

### 18.10. `platform_runtime_flags` (DDL)

```text
CREATE TABLE platform_runtime_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- seed: key = 'editions_lifecycle', value = {"enabled": false}
-- editions_lifecycle_enabled() → COALESCE((value->>'enabled')::boolean, false)
-- RLS: ENABLE; никаких политик authenticated (как platform_notification_settings)
-- GRANT service_role only
```

Не класть другие флаги в payment config. Аудит смены — `platform_audit_log` action `platform.runtime_flag`.

### 18.11. Капы: lock + формулы

`organization_within_edition_cap(org, resource)`:

1. `PERFORM pg_advisory_xact_lock(hashtextextended(org::text || ':edition-cap:' || resource, 0));`  -- один bigint, как 2.11 venue/payroll (F92)
2. count по формуле §3.5;
3. Lite: locations/disciplines `count < 1` для INSERT; clients `count < 200`; members `count < 8`.
4. Studio/Pro: always true (продуктового капа нет).
5. Early-return `true`, если `NOT editions_lifecycle_enabled()` (F91) — кап не режет платящих до cutover.

Вызывать из триггеров **и** из `edition_allows` для `multi_location` / `multi_discipline` (F71).

### 18.12. Триггеры: INSERT ≠ UPDATE (канон r6, F98)

Слепой `BEFORE INSERT OR UPDATE` на таблицу **запрещён**. Иначе Lite ломается на штатных 2.11 путях.

| Таблица | Когда гейтить | Когда **не** гейтить |
|---|---|---|
| `subscriptions` | INSERT (продажа, в т.ч. leftover `.insert`) | UPDATE `lessons_left` / статуса от `mark_attendance`; freeze-колонки режет RPC freeze, не этот триггер |
| `subscription_groups` | INSERT | DELETE при откате failed insert |
| `personal_lessons` | INSERT (продажа/создание); UPDATE полей продажи (клиенты, цена, дата слота как «перенос продажи») | UPDATE от `mark_personal_lesson_attendance` / paid_amount sync |
| `locations` / `disciplines` | INSERT (кап `multi_*`) | UPDATE имени, адреса, сортировки, `is_active` |
| `clients` | INSERT; UPDATE `archived_at` NULL (restore) | UPDATE ФИО/контактов; archive (`archived_at` → not null) |
| `organization_members` | INSERT; UPDATE `is_active` false→true | UPDATE роли/профиля; деактивация |
| `prices` / junction / `expenses` | INSERT/UPDATE/DELETE | — |
| `organization_settings` | не edition-триггер: persist модулей clamp'ит RPC/хук настроек (F8) | — |

`TG_OP = 'UPDATE'` без смены капового/продажного поля → `RETURN NEW`.

### 18.13. Purge: новая сигнатура (F104)

```text
purge_single_organization(
  p_org_id uuid,
  p_actor_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_force_licensed boolean DEFAULT false,      -- НЕ открывает licensed Lite
  p_force_anti_abuse boolean DEFAULT false     -- только status=suspended
)
```

Правила (в `_purge_demo_organization_core`):

1. `status = 'licensed'` **или** live `free_lifetime` → `licensed_org_purge_forbidden`. `p_force_licensed` **игнорируется** для этого случая (r5 F70 vs старый 2.11 force).
2. live lifetime row / live month зеркало — как 2.11, по-прежнему forbidden без смысла (после 2.12 такие org licensed).
3. `status = 'suspended'` → purge только если `p_force_anti_abuse` **и** `length(trim(p_reason)) >= 8`; иначе `abuse_purge_note_required`. Audit `org.purged_abuse`.
4. `demo_active` / `demo_retention` без review-hold — как 2.11; review-hold включает Studio kind (F80).
5. Edge `dev-console-purge-org` прокидывает новое поле; UI не шлёт `force_licensed` для Lite.

### 18.14. Dual-write: XOR raising в той же TX

Любой писатель (Activate, adjust, issue key, trial_end, expire, owner_cancel):

1. Lock org row `FOR UPDATE`.
2. Cancel все **другие** raising (`trial_pro` / `studio_monthly` / `pro_monthly` / `pro_lifetime`) до INSERT нового live. Иначе unique `one_raising` (F94).
3. `free_lifetime` не трогать (кроме полного purge).
4. Зеркала §18.3 в той же TX.
5. `enqueue_calendar_sync` / venue-ack ветки смотрят уже новый `organization_active_edition()`.
6. Писатели, которые **обязаны** пройти этот протокол: Activate, preview не пишет, **adjust/extend_one_month**, issue/activate key, trial_end, expire, owner_cancel, create-manual Billing. Пропуск любого = drift F33/F113.

### 18.15. Имена 2.11.48 — не выдумывать (канон r7)

| Не писать в коде | Факт на диске |
|---|---|
| `sell_subscription` / `add_personal_lessons` / `record_expense` | `create_group_subscription`; INSERT `personal_lessons`; INSERT `expenses` |
| `dev_console_adjust_organization_edition` | `dev_console_adjust_organization_subscription` + `p_extend_one_month` |
| preview «тот же kind что UI» без SQL | `preview_activate_platform_purchase_request` режет `<> crm_subscription` |
| `upsert_renter` как единственный create | ещё `create_renter` (GRANT жив) |
| `useAddPersonalLessons.ts` | хук в `usePersonalLessons.ts` |
| `tangodb/src/lib/paymentQuote.ts` | канон `platformPaymentContract.ts`; Edge re-export `_shared/paymentQuote.ts` |
| issue-key как единственный Keys-путь | ещё `dev-console-generate-key`; consume = `activate_access_key` |
| `PurchaseQuoteSku` без Studio | `parsePurchaseQuoteSku` сейчас только 2 значения |

---

## 19. Capability ↔ модуль ↔ маршрут

`OrgModules` 2.11: `group_subscriptions`, `personal_lessons`, `pair_subscriptions`, `trio_lessons`, `multi_discipline`, `locations`, `finance_basic`.

| Маршрут / UI | Модуль JSONB | Capability | Lite | Примечание |
|---|---|---|---|---|
| `/` дашборд операционный | — | — | да | без финансовых виджетов; HallRentalDashboardBlock ⊂ `hall_rent` |
| `/` дашборд финансовый | `finance_basic` | `finance` | нет | `useFinance*` не звать |
| `/attendance` | — | `attendance` | да | roster; reception ok |
| `/schedule` | — | `schedule` | да | create rental/event/personal по другим cap |
| `/clients` | — | `clients` | да | кап; CTA «Продать» ⊂ capabilities |
| `/renters` | ~~`locations`~~ **снять** | `hall_rent` | нет | 2.11.48 ошибка маппинга; payout с карточки — исключение §3.2 |
| `/subscriptions` | `group_subscriptions` | `group_subscriptions` | нет | история read, если строки; waitlist RPC ⊂ Studio+ |
| `/subscriptions/sell` | `group_subscriptions` | `group_subscriptions` | нет | |
| `/personal` | `personal_lessons` | `personal_lessons` | нет* | отметка уже созданной — `attendance`; *карточка read + future delete occupancy |
| `/personal/sell` | `personal_lessons` | `personal_lessons` | нет | `?action=sell` с сетки |
| `/prices` | — (дыра) | `prices` | нет | |
| `/prices?section=hall-rent` | — | `hall_rent` | нет | Studio: вкладка скрыта |
| `/finance` | `finance_basic` | `finance` | нет | |
| `/finance/payments` | `finance_basic` | `finance` | нет | журнал платежей — Pro UI; SELECT операционных `payments` на Studio жив (F97), этот экран нет |
| `/finance/revenue` | `finance_basic` | `finance` | нет | |
| `/finance/corrections` | `finance_basic` | `finance` | нет | operational void/correct — карточки Studio; этот экран ⊂ Pro |
| `/finance/payroll` | `finance_basic` | `payroll` | нет | early-return `isTeacherPayrollOnly` (F124) |
| `/finance/debtors` | `finance_basic` | `finance` | нет | |
| `/finance/rental-accruals` | — | `hall_rent` | нет | |
| `/finance/rental-inbox` | `finance_basic` | `hall_rent` | нет | early-return `isRentalInboxOnly` (F124) |
| `/finance/renter-topup` | — | `hall_rent` | нет | `useFinanceRentalScreensEnabled` сегодня `addonActive` (F117) |
| `/finance/expenses` | `finance_basic` | `finance` | нет | |
| `/settings/team` | — | — | да | кап членов + pending invites |
| `/settings/general` | — | — | да | |
| `/settings/organization` | — | — | да | чекбоксы модулей clamp |
| `/settings/subscriptions` | `group_subscriptions` | `group_subscriptions` | нет | freeze |
| `/settings/disciplines` | `multi_discipline` | `multi_discipline` | просмотр 1 | INSERT 2-го — cap/forbidden |
| `/settings/locations` | `locations` | `multi_location` | просмотр 1 | |
| `/settings/hall-rent` | — | `hall_rent` | нет | venue-cost ⊂ Pro; accountant NAV-1 резать **выше** `can()` |
| `/settings/data` | — | `export_operational` / `export_financial` | нет / нет | Studio: только operational; Pro: оба |
| `/settings/integrations` | — | `google_calendar` | нет | сейчас любой role видит пункт |
| `/settings/license` | — | — | да | всегда; `license.purchase` owner/director; Stripe waitlist-карточка не = group waitlist |
| `/license-required` | — | — | нет | только `suspended` / legacy retention |
| `/activate-key` | — | — | да | пишет `pro_lifetime` |
| Офлайн-журнал | — | `offline_attendance` | нет | Pro only |
| Тулбар «Аренда» | ~~`locations`~~ | `hall_rent` | нет | `SchedulePageContainer` |
| «+ Персональный» | `personal_lessons` | `personal_lessons` | нет | |
| «+ Мероприятие» | — | `calendar_events` | нет | |
| Support widget / guest tickets | — | — | да | все редакции |
| FirstDayChecklist «продайте абонемент» | — | `group_subscriptions` | скрыть | |

Nav: `editionAllows ∩ module ∩ canAccessPanel`. JSONB выкл → скрыть даже на Pro (владелец так захотел). Edition выкл → upsell, даже если JSONB true.

Fallback ролей на Lite **и Studio** (F110/F123/**F124**): accountant → **upsell Pro** (нет `clients.read` / `subscriptions.read`; не `/finance`, `/renters`, `/prices`, `/settings/hall-rent`). Reception → `/attendance`. Teacher не `/finance/payroll`. Пересечь **`findFirstEnabledAccessiblePanelPath`** (в т.ч. early-return payroll/rental-inbox) **и** **`findFirstAccessiblePanelPath`** (NAV-1) **и** **`findFirstAccessibleSettingsSection`** с `editionAllows`; пустой intersection = upsell, не 500. `canAccessFinanceNav` ⊂ edition.

---

## 20. Контракт оплаты schemaVersion 3

Канон (JSON):

```text
{
  schemaVersion: 3,
  pricingRevision: number,          // CAS Dev Console
  crmLifetime:  { amount, currency },
  crmMonthly:   { amount, currency },   // Pro month — SKU crm_subscription
  crmStudioMonthly: { amount, currency },
  crypto[], bankTransfer, vietnameseBankTransfer, mir, contacts,
  renterMiniappAddon?
}
```

Резолв суммы:

| SKU | Канон | Override на способе |
|---|---|---|
| `crm_license` | `crmLifetime` | `amount` / `currency` |
| `crm_subscription` | `crmMonthly` | `monthlyAmount` / `monthlyCurrency` |
| `crm_studio_subscription` | `crmStudioMonthly` | `studioMonthlyAmount` / `studioMonthlyCurrency` |

Fail-closed: битый SKU, нет канона для этого SKU, валюта вне allowlist, нет способа. Клиент **не** шлёт сумму и не шлёт `request_kind`.

Коды резолва: нет `crmMonthly` → `monthly_not_configured` (как 2.11); нет `crmStudioMonthly` → **`studio_not_configured`**. Не подставлять `crmMonthly` в Studio.

Override: отсутствие `studioMonthlyAmount` на способе → канон `crmStudioMonthly`, **не** `monthlyAmount` этого способа.

`parsePaymentConfig` v2 (нет `crmStudioMonthly`, `schemaVersion` 2) = валидный конфиг. `resolveSkuPrice('crm_studio_subscription')` на v2 = fail-closed.

`parsePurchaseQuoteSku` / `PlatformPaymentSku` / `PurchaseQuoteSku` сегодня **без** Studio — расширить в той же волне, что CHECK quotes (F118). Иначе Edge `create-purchase-quote` вернёт `invalid_sku` до SQL.

`?plan=monthly` → `crm_subscription`. `?plan=studio` → `crm_studio_subscription`. `?plan=lifetime` → `crm_license`. Неизвестное `?plan=` игнорировать, не мапить на monthly.

`PurchasePlanPrefill` расширить `'studio'`. `STUDIO_PURCHASE_PATH = "/settings/license?purchase=1&plan=studio"`. T−7 Studio ведёт сюда, T−7 Pro — как сейчас на `MONTHLY_PURCHASE_PATH`.

---

## 21. Слои гейтов (не смешивать)

Один факт не заменяет другой. Баги 2.11/черновика r1 почти все из смешения.

| # | Слой | Отвечает на | Где правда |
|---|---|---|---|
| 1 | `organizations.status` | жива ли орг | `demo_active` / `licensed` / `suspended` / `purged` (+ legacy `demo_retention`) |
| 2 | `schema_version_locked` | можно ли схему писать | **колонка**, не status |
| 3 | `effective_ceiling` | что оплачено (max phase IN active/past_due) | функция над `organization_entitlements` (**time-aware**, не сырой `status`) |
| 4 | `active_edition` | какой каталог сегодня | **функция** `organization_active_edition()`: clamp колонки state к raising phase=`active`; вверх запрещён с одним past_due. Колонка state может отставать от cron |
| 5 | `edition_allows(capability)` | можно ли **этот** write | каталог функции (4); плюс триггеры таблиц §18.9 |
| 6 | `organization_settings.modules` | что владелец спрятал в меню | JSONB ⊂ каталога |
| 7 | RBAC `can()` / RLS | кто в команде | роль + scope; NAV-1 не ломать внутри `can()` |
| 8 | UI `isReadOnly` | серый баннер на **всю** CRM | demo retention / expired demo / `purged` (если UI). **Не** month, **не** Lite, **не** `suspended` (recovery — `/license-required`). Снять month-lock — **E2 (F108)**, можно до флага. Grace CTA — **отдельный** баннер (F122), не `ReadOnlyBanner`. Не путать с Lite SQL-writes (слой 9) |
| 9 | `editions_lifecycle` | какой **persist-cron** и включён ли write-path 2.12 | `platform_runtime_flags`. При **off**: write = 2.11; Activate Studio → `editions_lifecycle_off` (F52). При **on**: time-aware касса, Lite writes, expire→Lite, demo→Lite. **Не** «касса time-aware даже при off» (это было r5 и даёт F91) |

Paid write = (1)(2) `organization_allows_writes` ∧ (5) `edition_allows`. На grace (флаг on) функция (4)=lite → касса закрыта, журнал открыт. **Не** добавлять слой 10 `period_open`. При флаге off слой 5 не режет (no-op).

---

## 22. Cutover runbook (Dev Console + БД)

Порядок на production:

1. **E1 на staging (E1a→E1b→E1c закрыты):** миграции таблиц, time-aware хелперы, backfill каждой non-purged org, XOR raising, триггеры с wrap флага, SQL-тесты (F70/F75/F77/F78/F79/F80/F91/F92/F94/F98/F109/F113/F114/F118). Флаг **off**. CRM со старым UI — платящие = Pro на write-path, ничего не заметили (бейдж в DC допустим).
2. Прогнать отчёт Dev Console: все lifetime/month → ceiling pro; список `suspended` «needs review»; `demo_retention` → кандидаты в Lite; **licensed Lite не purgeable**; Metrics ещё могут быть старыми — не блокер E1.
3. **Payment methods v3** на staging (`crmStudioMonthly` заполнен, override-поля формы консоли живы — F90) **до** продажи Studio; Pro quote smoke на v2-конфиге (backward read). `parsePurchaseQuoteSku` уже знает Studio.
4. Задеплоить **E2–E9** **при флаге off**. Persist expire/purge ещё 2.11 до п.6. **E2 (F108/F122/F123/F124):** снять month-lock в `isReadOnly` **и** вынести grace-баннер из `ReadOnlyBanner` — **нужно** до флага (иначе после Activate Studio / cancel month серая CRM **или** нет CTA renew); это **не** открывает Lite SQL-writes. Early-return payroll/rental-inbox и settings-index ∩ edition. **E5** occupancy — иначе leftover аренда с демо ломает сетку Lite. **E9** demo→Lite persist готов, но не активен пока off. **Не** Activate Studio на prod, пока флаг off **и** не закрыто: Mini App helper (F52), Inbox `rowKind` **и** `isMonthly` (F76/F93), **SQL preview/Activate `IN`** (F109), review-hold Studio (F80), edition-триггеры (F75) **и** INSERT≠UPDATE (F98), venue-ack skip (F95), GCal enqueue no-op (F96), adjust wrap + extend (F113), notification CASE (F114), accountant fallback (F123), teacher payroll (F124), roster **E4**. SQL Activate Studio при off → `editions_lifecycle_off`.
5. Смоук E11 на staging с флагом **on**: time-aware касса без ручного cron; demo 31-й день; roster; accountant fallback **Lite и Studio** (upsell Pro, не `/clients`); teacher Lite не payroll (F124); grace-баннер без isReadOnly; флаг **снова off** на копии — expire снова 2.11 (регресс F91).
6. Production: включить `editions_lifecycle` галкой Billing + audit **только после E1–E9 и зелёного E11**. Сразу проверить: один expire tick на копии; demo 31-й день; licensed Lite пишет журнал; purge licensed Lite → 403 (SQL **и** Tenants UI F73); `force_anti_abuse` не открывает Lite; Mini App на Studio → addon false (F74); Inbox Studio ≠ lifetime, preview не `preview_month_only` (F93/F109); Billing extend двигает entitlement; bot не пишет «Lifetime» на Studio.
7. Откат флага: persist-cron снова 2.11 suspend; триггеры/RPC снова no-op 2.12. Entitlements **не удалять**. Не оставлять org в `licensed` Lite без `free_lifetime`. Откат **не** должен оставить Lite-writes открытыми при off.

Запрещено: включать флаг до **E1–E9**, до патча `renter_miniapp_addon_is_active` + `organization_allows_writes` + DELETE licenses на cancel (не во время grace), до Inbox rowKind **и** `isMonthly` **и** SQL preview/Activate `IN`, до PostgREST-триггеров с §18.12, до XOR raising, до wrap adjust, до F122 grace-баннера, до F123 accountant upsell, до F124 payroll/rental-inbox/settings-index.

После кода: `architecture.md`, `decision_log.md` VER-1 2.12, `changelog.md`, этот файл — чекбоксы очереди в шапке и в §16 «Последовательность промптов».
