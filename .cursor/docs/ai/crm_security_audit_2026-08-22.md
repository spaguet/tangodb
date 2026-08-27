# Аудит безопасности CRM TangoDB

**Дата:** 2026-08-22  
**Повторный проход:** 2026-08-22 (дополнение: RLS-обходы RPC, лицензия/демо через `UPDATE organizations`, write/delete клиентов преподавателем, PII команды, enumeration, recovery-code, payments GRANT).  
**Третий проход:** 2026-08-22 (reception `restricted_admin` обходит R6 через REST; эскалация `scope`/`meta` в `organization_members`; мёртвые org-флаги в SQL; Turnstile fail-open; уточнение H11).  
**Четвёртый проход:** 2026-08-22 (прямой REST на `attendance`/`subscriptions` минует RPC; director обходит `directors_can_mark_attendance`; teacher правит уроки/слоты других преподавателей; `expenses` без закрытого периода; PII заметок/waitlist/invite `token_hash`).  
**Пятый проход:** 2026-08-22 (прямой REST на rental billing / payroll settlements / `payments` / `personal_lessons.paid`; `subscription_groups` teacher; `single_visits` admin; operational правка любых `client_notes`; `audit_log` leadership).  
**Шестой проход:** 2026-08-22 (кросс-тенант `expire_monthly_subscriptions`; teacher читает финансы `calendar_events`; REST на rental series/арендаторов; `FOR ALL` на `personal_lessons` обходит R4 и `can_edit_past_schedule`; SECURITY DEFINER без membership; CSV formula injection; waitlist/classes REST; `restate_personal_lesson_amount` без закрытого периода).  
**Седьмой проход:** 2026-08-22 (`finish_subscription` / freeze RPC без `teachers_can_sell_subscriptions`; REST `price_disciplines` / `price_teacher_members` обходит `can_manage_prices`; `preview_calendar_event_conflicts` PII; `subscription_member_changes` для любого member; `organization_subscriptions` billing oracle; `update_payment_in_place` без закрытого периода).  
**Восьмой проход:** 2026-08-22 (кассовый период только на аренде — **H29**; teacher `personal_lesson_charges.billed_amount` — **H30**; licenses/freeze SELECT member; rental occupancy teacher; Storage без RPC; уточнение M44: `storno`/`correct_payment` тоже без периода).  
**Девятый проход:** 2026-08-22 (`migrate_organization_version` spoof `p_actor_user_id` — **H31**; teacher читает `single_visits.amount` — **H32**; DEFINER без `REVOKE PUBLIC`; GCal labels без scope; Storage `exports`; `teacher_pay_rates` REST; version_migrations SELECT; payroll line items R4; own pay rules; gap-ack oracle).  
**Десятый проход:** 2026-08-22 (хук **копирует** `platform_role` в JWT — **H33**, L23 был неверен; `list_archived_prices` sales_count teacher — **M57**; invite token в `sessionStorage` — **M58**; teacher `close_group_lesson_occurrence` с произвольным `attendee_count` → venue cost — **M59**; SPA сама зовёт `apply_scheduled_subscription_member_changes` — уточнение **M34**; leftover v1 `allowed_users` — **L26**; `window.open` без `noopener` — **L27**; `get_venue_cost_rule_status` без финансовой роли — **L28**; уточнение **H31**).  
**Сверка документа с кодом:** 2026-08-22 — ошибки, дубли, устаревшие формулировки и **регрессии промптов S\*** (буквальный REVOKE ломает SPA/RLS). Находки C1/H\* по SQL и Edge **подтверждены**; менять — errata ниже и текст S01–S40. Код продукта не менялся.  
**Повторная сверка (тот же день):** хуки `usePersonalLessons` / `useAddSubscription` / `useSchedule` / `OrganizationProvider` / `AuthProvider` / `usePlatformPaymentConfig` / view `personal_lessons_teacher_v`. Новые регрессии: **S09** (сетка teacher читает base `personal_lessons`; REST UPDATE урока в SPA нет), **S08** (rollback `.delete()` мёртвый — DELETE можно снять), **S27** (нет GRANT SELECT / disciplines / client_notes), **S34** (`security_invoker=true` убивает masking views), **S05** (триггер по `auth.uid()` убивает DEFINER RPC), **S12** (GoTrue captcha до S37 ломает signup), **S18** (запрет `list_archived_prices` teacher), **S39** (SELECT кошельков нужен SPA).  
**Третья сверка (тот же день):** view персоналок, `finish_subscription`, эмбед мастер-классов, GRANT SELECT, `organization_settings.select(*)`. Новое: **H26/S09** ссылались на устаревший `20260711000001` (`client_id4` уже в `20260718000001`); **H27** приписывал актуальный `finish_subscription` вызов waitlist-notify, которого нет; **H24/S17** — teacher-сетка недели сама запрашивает `income_amount`; **S27** «и т.д.» роняет GCal/должников/отмены/payroll; **S39** column-REVOKE при `select("*")` белый экран; **H13** в таблице «Приоритет» ошибочно волна 1 (чинится S05).  
**Четвёртая сверка (тот же день):** касса/журнал vs S16/S18/S39. Новое: **L28** «только financial» убивает `checkVenueRuleBeforePayment`; **H30/S18** DROP `personal_lesson_charges` роняет должников сетки и оплату персоналки; **H32/S16** `useSingleVisits` в журнале селектит `amount`; **M43/M45** «SELECT только owner» vs `OrganizationProvider`; **H5** Captcha ≠ S12; **H10** выдуманный RPC `organizations.name`. Находки SQL/Edge подтверждены. Код продукта не менялся.  
**Пятая сверка (2026-08-26):** таблица порядка **S12** и чеклист Dashboard всё ещё требовали Captcha Auth (регистрация 400 до S37); **S09** «SELECT `payments` только финансовым ролям» роняет операционный дашборд admin и даёт 403 кассе teacher; teacher view / `personalLessonsSelectTeacher` **без `price_id`** — `PayPersonalLessonModal` не резолвит архивный тариф; **S39** неполный список колонок `organization_settings` (`org_preset`, `terminology`, `directors_can_*`). Находки SQL/Edge подтверждены. Код продукта при той сверке **не** менялся; версия в шапке «2.8.72» к этой дате уже была **устаревшей** (2.8.73/2.8.74 — 2026-08-23).  
**Шестая сверка (2026-08-26):** код `APP_VERSION` **2.8.75**; хвост миграций **`20261002000001_personal_charge_net_payment_indexes.sql`**, не `20260930000002`. После аудита: `write_off_personal_lesson_debt` / `get_personal_lesson_debt_trace` (**2.8.73**) — DEFINER, `can_read_financial()`, **без** `_is_finance_period_closed` (тот же класс, что **H29**/M37, не новый ID). Промпт S\* с timestamp `> 20260930000002` встал бы **между** уже существующими `20260931`/`20261001`/`20261002`. **S22** ковровый REVOKE EXECUTE у `authenticated` убивает кассу и списание долга. **S19** один хук `useTeamMembers` без разделения — либо мёртвая карточка сотрудника, либо PII в roster. **S34** `security_invoker=true` на `financial_debtors_v` после S09 — страница дебиторов accountant падает, если нет SELECT на base. Находки C1/H\* по SQL и Edge **подтверждены**. В этом прогоне код продукта не менялся.  
**Седьмая сверка (2026-08-26):** код `APP_VERSION` **2.8.76**; хвост миграций **`20261003000001_gcal_sync_token_cache_and_claim_org.sql`**. С шестой сверки продукт сдвинулся (GCal: кэш access token, org-scoped claim). **Не** новая утечка: `user_google_accounts.encrypted_access_token` — таблица по-прежнему `REVOKE ALL` у `anon`/`authenticated` (как refresh-token); `claim_calendar_sync_jobs(int,text,int,uuid)` GRANT только `service_role`; `calendar-sync-kick` проверяет активное членство в `organization_id` из body до drain. Промпт S\* с timestamp `≤ 20261002000001` встанет **перед** уже существующим `20261003`. **S39/L21** ошибочно: хуки bindings **не** селектят колонку `last_error` (на `member_google_calendar_bindings` / `organization_google_calendar_bindings` её **нет** — только `last_error_code` / `last_error_at`); текст ошибки Google — `google_calendar_event_links.last_error` и RPC урока (**L24**). **S04**: `is_dev_console_operator()` читает `auth.users.raw_app_meta_data`, не JWT — снятие `platform_role` из claim **само** не закрывает UPDATE кошельков. **S27**: `renter_documents` SELECT нужен `bindUploadedRenterDocument` (lookup по `storage_path`); payroll UI читает `teacher_settlements` / `teacher_settlement_payments` / `teacher_pay_rates` (после S10 — только SELECT). Находки C1/H\* по SQL и Edge **подтверждены**. В этом прогоне код продукта не менялся.  
**Проверка production:** 2026-08-22 — `\dp` через `supabase db query --linked` на проект `tangodb` (`gizfpiujqjwbjtqfstbj`, ap-southeast-1); **M31 подтверждён**; **M32** (GRANT ALL у `anon`). Привилегии **функций** (`has_function_privilege` / `\df+`) на production **не** снимались — **M49**.
**Версия CRM:** `2.8.76` (`tangodb/src/lib/appVersion.ts`, `tangodb/package.json`)  
**Область:** `tangodb/` (SPA, хуки, Edge Functions, RLS/миграции), `tangodb-dev-console/`, `tangodb-landing/` (конфиг/ключи).  
**Метод:** статический разбор кода, политик RLS, `config.toml`, публичных Edge Functions. Боевой пентест, перехват трафика и проверка **production**-настроек Auth в Dashboard **не выполнялись**.  
**Ограничение:** `tangodb/supabase/config.toml` описывает **локальный** стек. Часть пунктов ниже помечает «если production совпадает с config.toml» — это нужно сверить в Supabase Dashboard.  
**Промпты починки:** раздел **«Промпты реализации»** в конце файла. **Тебе копировать в чат** — подраздел **«Тексты для нового чата»**. Длинные блоки `#### S01`…`S40` — инструкция агенту (он читает их сам). Порядок **S01 → S40**, без прыжков. H1 в очередь не входит.

Стиль: только то, что подтверждено в коде. Не включены пожелания «можно улучшить», если нет реалистичного вреда. Пункты **H9–H11**, **M13–M19**, **L9–L11** добавлены вторым проходом; **H12–H13**, **M20–M22**, **L12–L13** — третьим; **H14–H16**, **M23–M27**, **L14–L15** — четвёртым; **H17–H22**, **M28–M32**, **L16** — пятым; **H23–H26**, **M33–M40**, **L17–L19** — шестым; **H27–H28**, **M41–M44** — седьмым; **H29–H30**, **M45–M48**, **L20–L22** — восьмым; **H31–H32**, **M49–M56**, **L23–L25** — девятым; **H33**, **M57–M59**, **L26–L28** — десятым; C1/H5/H7/H11/H15/H22/H24/H26/H27/H31/M1/M5/M10/M21/M34/M44/L21/L22/L23 уточнены. Сверка документа (errata, регрессии S\*) — после таблицы «Кратко» (четыре прохода 2026-08-22 + пятый–**седьмой** 2026-08-26).

---

## Кратко

| Серьёзность | Кол-во | Суть |
|-------------|--------|------|
| Критичные | 1 | Принятие приглашения **сбрасывает пароль уже существующего** `auth.users` и выдаёт сессию тому, у кого есть ссылка |
| Высокие | 33 ID (H1 — продукт, не баг) | Демо без купленного ключа (**H1**, воронка); демо-ключ в JSON; JWT в `localStorage`; нет CSP; слабый пароль Auth; in-memory rate limit; преподаватель читает PII клиента; инсайдерский экспорт; **director → owner (H9)**; **PATCH `demo_expires_at` (H10)**; **преподаватель пишет клиентов (H11)**; **reception = full admin (H12)**; **scope/meta эскалация (H13)**; **прямой REST на `attendance` минует RPC (H14)**; **прямой UPDATE `subscriptions` / `lessons_left` (H15)**; **teacher правит уроки/слоты других преподавателей (H16)**; **rental billing REST write (H17)**; **payroll settlements REST write (H18)**; **payments REST без флага/периода (H21)**; **personal_lessons `paid` без RPC (H22)**; **кросс-тенант `expire_monthly_subscriptions` (H23)**; **teacher читает финансы `calendar_events` (H24)**; **REST rental series/арендаторы (H25)**; **`FOR ALL` personal_lessons обходит R4 и прошлые даты (H26)**; **finish/freeze RPC без `teachers_can_sell_subscriptions` (H27)**; **REST `price_disciplines` / `price_teacher_members` обходит `can_manage_prices` (H28)**; **кассовый период только на аренде (H29)**; **teacher читает `personal_lesson_charges.billed_amount` (H30)**; **spoof `p_actor_user_id` в `migrate_organization_version` (H31)**; **teacher читает `single_visits.amount` (H32)**; **developer JWT открывает platform-таблицы всех тенантов (H33)** |
| Средние | 59 ID (M19 ⊂ H21; M30 = H19) | UI-гейты ≠ API; офлайн IndexedDB; `invite_url`; короткий invite-token; `verify_jwt=false`; `security_invoker=false`; `access_keys` SELECT; GraphQL; нет MFA; сессии без timebox; Turnstile только в UI; утечка ошибок; **PII коллег (M13)**; enumeration; `redirectTo` сброса; invite → confirmed user; recovery-code в JSON; waitlist org без membership; PATCH `payments` (**M19**, после M31 то же, что **H21**); Turnstile fail-open; мёртвые org-флаги; JWT в complete-invite; **expenses без закрытого периода (M23)**; **все заметки клиентов для admin (M24)**; **invite `token_hash` в REST (M25)**; **waitlist всей орг для teacher (M26)**; **director attendance flag только в RPC (M27)**; **operational правка любых заметок (M28)**; **audit_log с полными diff (M29)**; **subscription_groups teacher (M30 = детализация H19)**; **auto-expose ALL на production (M31)**; **GRANT ALL у `anon` (M32)**; **CSV formula injection (M33)**; **SECURITY DEFINER без membership (M34)**; **waitlist REST write (M35)**; **classes/locations REST (M36)**; **restate amount без периода (M37)**; **preview_rental_conflicts PII (M38)**; **SITE_URL fallback vercel.app (M39)**; **`admin_can_edit_schedule` только в RPC (M40)**; **`subscription_member_changes` для любого member (M41)**; **`preview_calendar_event_conflicts` PII вне scope (M42)**; **`organization_subscriptions` billing oracle (M43)**; **`update_payment_in_place` без закрытого периода (M44)**; **`organization_licenses` любому member (M45)**; **freeze periods любому member (M46)**; **teacher видит все аренды недели (M47)**; **Storage renter-documents без RPC (M48)**; **DEFINER без `REVOKE PUBLIC` (M49)**; **GCal labels без scope (M50)**; **Storage `exports` без `can_export_data` (M51)**; **`teacher_pay_rates` REST (M52)**; **version_migrations SELECT member (M53)**; **payroll line items R4 (M54)**; **own pay rules teacher (M55)**; **venue gap-ack oracle (M56)**; **`list_archived_prices` sales_count (M57)**; **invite token в sessionStorage (M58)**; **teacher close group с произвольным attendee_count → venue cost (M59)** |
| Низкие | 28 ID (L16 ⊂ M29; L23 не находка) | Хардкод email разработчика; `ACTIVATION_DEBUG`; Telegram без SRI; no-op webhook compare; `x-cron-secret` в CORS; cron-секрет не constant-time; `crm_product_versions`; исходники SPA; recovery-сессия = полный JWT; auto-expose; freebusy коллег; пустой `ALLOWED_ORIGINS`; landing rate limit OK; **developer bypass лимита демо (L14)**; **все тарифы readable teacher (L15)**; **audit_log leadership (L16 = отсылка к M29)**; **devAuth JWT без verify (L17)**; **settings SELECT всем членам (L18)**; **refresh token reuse 10s (L19)**; **`extra_search_path` включает `extensions` (L20)**; **GCal `last_error` у director (L21)**; **platform payment methods всем authenticated (L22)**; **L23 superseded H33 (не уязвимость)**; **GCal `last_error` у teacher (L24)**; **Realtime включён (L25)**; **leftover v1 `allowed_users` (L26)**; **`window.open` без `noopener` (L27)**; **`get_venue_cost_rule_status` без финансовой роли (L28)** |

**Ответы на прямые вопросы аудита**

| Вопрос | Ответ |
|--------|--------|
| Можно ли пользоваться CRM **без купленного ключа доступа**? | **Да, так задумано:** self-service demo на 30 дней после регистрации (Turnstile + `create-self-service-demo-org`). Запись после истечения демо режется SQL (`organization_allows_writes`) — **если не обойти H10** (`PATCH organizations.demo_expires_at`). Чтение данных остаётся до purge. |
| Можно ли **скачать/скопировать данные**? | **Да, для любого авторизованного участника орг.** UI-экспорт CSV — удобство. Тот же объём (и больше, пагинацией) доступен через PostgREST + JWT. Офлайн-снимок в IndexedDB. Документы арендаторов в Storage. |
| Можно ли **скачать/скопировать само CRM**? | **Клиент — да** (Vite SPA, JS в браузере). **Сервер (RLS, Edge Functions, pepper, service_role) из браузера — нет.** Полноценный клон продукта требует git-репозиторий и секреты бэкенда. |

---

## Сверка документа с кодом (2026-08-22, доп. 2026-08-26)

Прочитаны актуальные миграции, Edge Functions и хуки `tangodb/` (`APP_VERSION` **2.8.76**). **Находки C1 / H2–H33 / M\* по SQL и Edge подтверждены** (кроме помеченных ниже дублей и устаревших фраз). Менять нужно **текст аудита и промпты S\***: буквальный REVOKE / триггер / `security_invoker=true` / неполный GRANT SELECT / column-REVOKE при `select("*")` / запрет `get_venue_cost_rule_status` кассиру / Captcha Auth в S12 / SELECT `payments` «только financial» / ковровый REVOKE EXECUTE у `authenticated` / миграция с timestamp меньше `20261003` ломает SPA. Кэш GCal access token (2.8.76) **не** открывает токен клиенту. Код продукта при этой сверке не менялся.

ID **не перенумеровывались** (ссылки S\* живы). Дубли оставлены с пометкой, чтобы не ломать «закрывает M30».

### Что в находках было неверно или устарело

| Где | Ошибка | Как есть в коде |
|-----|--------|-----------------|
| **H23** | «единственный найденный RPC, который пишет чужой тенант» | После девятого прохода то же класс у **H31** (`migrate_organization_version`). Кросс-тенантный write без членства: H23 **и** H31. |
| **H23 / S02** | Создаётся впечатление, что RPC зовёт SPA; «чинить cron'ом» | В `tangodb/src` вызова **нет** (только типы). `PERFORM expire_monthly_subscriptions(v_org_id)` идёт из **DEFINER** `mark_attendance`, freeze, partner-replacement. Cron Edge тоже **не** вызывает. |
| **M19** | Отдельная «если GRANT ALL» | На production ALL подтверждён (**M31**). Это тот же контур, что **H21**. Чинить один раз (S09). |
| **M30** | Отдельная средняя | Детализация **H19** (те же политики `subscription_groups_*_teacher`). |
| **L16** | Отдельная низкая | Отсылка к **M29** (`audit_log_select_leadership`). |
| **L23** | Считался низкой находкой | Не уязвимость: ошибочный вывод девятого прохода, superseded **H33**. |
| **H1** в счётчике «Высокие: 33» | Читается как 33 бага | H1 — продуктовая воронка, в S\* не входит. Багов высокого класса к починке: **H2–H33**. |
| **H29 / S11** vs комментарий колонки | S11: «коррекции тоже режет период» | В `organization_settings.finance_period_closed_until` задумано: дата ≤ порога → **correction path**. Запрет `storno`/`correct` в закрытом месяце — смена продукта, не «как в комментарии к колонке». |
| **S06 DoD** «смена названия школы» | Как будто SPA пишет `organizations.name` | Имя в UI — `organization_settings.branding_name` (`GeneralSettingsPage`). `organizations.name` меняет онбординг RPC. Прямого `.from("organizations").update` в SPA **нет**. |
| **H16** | Только «sabotage» | `teacher_can_access_lesson`: свой `teacher_member_id` **или** та же дисциплина (+ локация). Подмена коллеги по REST — да; запрет `teacher_member_id = auth_member_id()` на write отрежет и **замену преподавателя в своей дисциплине**, если это штатный UX. |
| **H15 / S08 DELETE** | «не отзывать DELETE, пока в хуке rollback `.delete()`» | Rollback **недостижим**: если `scheduleGroupIds.length > 0`, хук всегда идёт в `create_group_subscription` и `return`. Ветка INSERT + `subscription_groups` + `.delete()` не выполняется. **REVOKE DELETE** на `subscriptions` SPA не ломает; оставлять DELETE = дыра H15 открыта. INSERT private/package **нужен**. |
| **H22 / S09 UPDATE** | S09 оставляет REST UPDATE/DELETE на `personal_lessons` | В `tangodb/src` нет `.from("personal_lessons").update/.delete`. Правка — `update_personal_lesson` RPC, удаление — `delete_personal_lesson`. REST UPDATE = снова H16/H22/H26. Нужны INSERT (продажа) и SELECT (не-teacher / view). |
| **H26 / SPA** | View «без `client_id4`», актуально `20260711000001` | Teacher-сетка **сама** обходит view: `usePersonalLessons({ excludeCancelled: true })` читает **base**, потому что во view **нет `cancelled_at`**. `client_id4` **уже есть** (`20260718000001`). `personalLessonsSelectTeacher` просит `client_id4` и **не** просит `cancelled_at` и **не** просит `price_id`. Снять SELECT из `FOR ALL` без `cancelled_at`+`price_id` на view + перевода хука = пустое расписание и модалка оплаты без архивного тарифа. |
| **S05 триггер** | «если не service_role / не DEFINER — запрет менять role/scope/meta» через `auth.uid()` | `SECURITY DEFINER` **не** обнуляет `auth.uid()`. Триггер «есть JWT → отказ» убивает `update_team_member`, `ensure_own_member_profile`, accept-invite. Нужен `SET LOCAL` флаг из RPC или проверка `current_user`, не `auth.uid()`. |
| **S12 vs S37** | Включить GoTrue captcha в `config.toml` в волне 1 | `AuthProvider.signUpWithEmail` зовёт `supabase.auth.signUp` **без** captcha-токена (M9 чинится в S37). Captcha Auth в S12 = регистрация 400 до S37. |
| **S18 / M57** | «teacher лучше не этот RPC» | `useArchivedPrices` → `list_archived_prices` в `EditLessonPopup` / `PayPersonalLessonModal` (резолв архивного тарифа). Forbidden RPC = не находится тариф при оплате. Убрать `sales_count`, EXECUTE оставить. |
| **S34 / M5** | `security_invoker = true` на всех tenant view | Masking views R4 работают правами владельца как раз потому, что teacher **не** имеет SELECT на base (`DROP personal_lessons_select_teacher`). Invoker=true после S09 → view не читается. |
| **S39 / L22** | Убрать `USING (true)` SELECT `platform_payment_methods` | `usePlatformPaymentConfig` в `App.tsx`, `LicenseSettingsPage`, `ManualPurchasePanel`. Без SELECT `config` нет реквизитов ручной оплаты лицензии в CRM. Резать UPDATE (H33/S04), не SELECT. |
| **Волна 0 «Приоритет» vs S09** | H16/H26 в таблице приоритета волн — волна 1 | Чинятся в **S09** (волна 0). В таблице приоритета ниже это отражено. |
| **Волна 1 «Приоритет» vs S05** | **H13** в волне 1 | Эскалация `scope`/`meta` чинится **вместе с H9 в S05** (волна 0). В таблице «Приоритет» H13 ошибочно оставался в волне 1 — исправлено ниже. |
| **H24 / SPA** | Только «UI прячет, REST нет» | `useCalendarEventsForWeek` эмбедит `calendar_events (payment_status, income_amount, paid_amount, …)` для **всех** ролей, включая teacher. Суммы мастер-классов уже в JSON сетки недели, не только в Postman. |
| **H27 / notify** | `finish_subscription` → `notify_groups_after_subscription_release` | Актуальное тело — `20260836000001`: `status='finished'`, **без** `PERFORM notify_groups_*`. Notify был в `20260834000001` и **перезаписан**. Импакт H27 — досрочное `finished` без флага продажи; waitlist при finish в текущем SQL не дергается. |
| **S15 шаг 3** | WITH CHECK на `subscriptions` UPDATE teacher | После **S08** `REVOKE UPDATE` на `subscriptions`. Шаг 3 не возвращать GRANT UPDATE; это страховка мёртвой политики, не живой REST. |
| **H5 / S12** | «Как чинить» / чеклист Dashboard: включить Captcha Auth вместе с паролем | `signUpWithEmail` не передаёт captcha token. Captcha GoTrue в S12 = регистрация 400. Captcha — **S37**. S12: пароль, confirm email, timebox, `max_frequency`, allowlist. |
| **H10 / S06** | «смена имени — RPC с whitelist / GRANT только `name`» | В SPA нет `.from("organizations").update`. Имя школы — `organization_settings.branding_name`. `organizations.name` пишет онбординг DEFINER. RPC смены name не выдумывать. |
| **H7 / S32** | DROP teacher SELECT на `clients` сразу | `useClients` / `useClientDirectory` всегда `.select("*")` с base (журнал, sale form, ФИО на сетке). Сначала view + хук, потом DROP. |
| **H29 «как чинить»** | «в каждом money-RPC» включая таблицу storno/correct | Correction path периода не читает — так задумано в комментарии колонки. S11: период на **приём** денег + `update_payment_in_place` / `restate_*`. `storno` / `correct_payment` не резать. |
| **M13 «как чинить»** | SELECT членов только `can_manage_team()` | `useTeamMembers` кормит сетку, тарифы, финансы, audit, экспорт. Без roster-view (S19) — пустые ФИО. Сужать PII после view, не DROP SELECT до него. |
| **M43 / M45 «как чинить»** | SELECT `organization_subscriptions` / `organization_licenses` только owner | `OrganizationProvider` для **каждого** члена: `license_type, activated_at, expires_at` и `plan, billing_period, status, …` (без Stripe id / `access_key_id`). `queryFn` **throw** на error SELECT → белый экран. Узкий набор колонок или RPC бандла, не REVOKE всей таблицы. |
| **H32 / S16** | Teacher view без `amount` без правки хука | `useSingleVisits` селектит `amount, method, price_id` (`AttendancePanel` журнал teacher). DROP колонок / SELECT без хука = мёртвый журнал drop-in. |
| **H30 / S18** | DROP teacher SELECT на `personal_lesson_charges` | `usePersonalLessonChargeBalances` читает `billed_amount` и `payments.amount`. Callers: `useScheduleDebtors` (блок должников на **teacher**-сетке; UI сумму прячет, запрос — нет) и `PayPersonalLessonModal`. Без хука — ошибка блока должников и оплаты персоналки. |
| **L28 / S39** | `get_venue_cost_rule_status` = та же роль, что `list_venue_cost_rule_versions` / `can_read_financial()` | `checkVenueRuleBeforePayment` → `fetchQuery(fetchVenueCostRuleStatus)` **throw** из `useRecordSubscriptionPayment` / `useRecordPersonalLessonPayment` / `useRecordSingleVisit`. Reception и teacher с продажей **не принимают оплату**. Dashboard для teacher: баннер смотрит только `data?.acknowledgementRequired` (ошибка query баннер прячет, дашборд жив) — это не оправдание резать RPC кассиру. `DashboardShell` **всегда** зовёт `useVenueCostRuleStatus`, в т.ч. teacher `scopedOnly`. `PersonalLessonSaleForm` тоже. Intel — не показывать баннер teacher; EXECUTE кассе оставить. |
| **S12 таблица порядка / чеклист Dashboard** | «Auth: … captcha …»; шаг 3 S12: включить Captcha в Dashboard | `signUpWithEmail` не передаёт captcha token. Captcha GoTrue в S12 (config **или** Dashboard) = регистрация 400 до **S37**. В таблице последовательности S12 captcha убран; чеклист Dashboard Captcha — только после S37. |
| **S09 SELECT `payments`** | «SELECT финансовым ролям» | GRANT на Postgres-роль `authenticated` один на всех JWT. «Только бухгалтеру» через GRANT нельзя. RLS сейчас `can_read_operational() OR can_read_financial()`: полный **admin** (не reception) видит кассу на операционном дашборде (`usePayments` + `payments.read.operational`). Сужение RLS до `can_read_financial()` убивает этот дашборд. Teacher строки RLS не пропускает (пусто, не 403). `REVOKE SELECT` = 403 в `usePersonalLessonChargeBalances` / `usePersonalLessonPayments` / `PayPersonalLessonModal` / `LessonInfoPopup`. Reception SELECT и так нет (`payments_select` без `can_read_reception`); UI `payments.read.operational` reception не даёт. |
| **H26 / S09 `price_id`** | View: только `cancelled_at`; «не добавлять price» | `personal_lessons_teacher_v` (`20260718000001`) **без** `price_id` и `cancelled_at`. `personalLessonsSelectTeacher` тоже **без** `price_id`. `PayPersonalLessonModal` резолвит архивный тариф по `lesson.priceId` — у teacher сейчас FK нет (оплата жива через активный каталог / ручную сумму). S09 view + teacher-select: добавить `price_id` (FK тарифа, не `price`/`paid_amount`). Иначе S18 archive-resolve не из чего брать. |
| **S39 / L18 колонки settings** | Список без `org_preset` / `terminology` / `directors_can_*` / `low_balance_threshold` / `branding_name` | `OrganizationProvider.mapSettings` читает их из `select("*")`. Явный SELECT без этих полей: терминология/пресет пустые, `directors_can_mark_attendance` молча `?? true`, нет порога низкого остатка, нет `branding_name`. |
| **Шапка / S\* timestamp** | «`APP_VERSION` 2.8.72» / «2.8.75»; хвост `20260930000002` / `20261002000001` | Актуально **2.8.76**. После `20261002000001`: **`20261003000001`** (GCal: `encrypted_access_token`, `claim_calendar_sync_jobs` + `p_organization_id`). Новая миграция S\* — timestamp **строго больше `20261003000001`**, не `20261002000002` и не `20260930000003` (встанет между уже применёнными файлами). |
| **H29 / S11 таблица RPC** | Нет `write_off_personal_lesson_debt` | RPC **2.8.73** (`20261001000001`): `SECURITY DEFINER`, `can_read_financial()`, `auth_organization_id()`, REVOKE PUBLIC есть. `_is_finance_period_closed` **нет**. Списывает AR (`billed_amount` → net paid) в закрытом месяце — тот же класс, что `restate_personal_lesson_amount` (**M37**), не сторно-строка. UI: `useWriteOffPersonalLessonDebt` / Финансы → Дебиторы. В S11 — период как у restate; **не** резать как correction path. Новый M-ID не заводили. |
| **S22 шаг 5** | «REVOKE ALL FUNCTIONS … затем явный GRANT SPA» | Текст допускает ковровый REVOKE EXECUTE у `authenticated`. Это убивает `mark_attendance`, `record_*`, `write_off_personal_lesson_debt`, `set_active_organization`, RLS-хелперы. REVOKE только `PUBLIC`/`anon`. GRANT у `authenticated` на живые RPC **не** снимать. |
| **S19 `useTeamMembers`** | «перевести хук кроме TeamSettings / MemberProfileModal» | Это **один** хук на 15+ callers. `MemberProfileModal` хук **не** зовёт — член приходит пропсом с `TeamSettingsPage`. Без второго хука (`useTeamMembers` = roster, `useTeamMembersFull` = PII для страницы команды) либо карточка сотрудника без телефона/scope, либо roster снова с PII. |
| **S39 / L21 bindings** | «хуки селектят `last_error`, `last_error_code`, `last_error_at`» | `fetchMemberGoogleBinding` / `fetchOrganizationGoogleBinding` селектят **`last_error_code` и `last_error_at`**, не `last_error`. Колонки `last_error` на этих таблицах **нет**. Текст: `google_calendar_event_links.last_error` (REST director — L21) и RPC `get_personal_lesson_google_sync_status` / попапы урока (**L24**). Column-REVOKE `last_error` на bindings — no-op / ошибка миграции. REVOKE `last_error_code`/`last_error_at` на bindings **ломает** IntegrationsSettingsPage (показывает `last_error_code`). |
| **S04 JWT vs кошельки** | Снятие `platform_role` из claim закрывает UPDATE `platform_payment_methods` | Политика UPDATE — `is_dev_console_operator()` по `auth.users.raw_app_meta_data`, не JWT. После S04 шага 1 developer из CRM SPA **всё ещё** PATCHит кошельки, пока не REVOKE UPDATE / `USING (false)` для authenticated (шаг 3). |
| **2.8.76 GCal cache** | Новая колонка = токен в Data API | `REVOKE ALL ON user_google_accounts FROM authenticated` с `20260891000001`; ALTER колонки GRANT не возвращает. `list_my_google_accounts()` отдаёт `refresh_token_issued_at`, не ciphertext. Kick — membership check. Не новый H\*. |
| **S34 `financial_debtors_v`** | «можно `security_invoker=true` для accountant» | View (`can_read_financial()` в WHERE) джойнит `clients` / `payments` / `personal_lesson_charges` / `personal_lessons`. После **S09** teacher SELECT на base уроков нет. Invoker=true + JWT accountant ок **только если** у роли есть SELECT на все base. Надёжнее оставить `security_invoker=false` (как masking views). 2.8.75 переписал агрегаты внутри view, имя то же — S27 GRANT SELECT обязателен. |

C1 (`complete-invite` + `updateUserById({ password })` + JWT в JSON), H9–H15, H21–H22, H26 (`FOR ALL` на `personal_lessons` + SPA-путь `excludeCancelled`), H27 (`finish_subscription` без `teachers_can_sell_subscriptions`), H33 (хук копирует `platform_role`), M13 (`useTeamMembers` селектит phone/telegram/`user_id`), M33 (`escapeCsvCell` без префикса формул) — как в пунктах.

### Регрессии: буквальный S\* ломает приложение

SPA **штатно** пишет ряд таблиц через PostgREST, не только через `rpc()`. REVOKE write / EXECUTE без нового RPC и правки хука = мёртвый UI.

| Промпт | Что сделает агент «как написано» | Что сломается | Как чинить (уже в тексте S\* ниже) |
|--------|----------------------------------|---------------|-------------------------------------|
| **S02** | В теле `expire_monthly`: только `service_role` / `auth.uid() IS NULL` | `PERFORM` из `mark_attendance` идёт с JWT преподавателя. Monthly unlimited **перестанут истекать** при отметке журнала. | `REVOKE EXECUTE` у `authenticated` (PostgREST). Тело **не** требовать service_role. Внутренний `PERFORM` оставить. |
| **S08** | «INSERT подписок только sell-RPC»; не отзывать DELETE из‑за rollback | Не-группа — **прямой** `.insert`. Rollback `.delete()` **мёртвый код** (группа с id уже RPC). Если агент **не** отзовёт DELETE — H15 останется. Если отзовёт INSERT — нельзя продать private/package. | **Не** отзывать INSERT. **REVOKE DELETE** — да, SPA не использует. UPDATE — да (H15 PATCH `lessons_left`). |
| **S09** | «слоты/персоналки только через RPC»; снять SELECT из `FOR ALL` без хука; триггер на `paid`/`price`; «дописать `client_id4`»; **SELECT payments только financial** | (1) Сетка teacher: `excludeCancelled: true` → base `personal_lessons`. (2) View **без `cancelled_at` и без `price_id`**. (3) Триггер на INSERT ломает продажу. (4) REST UPDATE урока в SPA **нет**. (5) RLS `payments_select` = operational **или** financial: полный admin видит кассу на дашборде; сужение до financial убивает его. `REVOKE SELECT` на `payments` = 403 кассе teacher. | Сначала DROP+CREATE view (+ `cancelled_at`, **+ `price_id`**, сохранить `client_id4`) и перевести `excludeCancelled` на view; `personalLessonsSelectTeacher` дополнить `price_id`. INSERT REST оставить, **REVOKE UPDATE/DELETE** на уроках. **payments:** REVOKE только write; GRANT SELECT у `authenticated` оставить; RLS SELECT не сужать. Слоты — REST write. |
| **S05** | Триггер: `auth.uid() IS NOT NULL` → запрет role/scope/meta | `update_team_member` / `ensure_own_member_profile` — DEFINER с тем же `auth.uid()`. Команда и профиль **мертвы**. | Флаг `SET LOCAL` из RPC или `current_user`, не JWT uid. |
| **S12** | Включить `[auth.captcha]` в config.toml **или** Captcha ON в Dashboard (чеклист шага 3 / колонка «Зачем» таблицы порядка) | Signup без токена в `signUp()` → 400. Captcha Auth — **S37**. | S12: пароль ≥8, confirm email, timebox, max_frequency. Captcha GoTrue не включать ни в config, ни в Dashboard. |
| **S18** | Teacher forbidden на `list_archived_prices`; DROP SELECT `personal_lesson_charges` | (1) Архивный тариф в модалках оплаты. (2) `usePersonalLessonChargeBalances` на сетке должников и `PayPersonalLessonModal`. | EXECUTE `list_archived_prices` оставить, без `sales_count`. Charges: сначала хук/view без сумм для списка должников; оплату не ломать (см. S18). |
| **S19** | Roster только `id`, `display_name`, `role` | `memberDisplayName` ждёт `first_name`, `last_name`, `patronymic`; фильтры сетки — `is_active` + `role`. `memberListLabel` для reception читает `meta.restricted_admin`. Без них пустые имена / reception = «admin». Callers не только сетка: `PricesPanel`, finance pages, `AuditLogSection`, `DataExportPage`, `VenueCostsSettingsPage`. | Roster: ФИО + `display_name` + `role` + `is_active` + признак reception (`meta.restricted_admin` или эквивалент). Без phone/telegram/`user_id`/`scope`/`profile_notes`/`contact_email`. Полный SELECT — `TeamSettingsPage` / `MemberProfileModal`. |
| **S22** | `REVOKE EXECUTE … organization_allows_writes/reads`, `is_active_member`, `member_role` FROM `authenticated` | Эти функции стоят **в RLS**. Без EXECUTE у `authenticated` политика не считается → **весь CRM**. | Не отзывать EXECUTE у хелперов из политик. Для IDOR: жёстко `p_org_id := auth_organization_id()` или схема вне Data API. `apply_scheduled` — не revoke, SPA его зовёт. |
| **S24** | SELECT лицензий/Stripe-подписки только owner | `OrganizationProvider` грузит оба SELECT для **каждого** члена (`isReadOnly` при `past_due`). Пустой SELECT ≠ throw; **REVOKE SELECT** → throw → **белый экран** орг. | Либо колонки `license_type` / `status` всем членам, либо узкий RPC для бандла. Не `throw` на пустой лицензии. |
| **S32** | DROP teacher SELECT на `clients` | `useClients` всегда `.from("clients").select("*")` (журнал, абонементы, ФИО). | Сначала хук на `clients_teacher_v`, потом DROP. |
| **S34** | `security_invoker=true` на `personal_lessons_teacher_v` / `subscriptions_teacher_v` / **`financial_debtors_v`** | Teacher без SELECT на base → masking view пустой. Accountant: `financial_debtors_v` (`useFinancialDebtors` на дашборде/дебиторах/экспорте) при invoker=true падает, если нет SELECT на `payments`/`charges`/`personal_lessons`/`clients`. | Masking views **и** `financial_debtors_v` оставить `security_invoker=false`. Invoker=true — только где роль уже имеет SELECT на **все** base (часть venue-cost). |
| **S39 / L18** | Teacher без `modules` / `teachers_can_*` **или** column-REVOKE `finance_period_closed_until` **или** явный SELECT без полей `mapSettings` | `OrganizationProvider` делает `.from("organization_settings").select("*")`. Нет GRANT на **любую** колонку → падает **весь** SELECT → белый экран. Явный список без `org_preset` / `terminology` / `directors_can_mark_attendance` / `low_balance_threshold` / `branding_name` — пресет и термины пустые, флаг директора молча `true`, нет бренда. | Не резать GRANT колонок, пока хук на `select("*")`. Если явный список — **все** поля `mapSettings` (кроме опционально спрятанных `finance_period_closed_until` / `branding_logo_url` после смены хука). |
| **S39 / L22** | Запретить authenticated SELECT `platform_payment_methods` | `App.tsx` + страница лицензии + `ManualPurchasePanel` читают `config`. | SELECT `config` оставить authenticated (как лендинг) **или** узкий RPC. UPDATE — только service_role (S04). |
| **S20** | «DELETE локации не голый REST» | `useLocations`: прямой insert/update/delete. | Не отзывать write локаций без RPC и перевода хука. Waitlist-мутации уже RPC. |
| **S25** | `REVOKE` write на `teacher_pay_rates` | `MemberProfileModal` → `useUpsertTeacherPayRate` → `.insert` в `teacher_pay_rates`. | Сначала UI на `save_teacher_pay_rule`, потом REVOKE. |
| **S35** | `REVOKE` write на `expenses` | `useExpenses`: прямой insert/delete. | Предпочтительно `_is_finance_period_closed` в RLS, не REVOKE. |
| **S01** | Edge без JWT в JSON | `AcceptInvitePage.handleSetupPassword` **требует** `access_token`/`refresh_token`. | В том же прогоне сменить UI (в S01 уже есть шаг 7). Не деплоить только функцию. |
| **S04** | Только убрать `platform_role` из JWT, не трогать GRANT UPDATE кошельков | `is_dev_console_operator()` не смотрит claim. Developer JWT из CRM по-прежнему PATCH `platform_payment_methods`. | Шаг 3 обязателен: UPDATE только service_role / Dev Console Edge. SELECT `config` оставить (L22). |
| **S11** | Резать `storno`/`correct` тем же порогом, что приём денег **или** забыть `write_off_personal_lesson_debt` | Комментарий колонки: закрытый период → **correction path**. Списание AR (2.8.73) периода не читает — дыра H29 остаётся. | Период на money-in RPC **и** на `update_payment_in_place` / `restate_*` / **`write_off_personal_lesson_debt`**. Сторно/correct в этом шаге не трогать. |
| **S17** | `REVOKE` write на `price_disciplines` / «только RPC тарифа»; DROP teacher SELECT на `calendar_events` без хука | (1) `usePrices.syncPriceDisciplines` / `syncPriceTeacherMembers` — прямой insert/delete. (2) `useCalendarEventsForWeek` эмбедит `calendar_events (income_amount, paid_amount, …)` — teacher-сетка мастер-классов **падает**, не «прячет суммы». | Политика junction = `can_manage_prices()`, GRANT write оставить. Арендаторы/серии уже RPC — там REVOKE ок. Сетку событий: хук для teacher **не** селектит финансовые колонки (или masking view); SELECT title/типа/сессий оставить. |
| **S27** | Ковровый `REVOKE ALL` у `authenticated`, GRANT только write из короткого списка + SELECT «и т.д.» | `REVOKE ALL ON ALL TABLES` снимает и **views**. Нет SELECT: `personal_lessons_teacher_v` / `subscriptions_teacher_v` / `financial_debtors_v`, `calendar_events`+`calendar_event_sessions`, `schedule_occurrence_cancellations`, `lesson_occurrence_closures`, `other_income`, `audit_log`, GCal bindings, waitlist, freeze/`subscription_refunds`, payroll tables, `single_visits`, `personal_lesson_charges`, `subscription_groups`, `platform_payment_methods`, **`renter_documents`** (lookup после finalize). Белый экран / мёртвые финансы и сетка. Нет write `disciplines` / `client_notes`. | После REVOKE ALL: `GRANT SELECT` на **именованный** список таблиц и views из S27 (не «и т.д.»; `subscription_refunds` и `renter_documents` в списке). Write — список S27. RPC-only write не возвращать. |
| **S28** | Default remember-me только в комментарии к `supabase.ts` | `readRememberMePreference`: `stored === null ? true`. `LoginPage` чекбокс с `getRememberMePreference()`. `AuthProvider.signInWithEmail(..., rememberMe = true)` — дефолт аргумента. | Default **false** в `readRememberMePreference` и в дефолте `signInWithEmail`. Галочка — явное согласие. |
| **S16** | Teacher view `single_visits` без сумм / DROP колонок | `useSingleVisits` (`SINGLE_VISITS_SELECT` включает `amount, method, price_id`) в `AttendancePanel`. | В том же прогоне: teacher-select без финансовых колонок (или маппинг `amount: 0`); журнал drop-in (кто/когда/слот) оставить. |
| **S39 / L28** | `get_venue_cost_rule_status` только финансовой роли | Касса: `checkVenueRuleBeforePayment` throw. Продажа абонемента / персоналки / drop-in у reception и teacher. | EXECUTE оставить ролям, которые зовут `record_*_payment` / `record_single_visit` (reception, teacher с продажей, admin, financial). Дашборд teacher: не показывать `VenueRuleExpiryNotice` (intel L28), query не обязан быть financial-only. |
| **S39 / L21 / L24** | column-REVOKE `last_error` на GCal **bindings** | На bindings колонки `last_error` **нет**. Хуки селектят `last_error_code`, `last_error_at`. UI интеграций показывает `last_error_code`. Текст ошибки: event_links + RPC урока (попапы). | Не column-REVOKE `last_error_code`/`last_error_at` на bindings. `last_error` на bindings не трогать (нет колонки). L24 — убрать текст из RPC/попапов, не ломать bindings SELECT. |
| **S22** | `REVOKE EXECUTE ON ALL FUNCTIONS … FROM authenticated` + whitelist | Весь CRM: журнал, оплаты, онбординг, списание долга, `set_active_organization`. | Только `PUBLIC` и `anon`. Не трогать EXECUTE у `authenticated` на RPC/хелперы, которые SPA или RLS уже вызывают (в т.ч. `write_off_personal_lesson_debt`, `get_personal_lesson_debt_trace`). |
| **S19** | Заменить select в единственном `useTeamMembers` | `TeamSettingsPage` без телефона/scope/`user_id`; либо все экраны снова видят PII. `MemberProfileModal` сам таблицу не читает. | Два хука / два queryFn. Roster — сетка, тарифы, финансы, заметки, audit labels, экспорт имён. Full — только страница команды. |

Журнал (`mark_attendance`), оплаты `record_*`, аренда `create_rental`, waitlist `add_group_waitlist_entry`, удаление персоналки `delete_personal_lesson` — уже RPC; там REVOKE write на таблицу (при живом RPC) UI не ломает.

### Дубли в счётчиках (ID сохранены)

- **M30** = **H19** (чинятся вместе, S16).
- **M19** ⊂ **H21** после подтверждения GRANT (S09).
- **L16** ⊂ **M29**.
- **L23** не находка (ссылка на H33).

---

## Что уже закрыто хорошо (не уязвимости)

Эти контуры проверены и **не** дают чужим арендаторам чужие данные «просто так» — **кроме** точечных DEFINER-дыр **H23** (write), **H31** (migrate spoof), **M34** (oracle/PII по UUID) и **H33** (developer JWT → platform-таблицы всех тенантов):

- **RLS включён** на tenant-таблицах; изоляция идёт через `auth_organization_id()` (JWT) + `is_active_member` / `current_member_role()` **из БД**, не только из UI.
- **Запись без лицензии/после демо** блокируется на SQL: `organization_allows_writes()` требует `demo_active` с `demo_expires_at > now()` **или** `licensed` + lifetime/активная подписка. UI `isReadOnly` — дополнительный слой, не единственный.  
- **Закрытый кассовый период** (`finance_period_closed_until`) на SQL проверяется **только** в rental RPC (`record_rental_payment`, invoices/advances/fiscal). Основная касса (абонементы, персоналки, drop-in, мастер-классы, storno/correct, возвраты, **списание AR персоналок `write_off_personal_lesson_debt` с 2.8.73**) **не** закрыта — **H29**.
- **Ключи доступа** хранятся как HMAC-SHA-256 + pepper (`ACCESS_KEY_PEPPER`), plaintext в БД нет. Активация демо-ключа сверяет email ключа с email пользователя.
- **Google refresh-token** в `user_google_accounts` отозван у `anon`/`authenticated`; клиент видит только email/status через `list_my_google_accounts()`. С **2.8.76** там же кэш `encrypted_access_token` — тот же REVOKE; RPC добавил `refresh_token_issued_at` (метка времени, не ключ). `claim_calendar_sync_jobs` по-прежнему только `service_role`; user-kick (`calendar-sync-kick`) сверяет membership до drain своей орг.
- **OAuth return_url** проверяется против `ALLOWED_ORIGINS`.
- **Stripe webhook** проверяет подпись. **Cron-воркеры** требуют `x-cron-secret` / `CRON_SECRET`.
- **CORS** Edge Functions: без Origin из allowlist ответ 403 (кроме cron).
- **Анонимный signup** выключен (`enable_anonymous_sign_ins = false`).
- XSS через `dangerouslySetInnerHTML` / `innerHTML` в `tangodb/src` не найден.
- Production Vite **не** включает `sourcemap: true` — карты исходников по умолчанию не отдаются.
- `set_active_organization` проверяет активное членство в целевой орг (нельзя переключить JWT на чужой тенант).
- `activate_access_key`: `p_user_id` чужого пользователя отвергается, если есть `auth.uid()`.
- `google-calendar-set-binding` сверяет `member.user_id` и `google_account.user_id` с вызывающим (не IDOR на чужой binding).
- Письма через Resend уходят JSON-телом — классический email header injection через `organizations.name` не проходит.

---

## Критичные

### C1. Принятие приглашения перезаписывает пароль существующего пользователя платформы

**Где:** `tangodb/supabase/functions/complete-invite/index.ts` (ветка `else` после `findAuthUserByEmail`), `verify_jwt = false` в `config.toml`.  
**Суть:** если email уже есть в `auth.users` (владелец другой школы, преподаватель в другой орг, разработчик), функция **безусловно** вызывает `auth.admin.updateUserById(..., { password })`, затем логинит этого пользователя и **возвращает `access_token` + `refresh_token`** в JSON.  
**Усугубление:** `invite-member` отдаёт пригласившему `invite_url` с plaintext-токеном (`invite_url` в ответе 200), даже если письмо не ушло (`email_sent: false`). Токен приглашения — 8 символов из алфавита 32 (`TDB-INV-XXXX-XXXX`), `verify_jwt` на complete/preview выключен. До complete `ensureInvitedAuthUser` создаёт `auth.users` с `email_confirm: true` **без пароля** — ящик жертвы помечается подтверждённым до её согласия (см. M16).  
**Импакт:** захват **всего аккаунта** жертвы на платформе (все организации, где она состоит), не только новой роли в орг пригласившего.  
**Условие:** приглашающий (owner/director) может пригласить email, который ещё не член **этой** орг — это штатный сценарий «добавить человека с другого тенанта». Контактные email коллег видны любому члену орг (M13) — удобный список целей.  
**Как чинить (направление):** для существующего пользователя не менять пароль; требовать вход текущим паролем / magic link; не возвращать `invite_url` клиенту; увеличить энтропию токена; одноразовость + привязка к сессии invitee; не createUser до принятия.

---

## Высокие

### H1. Полноценная CRM без купленного lifetime/подписки (self-service demo)

**Где:** `create-self-service-demo-org` (Edge + RPC), маршрут `/register` → `createDemoOrganization()`, `OrgWorkspaceRoute` пускает в панели при любой активной membership.  
**Суть:** после signup (и подтверждения email **если оно включено в production**) создаётся орг `demo_active` на 30 дней **без** ключа `TDB-LIFE` / `TDB-DEMO`. Это продуктовый контур, не баг обхода RLS.  
**Импакт:** любой, кто прошёл регистрацию, получает полный write-доступ к **своему** тенанту на 30 дней (клиенты, платежи, расписание — внутри своей орг). Чужие тенанты так не открываются.  
**Остаточный риск:** если cron `purge-expired-demo-orgs` / `demo-lifecycle` не запущен, истёкшее демо остаётся **читаемым** (`organization_allows_reads` включает `demo_active` даже после `demo_expires_at`). Запись SQL уже режет — **пока никто не сделал H10**.  
**Не путать с:** взломом чужой школы. Это «использование продукта без оплаты ключа» — да, в рамках демо. Обход 30 дней без ключа — отдельный пункт **H10**.

### H2. Публичная выдача демо-ключа plaintext в HTTP-ответе

**Где:** `tangodb/supabase/functions/request-demo-key/index.ts`, `verify_jwt = false`.  
**Суть:** неаутентифицированный `POST` с email создаёт ключ и **возвращает `{ ok, key: "TDB-DEMO-..." }`** вызывающему, плюс пытается отправить письмо. Владение ящиком не доказывается. Rate limit — 5/15 мин **в памяти инстанса**.  
**Импакт:** перехват/автоматизация получения ключей; исчерпание слота демо на чужой email (ключ привязан к email при активации); если в production **выключено** подтверждение почты (см. H5) — регистрация под чужим email + активация украденного ключа.  
**Как чинить:** не возвращать ключ в JSON; только письмо; proof-of-email (OTP) до insert.

### H3. Сессия в `localStorage` по умолчанию (Remember me = true)

**Где:** `tangodb/src/lib/supabase.ts` — `readRememberMePreference()` при отсутствии ключа возвращает `true`; `AuthProvider.signInWithEmail(..., rememberMe = true)`; `LoginPage` чекбокс стартует с `getRememberMePreference()`. Кастомный `authStorage` пишет JWT в `localStorage`, если remember=true.  
**Импакт:** любая XSS (зависимость, расширение, вредоносный скрипт) = кража refresh/access token = полный вход. Нет CSP, который уменьшил бы XSS (H4).  
**Как чинить:** httpOnly cookie-сессия через собственный BFF **или** default remember-me = false; CSP; запрет inline.

### H4. Нет security headers на фронте (CSP, frame-ancestors, HSTS)

**Где:** `tangodb/vercel.json`, `tangodb-dev-console/vercel.json`, корневой `vercel.json` — только SPA rewrite, без `headers`. `tangodb/index.html` грузит `https://telegram.org/js/telegram-web-app.js` без SRI.  
**Импакт:** clickjacking (CRM в iframe на фишинговом сайте); нет CSP на XSS; смешанный контент/supply-chain Telegram-скрипта.  
**Как чинить:** `Content-Security-Policy` (хотя бы `frame-ancestors 'self'`), `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` на Vercel; SRI или self-host Telegram script.

### H5. Слабая политика паролей Auth + возможно выключенное подтверждение email

**Где:** `tangodb/supabase/config.toml`: `minimum_password_length = 6`, `password_requirements = ""`, `enable_confirmations = false`, `[auth.captcha]` закомментирован, `secure_password_change = false`, session `timebox` закомментирован, `[auth.email] max_frequency = "1s"`, `additional_redirect_urls` только `https://127.0.0.1:3000`. UI регистрации требует 8 символов (`RegisterPage`) — **только UI**. Invite complete требует 8. Auth API примет 6.  
**Импакт (если production = этот файл):** регистрация на любой email без доказательства ящика; слабые пароли; нет MFA; сессии живут, пока жив refresh token; можно слать письма сброса/подтверждения раз в секунду (пока не упрётся в `email_sent = 2`).  
**Обязательно:** сверить Dashboard: Confirm email = ON, min password ≥ 8 + complexity, session timebox, `max_frequency` ≥ 60s, allowlist редиректов — только прод-origin без `*.vercel.app`. **Captcha GoTrue — не в S12:** `signUpWithEmail` не передаёт токен (M9 / **S37**). Чеклист «Captcha ON» оператору — после S37 или вместе с правкой `signUp`. Локальный config — дыра для staging, если его копируют в prod.

### H6. Rate limit Edge Functions не переживает масштабирование

**Где:** `tangodb/supabase/functions/_shared/rateLimit.ts` — `Map` в памяти изолята.  
**Импакт:** обход лимитов `request-demo-key`, `preview-invite`, `complete-invite`, `landing-track-event`, `activate-access-key` через разные инстансы / много IP (`x-forwarded-for` берётся, если нет `cf-connecting-ip`).  
**Как чинить:** Redis / таблица / Upstash / Cloudflare WAF, не in-process Map. Для IP — только доверенный CDN-заголовок.

### H7. Преподаватель читает полную карточку клиента (PII) через REST

**Где:** политика `clients_select_teacher` в `20260623000001_v2_business_rls.sql` — `SELECT` всей строки `clients` при `teacher_can_access_client`. Маскирование R4 сняло финансовые колонки с **абонементов/персональных уроков** (views), но **не** телефон, telegram, email, данные опекунов.  
**Импакт:** любой teacher с доступом к клиенту через абонемент/урок выгружает PII PostgREST’ом (`/rest/v1/clients`), независимо от UI-маскировки имён. Финансовые колонки **персональных уроков** снова видны через `FOR ALL` (**H26**); финансы мастер-классов — отдельная таблица без view (**H24**).  
**Связка:** те же политики позволяют **менять и удалять** карточку (H11), не только читать. Финансовые колонки персоналок — ещё `personal_lesson_charges` (**H30**) и drop-in `single_visits` (**H32**).  
**Как чинить:** view `clients_teacher_v` без телефона/telegram/email/опекунов; имена и id оставить. Сначала перевести `useClients` / `useClientDirectory` (teacher) на view — **потом** DROP SELECT на base. Иначе журнал, сетка и продажа персоналок без ФИО (**S32**).

### H8. Инсайдер копирует все данные своей роли (экспорт ≠ защита)

**Где:** `DataExportPage` / `exportAllDashboardCsv` / `exportAllFinancialCsv` — клиентский CSV из уже загруженных хуков. PostgREST `max_rows = 1000`, но клиент может крутить `.range()`. Storage `exports` (папка = `auth.uid()`), `renter-documents` (папка = `organization_id`). IndexedDB `tangodb-offline` — снимок −3…+7 дней.  
**Суть:** это не дыра «аноним скачал чужую школу». Это **неотъемлемое свойство SPA+RLS**: кто получил SELECT, тот может сохранить JSON/CSV. Флаги `teachers_can_export` / `admin_can_export` режут **кнопку**, не REST.  
**Импакт:** уволившийся сотрудник с живым JWT (до 1 часа access + refresh) уносит базу клиентов/платежей; бухгалтер — финансы; teacher — операционку в своём scope.  
**Как чинить:** короткоживущие сессии; revoke refresh при deactivate member; watermark/audit на bulk SELECT (сложно на PostgREST); не хранить офлайн PII или шифровать; DLP на клиенте не является контролем.

### H9. Director (и owner) повышает себя в `owner` / снимает владельца через PostgREST, минуя RPC

**Где:** `organization_members_insert_team` / `_update_team` / `_delete_team` в `20260620000003_v2_tenant_rls.sql`; `GRANT SELECT, INSERT, UPDATE, DELETE ON organization_members TO authenticated`. RPC `update_team_member` / `create_organization_invite` проверяют `inviter_can_assign_role` (owner назначить нельзя, director только owner назначает, нельзя снять последнего owner) — **UI зовёт RPC** (`useTeamInvites`). RLS этих проверок **не делает**.  
**Суть:** любой с `can_manage_team()` (owner, director) может прямым `UPDATE` своей строки выставить `role = 'owner'`, `DELETE` строку владельца или `INSERT` членства с `role=owner` на известный `user_id` (UUID коллег торчат в M13). `WITH CHECK` только: та же орг + `can_manage_team()` + `organization_allows_writes`. Колонка `role` не ограничена.  
**Импакт:** director захватывает школу (настройки, команда, лицензия, экспорт, Stripe checkout только у owner). Уволенный director с живым JWT до refresh — то же.  
**Как чинить:** `REVOKE INSERT, UPDATE, DELETE ON organization_members FROM authenticated`; мутации только через существующие RPC. Либо CHECK/триггер: запрет `NEW.role = 'owner'` с клиента, запрет DELETE последнего owner, `inviter_can_assign_role` в RLS.

### H10. Обход 30-дневного демо и смена `owner_user_id` через `UPDATE organizations`

**Где:** политика `organizations_update_admin` — `member_role IN ('owner', 'director', 'admin')`; `is_restricted_admin()` **не** проверяется; `GRANT SELECT, UPDATE ON organizations TO authenticated` (все колонки). Триггера на `status` / `demo_expires_at` / `owner_user_id` нет. Клиентский код таблицу не пишет — дыра только API.  
**Суть:** `organization_allows_writes` для демо:

`status = 'demo_active' AND (demo_expires_at IS NULL OR demo_expires_at > now())`.

Любой owner/director/**admin (в т.ч. reception)** после истечения демо может прямым `UPDATE` выставить `demo_expires_at` в будущее или `NULL` — запись снова разрешена **без ключа и без Stripe**. Также можно сменить `owner_user_id`, `data_purge_at`, `status`. `status: licensed` сам по себе write не даёт (нужна строка в `organization_licenses` / подписка) — вечный demo достаточен.  
**Импакт:** коммерческий обход лицензии инсайдером с ролью admin+; reception, которой SQL не должен трогать биллинг, продлевает демо. Не открывает чужие тенанты.  
**Как чинить:** `REVOKE UPDATE ON organizations FROM authenticated`. В SPA прямого `.from("organizations").update` нет; отображаемое имя — `organization_settings.branding_name`. Не выдумывать RPC смены `organizations.name` (онбординг DEFINER уже пишет name). `demo_expires_at` / `status` / `owner_user_id` / `access_key_id` — только service_role / license RPC. SELECT своей орг оставить (`OrganizationProvider`).

### H11. Преподаватель меняет, удаляет и **создаёт** карточки клиентов, даже если в настройках «нельзя»

**Где:** `clients_update_teacher` / `clients_delete_teacher` / `clients_insert_teacher` в `20260623000001_v2_business_rls.sql`; `GRANT … INSERT, UPDATE, DELETE ON clients TO authenticated`. Флаг `organization_settings.teachers_can_edit_clients` (default **false**) читается только в `permissions.ts` (`canTeacherWriteClients`). В SQL **ни разу** — в т.ч. не в одноимённой функции `teacher_can_write_clients()`.  
**Суть:** SQL-функция `teacher_can_write_clients()` **не** читает `teachers_can_edit_clients`; она возвращает `true`, если у преподавателя в JWT-scope есть `can_view_all_clients`, `all_disciplines` или непустой `discipline_ids` (`20260623000001_v2_business_rls.sql`). Политика `clients_insert_teacher` вызывает именно её. UPDATE/DELETE вообще не проверяют ни флаг, ни эту функцию — только `teacher_can_access_client(id)`.  
Teacher с `teacher_can_access_client(id)` (абонемент/урок в scope) может `INSERT`/`UPDATE`/`DELETE` строку в `clients` — телефон, telegram, email, опекуны, либо удаление (CASCADE на связанные сущности по FK). UI кнопку спрячет.  
**Усугубление:** `subscriptions_update_teacher` (если `teachers_can_sell_subscriptions`) проверяет `teacher_can_access_subscription(id)` в WITH CHECK по **тому же id**, не по новым `client_id2`/`client_id3`. Можно дописать чужой UUID клиента в свой абонемент и расширить H7, если UUID известен (waitlist, заметки, чужой UI). Эскалация scope до `can_view_all_clients` — см. **H13**.  
**Импакт:** порча/вынос PII и уничтожение клиентской базы в пределах scope преподавателя вопреки явному запрету владельца; создание «левых» клиентов при любом discipline-scope.  
**Как чинить:** в политиках INSERT/UPDATE/DELETE для teacher — `EXISTS (SELECT 1 FROM organization_settings os WHERE os.organization_id = auth_organization_id() AND os.teachers_can_edit_clients)` (как `teacher_can_write_subscriptions`). Переименовать/разделить `teacher_can_write_clients()` (scope vs org-flag). DELETE клиентам-teacher лучше запретить полностью. Подписки: WITH CHECK что все `client_id*` уже были доступны **до** UPDATE.

### H12. Reception (`restricted_admin`) обходит модель R6 и получает права полного admin через REST

**Где:** `can_manage_settings()` / `can_manage_team()` в `20260620000002_v2_tenant_auth_helpers.sql` — `auth_member_role() IN ('owner', 'director', 'admin')` **без** `NOT is_restricted_admin()`. Те же роли в `organizations_update_admin` (`20260620000003_v2_tenant_rls.sql`). R6 ввёл `is_restricted_admin()` для `can_read_operational()` / `can_write_all_business()`, но **не** для tenant-мутаций.  
**Суть:** admin с `meta.restricted_admin = true` (роль reception в UI) проходит `can_manage_team()` и `can_manage_settings()` как обычный admin. Прямым PostgREST может: всё из **H9** (смена `role`, DELETE owner, INSERT owner); всё из **H10** (`demo_expires_at`, `owner_user_id`, `status`); `PATCH organization_settings` на **все** колонки — `modules` (JSON), `teachers_can_*`, `admin_can_*`, `finance_period_closed_until` (сброс закрытого периода → `NULL`), `freeze_*`, `branding_*`. RPC `create_organization_invite` / `update_team_member` тоже доступны (проверяют `can_manage_team()`, не reception-флаг).  
**Самоэскалация:** `PATCH` своей строки `organization_members` с `meta: {}` снимает `restricted_admin` → `can_read_operational()` / `can_write_all_business()` снова `true` без участия owner.  
**Импакт:** сотрудник reception, которому владелец дал только кассу и абонементы, через DevTools получает управление школой, биллингом и командой. Не открывает чужие тенанты. Включение `modules.finance_basic` в settings **не** даёт `can_read_financial()` (роль accountant по-прежнему нужна), но сброс `finance_period_closed_until` обходит закрытие кассового периода для всех последующих RPC/прямых записей, которые читают эту колонку.  
**Как чинить:** во всех `can_manage_*` и политиках `organizations_update_*` / `organization_settings_update_*` / `organization_members_*_team` добавить `AND NOT is_restricted_admin()` (кроме узких reception-RPC). `organization_settings` **не** отзывать write у owner/director: `SettingsProvider` делает прямой `.update`. `organizations` write — S06. `organization_members` write — S05 (мутации уже RPC). Запрет клиентского `UPDATE` колонки `meta` без RPC.

### H13. Эскалация `scope` / `meta` членов команды через прямой `UPDATE organization_members`

**Где:** политика `organization_members_update_team` (`20260620000003_v2_tenant_rls.sql`); `GRANT UPDATE ON organization_members TO authenticated`. RPC `update_team_member` принимает `p_scope` / `p_meta` как произвольный JSONB без семантической валидации (`20260708000001_v2_member_profile_fields.sql`), но UI зовёт RPC. RLS не ограничивает колонки.  
**Суть:** любой с `can_manage_team()` (owner, director, admin, **reception — H12**) может прямым `PATCH` выставить teacher'у, в т.ч. себе если роль teacher+admin: `scope.can_view_all_clients = true`, `all_disciplines = true`, расширить `discipline_ids` / `schedule_group_ids` без UI. Снять `meta.restricted_admin` у коллеги-reception или у себя. Это обходит UI-мастер scope и усиливает **H7/H11** (шире PII и write клиентов).  
**Инвайт:** `create_organization_invite` (`20260804000001`) пишет `v_meta := COALESCE(p_meta, '{}')` и `p_scope` **без семантической валидации** (только `teacher_scope_has_access` → иначе default). Edge `invite-member` пробрасывает `body.meta` / `body.scope` с клиента. Можно выдать приглашение с `meta.can_edit_past_schedule` / широким scope — после accept то же, что PATCH (**H13** на входе).  
**Импакт:** director/reception раздувает доступ преподавателя до всей клиентской базы; reception снимает себе ограничение R6.  
**Как чинить:** вместе с H9 — `REVOKE UPDATE ON organization_members FROM authenticated`; whitelist колонок в RPC **и** в `create_organization_invite`; триггер `BEFORE UPDATE` только если отличает клиентский REST от DEFINER RPC (`SET LOCAL` / `current_user`, **не** `auth.uid()` — иначе мёртвые `update_team_member` / `ensure_own_member_profile`); в RPC — валидация scope (как в UI `isTeacherScopeConfigured`).

### H14. Прямой REST на `attendance` обходит `mark_attendance` / `correct_attendance` (списание уроков, freeze, настройки director)

**Где:** `attendance_write_teacher` / `attendance_write_admin` в `20260623000001_v2_business_rls.sql` (обновлены в `20260810000001_attendance_scope_payment_comment.sql`); `GRANT SELECT, INSERT, UPDATE, DELETE ON attendance TO authenticated`. UI и офлайн-синк зовут RPC `mark_attendance` / `sync_offline_mark_attendance` → `mark_attendance` / `correct_attendance`.  
**Суть:** политики разрешают teacher (через `teacher_can_view_attendance_row`) и owner/director/admin (через `can_write_all_business()`) прямой `INSERT`/`UPDATE`/`DELETE` строк `attendance` без RPC. В SQL **нет** триггера, который синхронизирует `subscriptions.lessons_left` при изменении attendance. Логика RPC: списание/возврат урока, freeze-периоды, `directors_can_mark_attendance` для director, idempotency, venue-cost ack — **не выполняется** при прямом PATCH.  
**Импакт:** teacher отмечает «присутствие» без уменьшения `lessons_left` → клиент получает «бесплатные» уроки; можно менять статусы вопреки freeze; director с `directors_can_mark_attendance = false` в настройках всё равно пишет attendance через `attendance_write_admin` (RPC проверяет флаг, RLS — нет). Reception после **H12** — то же через `can_write_all_business()`.  
**Как чинить:** `REVOKE INSERT, UPDATE, DELETE ON attendance FROM authenticated`; оставить SELECT + существующие RPC. Либо `FOR ALL` только `USING(false)` для write-политик и единый SECURITY DEFINER путь.

### H15. Прямой `UPDATE subscriptions` обходит продажу/коррекции (в т.ч. `lessons_left`)

**Где:** `subscriptions_update_teacher` (`20260706000001_v2_teacher_subscriptions_write_guard.sql`) и `subscriptions_update_admin` (`20260623000001_v2_business_rls.sql`); `GRANT … UPDATE ON subscriptions TO authenticated`. RPC продажи/заморозки/возвратов меняют абонемент через SECURITY DEFINER.  
**Суть:** teacher с `teachers_can_sell_subscriptions` (проверка только на INSERT/UPDATE/**DELETE** политике, не на колонки) может `PATCH` любые поля доступного абонемента: `lessons_left`, `status`, `client_id*`, даты — без платежа и без RPC. **`subscriptions_delete_teacher`** (`20260706000001`) при том же флаге позволяет `DELETE` строку абонемента целиком (CASCADE на связанные сущности по FK). Admin/reception (**H12**) — любой абонемент орг. Политика `subscriptions_update_teacher` в WITH CHECK не ограничивает новые `client_id2`/`client_id3` (см. **H11**).  
**Импакт:** раздача уроков без оплаты; «вечные» абонементы; подмена клиентов в парном/тройном абонементе; порча финансовой модели школы.  
**Как чинить:** `REVOKE UPDATE, DELETE` на `subscriptions` у `authenticated` (INSERT не-группы в SPA — прямой REST, пока нет sell-RPC). PATCH `lessons_left`/`status` с клиента запретить. DELETE с клиента **можно** снять сразу: rollback `.delete()` в `useAddSubscription` недостижим (группа с id идёт в `create_group_subscription`).

### H16. Преподаватель создаёт/редактирует персональные уроки и слоты расписания **других** преподавателей в общем discipline-scope

**Где:** `personal_lessons_write_teacher` / `schedule_slots_write_teacher` (`20260623000001_v2_business_rls.sql`); helpers `teacher_can_access_lesson` / `teacher_can_access_schedule_slot` — если `teacher_member_id ≠ auth_member_id()`, достаточно `teacher_has_discipline_access(discipline_id)` (+ location для урока). `teachers_can_sell_personal_lessons` в SQL **не** проверяется (**M21**).  
**Суть:** teacher в scope дисциплины может `INSERT`/`UPDATE`/`DELETE` урок и слот, назначенный на другого `teacher_member_id` — подмена расписания коллеги, «левые» уроки на чужом имени.  
**Импакт:** операционный sabotage / путаница в расписании и payroll; не открывает чужий тенант.  
**Как чинить:** в UPDATE/DELETE-политиках teacher — не править чужой `teacher_member_id` без продуктового «замена в дисциплине». INSERT с выбранным преподавателем в форме — штатный UX; не путать с REST-sabotage чужих уроков. Плюс `teachers_can_sell_personal_lessons` в SQL write. Сетка `schedule_slots` в SPA пишется REST (`useSchedule.ts`) — не переводить на RPC ради этой дыры.

### H17. Прямой REST на rental billing (`rental_invoices`, advances, deposits…) обходит RPC и закрытый период

**Где:** `rental_invoices_write`, `rental_invoice_payments_write`, `rental_advances_write`, `rental_deposits_write`, `rental_pricing_adjustments_write` и др. в `20260845000001_rental_series_tariffs.sql` — `FOR ALL` с `USING/WITH CHECK (can_read_financial())`, **не** `can_write_financial()` / `member_can_record_rental_payment()`. RPC `create_rental_invoice`, `record_rental_invoice_payment`, `record_rental_advance` и коррекции проверяют `_is_finance_period_closed()` (`20260862000001_rental_operation_date.sql`). Явный `GRANT` на эти таблицы для `authenticated` в миграциях **не найден** — доступ зависит от Data API defaults (**L10**, **M31**).  
**Суть:** owner/director/accountant может прямым `INSERT`/`UPDATE`/`DELETE` менять суммы счетов, платежей, авансов, депозитов без RPC, venue-cost ack и закрытого кассового периода. Reception после **H12** с ролью accountant — то же.  
**Импакт:** порча rental billing, обход закрытого периода, «фиктивные» оплаты арендаторов.  
**Как чинить:** `REVOKE INSERT, UPDATE, DELETE` на rental financial tables от `authenticated`; только SECURITY DEFINER RPC. Либо в политиках write — `NOT _is_finance_period_closed(...)` и отдельный `can_write_rental_finance()`.

### H18. Прямой REST на `teacher_settlements` / `teacher_settlement_payments` обходит расчёт payroll

**Где:** `teacher_settlements_insert` / `_update` и `teacher_settlement_payments_insert` в `20260728000001_v2_teacher_payroll.sql`; `can_write_payroll()` = `can_read_financial()` (owner, director, **accountant**). `GRANT INSERT, UPDATE ON teacher_settlements` и `GRANT INSERT ON teacher_settlement_payments` для `authenticated`. RPC `recalculate_teacher_settlement` / `record_teacher_settlement_payment` — SECURITY DEFINER с той же проверкой.  
**Суть:** accountant (и owner/director) может `PATCH teacher_settlements.amount_accrued` / `amount_paid` или `INSERT` строку в `teacher_settlement_payments` без RPC. CHECK только `amount_paid <= amount_accrued` — не связывает с реальными платежами.  
**Импакт:** завышение/занижение зарплаты преподавателей в учётке; обход audit trail RPC.  
**Как чинить:** `REVOKE INSERT, UPDATE, DELETE ON teacher_settlements FROM authenticated`; payments settlements — только `record_teacher_settlement_payment` RPC; `can_write_payroll()` ≠ `can_read_financial()`.

### H19. Teacher меняет связи `subscription_groups` без проверки `teachers_can_sell_subscriptions`

**Где:** `subscription_groups_insert_teacher` / `subscription_groups_delete_teacher` в `20260714000001_subscription_groups.sql` — только `teacher_can_access_subscription(subscription_id)`; `GRANT … INSERT, DELETE ON subscription_groups TO authenticated`. Флаг `teachers_can_sell_subscriptions` в политиках **не** читается (в отличие от `subscriptions_insert_teacher`).  
**Суть:** teacher с доступом к абонементу может `INSERT`/`DELETE` строки `subscription_groups` — подключить абонемент к другой группе/локации или отвязать, минуя UI продажи.  
**Импакт:** клиент попадает в waitlist/журнал «не своей» группы; операционный sabotage; расширение scope attendance.  
**Как чинить:** в политиках teacher — `teacher_can_write_subscriptions()` (как для INSERT в `subscriptions`).

### H20. Admin/reception создаёт `single_visits` через REST, минуя `admin_can_record_single_visits`

**Где:** `single_visits_insert_admin` / `_update_admin` в `20260731000001_single_visit_dropins.sql` — `can_write_all_business()` без чтения `admin_can_record_single_visits`. RPC `record_single_visit` и helper `teacher_can_record_single_visit_for_slot` проверяют флаг для admin/teacher. Явный `GRANT` на `single_visits` для `authenticated` в миграциях **не найден** (**M31**).  
**Суть:** owner/director/admin (в т.ч. reception после снятия `restricted_admin` — **H12**) может прямым `INSERT` создать разовое посещение, когда владелец выключил «admin может отмечать разовые».  
**Импакт:** обход org-флага §9; фиктивные drop-in без RPC-проверок даты/тарифа.  
**Как чинить:** в политиках admin write — `admin_can_record_single_visits` (как в RPC); либо только RPC `record_single_visit`.

### H21. Прямой REST на `payments` обходит `admin_can_accept_payments` и закрытый период

**Где:** `payments_write_admin` / `payments_update_admin` (`20260703000001_v2_reception_restricted_admin.sql`) — `can_write_all_business() OR can_write_reception()`; **нет** `admin_can_accept_payments`, **нет** `_is_finance_period_closed()`. Флаг `admin_can_accept_payments` читается только в RPC (`record_subscription_payment` — `20260809000001`, rental cashier — `20260855000001`). Явный табличный `GRANT ON payments` в миграциях **не найден** (**M19**, **M31**).  
**Суть:** reception (`can_write_reception`) и admin с выключенным «принимать платежи» могут `INSERT`/`UPDATE`/`DELETE` строки `payments` — сумма, метод, дата — без коррекционных RPC и закрытого периода.  
**Импакт:** фиктивная касса; порча финансовой отчётности; обход явного запрета владельца для admin.  
**Как чинить:** в RLS write — `admin_can_accept_payments` для admin; reception — узкая политика только INSERT через RPC; `NOT _is_finance_period_closed`; `REVOKE` **write** с клиента. SELECT: GRANT у `authenticated` оставить; RLS не сужать до `can_read_financial()` (полный admin видит операционную кассу). Teacher строки SELECT и так пустые.

### H22. Teacher/admin помечает персональный урок оплаченным через `PATCH personal_lessons.paid`

**Где:** `personal_lessons_write_teacher` / `personal_lessons_write_admin` — `FOR ALL` (`20260623000001_v2_business_rls.sql`); колонка `paid` (`'yes'|'no'`). RPC `record_personal_lesson_payment` создаёт строку в `payments` и обновляет charges. `teachers_can_sell_personal_lessons` в RLS **не** проверяется (**M21**).  
**Суть:** teacher с `teacher_can_access_lesson` может `PATCH paid = 'yes'` и `price` без платежа и без RPC; admin/reception (**H12**) — любой урок орг.  
**Импакт:** «оплаченные» уроки без денег в кассе; искажение payroll/venue-cost (если опираются на paid).  
**Как чинить:** клиент не трогает колонки `paid`/`price`/`paid_amount` на **UPDATE** (column privilege или `REVOKE UPDATE` всей таблицы — SPA не PATCHит урок REST-ом). Сейчас правка идёт `update_personal_lesson` RPC, создание — INSERT (`useAddPersonalLessons`), в INSERT **есть** `paid` и `price` — не резать эти колонки на INSERT. Связка: **H26** — та же политика `FOR ALL` ещё и читает эти колонки и пишет прошлые даты.

### H23. Любой authenticated вызывает `expire_monthly_subscriptions` на **чужие** тенанты (и на все сразу)

**Где:** `expire_monthly_subscriptions` в `20260715000001_schedule_groups_unified_attendance_monthly.sql` — `SECURITY DEFINER`, `GRANT EXECUTE … TO authenticated`. Параметр `p_org_id uuid DEFAULT NULL`. Тела проверки `auth.uid()` / `auth_organization_id()` / членства **нет**. Других переопределений функции в более поздних миграциях **нет**.  
**Суть:**

```sql
UPDATE subscriptions s
SET status = 'finished'
WHERE s.billing_model = 'monthly_unlimited'
  AND s.status = 'active'
  AND s.expires_at < current_date
  AND (p_org_id IS NULL OR s.organization_id = p_org_id);
```

Любой залогиненный пользователь (teacher демо-школы, accountant) может `POST /rest/v1/rpc/expire_monthly_subscriptions` с `p_org_id: null` — массовый `UPDATE` **всех** истекших monthly-абонементов платформы. Либо передать UUID чужой орг. `current_date` — дата сессии БД (обычно UTC): у школы в UTC−N подписка с `expires_at = «сегодня по местному»` может закрыться раньше, чем ожидается по локальной дате школы.  
**Импакт:** кросс-тенантная запись (не чтение строк обратно); блокировки/`UPDATE` по всей таблице `subscriptions` = DoS соседних школ; преждевременное `finished` из‑за TZ. Это не «украсть чужую базу». SPA этот RPC **не** вызывает; истечение monthly идёт как `PERFORM` из `mark_attendance` / freeze / замены партнёра (cron Edge **не** вызывает). Тот же класс кросс-тенантного write без членства — ещё **H31**.  
**Как чинить:** `REVOKE EXECUTE` у `PUBLIC`/`anon`/`authenticated` (PostgREST). Тело **не** требовать `service_role` / `auth.uid() IS NULL` — иначе `PERFORM` из журнала перестанет истекать monthly. Cron выдумывать не нужно. Клиентский вызов не нужен.

### H24. Преподаватель читает финансовые поля всех `calendar_events` организации

**Где:** `calendar_events_select_teacher` / `calendar_event_sessions_select_teacher` в `20260831000001_calendar_events_master_class.sql`. USING: `current_member_role() = 'teacher'` — **без** discipline/location/scope. `GRANT SELECT ON calendar_events TO authenticated`. Колонки таблицы: `income_amount`, `paid_amount`, `payment_status`, `payment_comment`, `actual_guest_count`. Teacher-view с маскированием (как `personal_lessons_teacher_v`) **нет**. Write-политик на эти таблицы нет (создание идёт через RPC) — дыра в **чтении**.  
**Суть:** любой teacher `GET /rest/v1/calendar_events` снимает выручку мастер-классов/open lesson всей школы. **SPA уже так делает:** `useCalendarEventsForWeek` эмбедит `calendar_events (payment_status, income_amount, paid_amount, currency, …)` в запрос `calendar_event_sessions` — JSON сетки недели содержит суммы даже если UI их не рисует.  
**Импакт:** обход R4 (финансовые колонки для teacher); инсайдер-преподаватель видит кассу мероприятий. Не cross-tenant.  
**Как чинить:** как подписки — view без `income_*` / `paid_*` / `payment_*` + `DROP` teacher SELECT на базовую таблицу **после** правки `useCalendarEventsForWeek` (teacher не селектит эти колонки, иначе сетка недели падает). Либо column GRANT. Scope: хотя бы `teacher_has_location_access` на сессии.

### H25. Прямой REST на rental series / арендаторов / контакты обходит create/cancel RPC

**Где:** `rental_series_write` / `_patterns_write` / `_exceptions_write` в `20260845000001_rental_series_tariffs.sql` — `FOR ALL` + `member_can_manage_rentals()` (owner/director/admin не-reception; admin ещё `admin_can_edit_schedule` **внутри хелпера**). `renters_insert`/`_update`, `renter_contacts_write`, `renter_contracts_write`, `renter_communications_write`, `renter_documents_write` в `20260843000001` / `20260844000001` — тот же хелпер (документы — `member_can_read_renter_documents()`, по сути owner/director/admin). На `rentals` / `rental_payments` write-политик нет (только SELECT) — слоты идут через RPC `create_rental` / `cancel_rental`.  
**Суть:** owner/director/**admin** прямым `DELETE`/`PATCH` сносит серию аренды, паттерн, exception, карточку арендатора, контакт, договор — без `cancel_rental_series_occurrence`, без финансовой ветки отмены, без conflict preview, без закрытого периода. `rental_tariffs_write` дополнительно требует `can_read_financial()` → фактически owner/director. На production таблицы с auto-expose ALL (**M31**).  
**Импакт:** порча операционного контура аренды; уничтожение PII арендаторов; обход кассовой отмены. Не открывает чужой тенант. Reception с `restricted_admin` в `member_can_manage_rentals()` отсекается (в отличие от H12 на tenant-таблицах).  
**Как чинить:** `REVOKE INSERT, UPDATE, DELETE` на `rental_series*`, `renters`, `renter_*` от `authenticated`. UI уже на RPC (`upsert_renter`, `upsert_renter_contact`, `create_rental_series`, `create_rental`, `list_renters`, `get_renter_detail`) — перевод хуков не нужен. SELECT оставить, если какой-то экран ещё читает таблицу; пикер/карточка идут через RPC.

### H26. `personal_lessons` / `schedule_slots` `FOR ALL`: обход R4 (SELECT цены) и запрета править прошлое

**Где:** `personal_lessons_write_teacher` / `_write_admin` и `schedule_slots_write_teacher` / `_write_admin` в `20260623000001_v2_business_rls.sql` — `FOR ALL` (в PostgreSQL это SELECT+INSERT+UPDATE+DELETE). R4 (`20260701000001`) сделал `DROP POLICY personal_lessons_select_teacher` и view `personal_lessons_teacher_v` без `price`/`paid_amount`. `20260711000001` вернул в view колонку `paid` (индикатор сетки), не цену. `20260718000001_personal_lessons_stage1.sql` — актуальное определение: **есть** `client_id4` и `paid`, **нет** `cancelled_at` и **нет** `price_id`. Политику `FOR ALL` **не** трогал. RPC `delete_personal_lesson` / `update_personal_lesson` / `record_personal_lesson_payment` проверяют `can_edit_past_schedule()` (`20260846000001`, флаг в `organization_members.meta`). RLS **не** проверяет ни дату, ни этот флаг. `teachers_can_sell_personal_lessons` в RLS тоже нет (**M21**, **H22**).  
**Суть:** teacher с `teacher_can_access_lesson` (discipline-scope, в т.ч. чужой преподаватель — **H16**) через REST: (1) `SELECT` полную строку включая `price`, `paid`, `paid_amount` — маскирующий view бесполезен; (2) `PATCH`/`DELETE` урок или слот с `date < today` вопреки настройке «нельзя править прошлое»; (3) то же для `paid`/`price` (**H22**). Admin/reception после **H12** — любой урок орг.  
**Усугубление SPA:** недельная сетка и соседние хуки (`useScheduleForWeek`, `PersonalLessonSaleForm`, `useVenueCostEstimate`, `useScheduleMissingTeachers`) вызывают `usePersonalLessons({ excludeCancelled: true })`. Для teacher это **не** view, а `.from("personal_lessons")` — штатный обход R4, не только Postman. Причина ветки — отсутствие `cancelled_at` на view, не `client_id4`. `personalLessonsSelectTeacher` **не** селектит `price_id` — `PayPersonalLessonModal` у teacher не резолвит архивный тариф с урока (оплата через активный каталог всё ещё жива).  
**Импакт:** R4 fail; переписывание истории расписания и кассы персоналок без RPC; связка с **H13** (`meta.can_edit_past_schedule = true` на себе через PATCH member).  
**Как чинить:** заменить `FOR ALL` teacher/admin на INSERT (и для слотов — INSERT/UPDATE/DELETE) **без** SELECT на уроках. Teacher SELECT только через view: дописать `cancelled_at` и **`price_id`** (FK тарифа, не сумма; `PayPersonalLessonModal` резолвит архив по `lesson.priceId`; `client_id4` не дублировать — уже есть); перевести `excludeCancelled` на view; **потом** снять SELECT из write-политики. `REVOKE UPDATE, DELETE ON personal_lessons` у authenticated — SPA использует RPC. В write слотов: `date`/`valid_from` прошлое — `can_edit_past_schedule()`. `paid`/`price` на INSERT продажи не трогать.

### H27. `finish_subscription` / freeze RPC без `teachers_can_sell_subscriptions` (в отличие от RLS `subscriptions`)

**Где:** `finish_subscription` (`20260717000001`, переопределён в `20260834000001_group_capacity_waitlist.sql`, актуально `20260836000001`); `apply_subscription_freeze_period` / `cancel_subscription_freeze_period` (`20260833000001_subscription_freeze_periods.sql`) — `member_can_manage_subscription_freeze()` / прямой вызов в RPC. Для teacher: только `teacher_can_access_subscription(p_sub_id)` — **без** `teacher_can_write_subscriptions()`. В RLS `subscriptions_update_teacher` флаг **есть** (`20260706000001_v2_teacher_subscriptions_write_guard.sql`). `replace_subscription_partner` флаг **проверяет** (`member_can_replace_subscription_partner`).  
**Суть:** при `teachers_can_sell_subscriptions = false` преподаватель с доступом к абонементу через scope всё равно: (1) `rpc/finish_subscription` → `status = 'finished'`; (2) `apply_subscription_freeze_period` / `cancel_subscription_freeze_period` — заморозка/отмена freeze. Прямой `PATCH subscriptions.status` teacher блокируется RLS, RPC — нет.  
**Уточнение:** `PERFORM notify_groups_after_subscription_release` был в `20260834000001` и **пропал** в актуальном `20260836000001` (функция перезаписана без notify). Waitlist при finish сейчас не вызывается — не считать частью живого импакта.  
**Импакт:** обход org-флага §9 «преподавателям продажа абонементов»; досрочное закрытие абонемента и продление `expires_at` через freeze без участия администрации.  
**Как чинить:** в `finish_subscription` и `member_can_manage_subscription_freeze` для `teacher` — `teacher_can_write_subscriptions() AND teacher_can_access_subscription(...)` (как в `replace_subscription_partner`). Не «восстанавливать» notify в этом прогоне, если продукт его убрал отдельно.

### H28. Admin/reception меняет привязки тарифов через REST, минуя `can_manage_prices()`

**Где:** `price_disciplines_write_admin` / `price_teacher_members_write_admin` (`20260913000001_price_disciplines.sql`, `20260805000001_price_teacher_binding.sql`) — `FOR ALL` + `can_write_all_business()` (owner/director/admin; reception после **H12**). Таблица `prices` пишется только через `can_manage_prices()` = owner/director (`20260629000001_v2_rbac_roles_refinement.sql`). Явный `GRANT INSERT, UPDATE, DELETE ON price_disciplines, price_teacher_members TO authenticated`.  
**Суть:** reception/admin не может `PATCH prices.amount`, но может `INSERT`/`DELETE` строки `price_disciplines` (привязка тарифа к дисциплинам) и `price_teacher_members` (привязка к преподавателям) — переназначить, кому доступен тариф, или снять все привязки (пустой join = «всем» по логике `price_matches_slot_discipline`). UI тарифов зовёт owner/director flow.  
**Импакт:** саботаж pricing strategy без права менять суммы; reception после снятия `restricted_admin` переназначает тарифы; обход модели «тарифы только owner/director».  
**Как чинить:** write на `price_disciplines` / `price_teacher_members` — `can_manage_prices()` (как на `prices`). **Не** `REVOKE` write: `usePrices` синхронизирует junction таблицами через REST, отдельного RPC сохранения привязок нет.

### H29. Закрытый кассовый период не действует на основную кассу (только аренда зала)

**Где:** `_is_finance_period_closed()` создан в `20260862000001_rental_operation_date.sql`. Вызовы `IF _is_finance_period_closed(...)` в миграциях — **только** rental: `record_rental_payment`, invoices/advances (`20260863000001`), fiscal documents (`20260868000001`). UI `isFinancePeriodClosed` — только `RecordRentalPaymentModal` и `RenterFinanceModals`.  
**Не проверяют период (SQL, актуальные определения):**

| Контур | Функция / политика |
|--------|-------------------|
| Абонементы | `record_subscription_payment` (`20260840000001` + обёртка `20260853000001`) |
| Персоналки | `record_personal_lesson_payment` (тарифные переопределения `20260918`/`20260920`) |
| Drop-in | `record_single_visit` |
| Мастер-классы | `record_calendar_event_payment` / `update_calendar_event.income_amount` (`20260831100001`) |
| Возвраты | `finish_subscription_with_refund` (`20260888000001`) — ещё и **клиентский** `p_operation_date` |
| Коррекции | `storno_payment` / `correct_payment` / `update_payment_method` / `update_payment_in_place` (**M44**) |
| Прочее | `restate_personal_lesson_amount` (**M37**); `write_off_personal_lesson_debt` (2.8.73, `20261001000001` — DEFINER, `can_read_financial()`, без периода); REST `expenses` (**M23**); REST `payments` (**H21**); REST `teacher_pay_rates` |

Комментарий в `organization_settings.finance_period_closed_until`: «operation_date ≤ this requires correction path». Correction path (`storno`/`correct`) периода **тоже не читает**. M44 ранее утверждал обратное — **неверно** (восьмой проход). Запретить коррекции в закрытом месяце (как в первой редакции S11) — **смена продукта**, не «закрыть дыру в комментарии к колонке»: комментарий как раз оставляет сторно/correct как путь.  
**Суть:** владелец закрывает месяц в настройках. Аренду SQL режет. Касса абонементов/персоналок/drop-in/мастер-классов, возвраты, сторно и **списание AR** (`write_off_personal_lesson_debt`) пишутся как в открытом периоде. Reception/accountant после **H12** (сброс `finance_period_closed_until`) и без сброса — для этих RPC период и так не существует.  
**Импакт:** закрытие кассы — UI-декорация для основной выручки школы; задним числом и в «закрытом» месяце можно принять оплату, сделать возврат с произвольной `p_operation_date`, сторнировать, **списать долг персоналки**. Не cross-tenant.  
**Как чинить:** в каждом **приёме денег** (`record_subscription_payment`, `record_personal_lesson_payment`, `record_single_visit`, `record_calendar_event_payment`, `finish_subscription_with_refund`) и в правке «на месте» (`update_payment_in_place`, `restate_personal_lesson_amount`, **`write_off_personal_lesson_debt`**) — `_is_finance_period_closed`. Для платежей без отдельной даты — `_org_local_date(org)`. Для write-off — дата урока (`personal_lessons.date`) или `_org_local_date`. Запрет клиентского `p_operation_date` ≤ закрытого дня как обхода приёма. **`storno_payment` / `correct_payment` / `update_payment_method` в этом шаге не резать** (correction path в комментарии колонки). UI продаж — тот же признак, что rental. См. **S11**.

### H30. Преподаватель читает `personal_lesson_charges.billed_amount` (обход R4)

**Где:** `personal_lesson_charges_select_teacher` в `20260920000001_personal_lesson_charges.sql` — `teacher_can_access_lesson(pl.id)` (тот же discipline-scope, что **H16**). Write-политик нет (INSERT только DEFINER). Явного `GRANT` в миграции нет — на production ALL у `authenticated` (**M31**), SELECT проходит. Колонки: `client_id`, `billed_amount`.  
**Суть:** R4 убрал `price`/`paid` с view `personal_lessons_teacher_v`. Базовая таблица урока всё ещё читается через `FOR ALL` (**H26**). Даже после фикса H26 (SELECT только через view) charges остаются отдельной таблицей с суммой начисления по клиенту. UI может прятать — `GET /rest/v1/personal_lesson_charges?select=billed_amount,client_id` нет.  
**Импакт:** обход R4: teacher видит AR персоналок в своём (и чужом в той же дисциплине) scope. Не cross-tenant.  
**Как чинить:** teacher REST dump `billed_amount` закрыть. **Не** DROP SELECT, пока `usePersonalLessonChargeBalances` зовётся с сетки (`useScheduleDebtors` — teacher видит блок должников без сумм в UI, но запрос читает `billed_amount` + `payments.amount`) и из `PayPersonalLessonModal`. Сначала хук: должники teacher по `paid='no'` на view без сумм; оплата — тариф/RPC remaining, не табличный dump. Потом запрет SELECT сумм. Финансовым ролям полные строки. См. **S18**.

### H31. Любой authenticated мигрирует **чужой** тенант, подставив UUID platform-developer в `p_actor_user_id`

**Где:** `migrate_organization_version` в `20260625000002_v2_version_migration.sql` — `SECURITY DEFINER`, `GRANT EXECUTE … TO authenticated`.  
`v_actor := coalesce(p_actor_user_id, auth.uid())`. Проверка: `is_platform_developer(v_actor) OR auth_platform_role() = 'developer'`. Членства в `p_organization_id` **нет**.  
**Уточнение десятого прохода:** хук `custom_access_token_hook` в актуальном определении (`20260627000002_v2_jwt_member_role_claim.sql`) **копирует** `app_metadata.platform_role` в top-level claim. Для **обычного** JWT без `platform_role` в `app_metadata` `auth_platform_role()` по-прежнему `NULL` — атака идёт через `is_platform_developer(p_actor_user_id)`. Для учётки с `platform_role=developer` вторая ветка **жива** без spoof — см. **H33**.  
**Суть:** любой залогиненный пользователь (teacher любой школы) вызывает `POST /rest/v1/rpc/migrate_organization_version` с `p_actor_user_id` = UUID известного разработчика платформы и `p_organization_id` любой орг. UUID разработчика торчит коллегам той школы, где он сам member (**M13**).  
- `p_dry_run: true` — DEFINER считает `clients`/`subscriptions`/`disciplines` **чужого** тенанта и возвращает counts (`run_version_migration_v2_to_v3`).  
- `p_dry_run: false` — ставит `schema_version_locked`, пишет `organization_version_migrations` от имени жертвы-developer, меняет `organizations.crm_version_id`. Текущий stub v2↔v3 не дропает строки, но блокирует орг и портит указатель версии.  
**Импакт:** кросс-тенантный oracle по объёму базы + DoS/порча версии любой школы без членства. Аудит `initiated_by` указывает на разработчика, не на атакующего. Класс тот же, что **H23**, но с выбором жертвы по UUID.  
**Как чинить:** игнорировать клиентский `p_actor_user_id`, всегда `auth.uid()`; `REVOKE EXECUTE FROM authenticated` (только `service_role` / Dev Console Edge); членство не нужно — это платформенная операция.

### H32. Преподаватель читает `single_visits.amount` / `method` / `client_id` (обход R4 для drop-in)

**Где:** `single_visits_select_operational_financial` в `20260731000001_single_visit_dropins.sql`. Teacher ветка: `teacher_member_id = auth_member_id() OR teacher_has_discipline_access(discipline_id) OR teacher_has_location_access(location_id)` — **без** маскирующего view. Колонки таблицы: `amount`, `method`, `client_id`, `client_display`, `price_id`. Явного `GRANT` в миграции нет — на production ALL (**M31**). Write admin без `admin_can_record_single_visits` — **H20**.  
**Суть:** teacher с доступом к дисциплине или локации `GET /rest/v1/single_visits?select=amount,method,client_id,client_display` снимает кассу разовых посещений (свои и чужие в том же scope). R4 закрыл финансы абонементов/персоналок views; drop-in — отдельная таблица, как мастер-классы (**H24**) и charges (**H30**).  
**Импакт:** обход R4 на drop-in; ФИО клиента + сумма + способ оплаты. Не cross-tenant.  
**Как чинить:** teacher SELECT — view без `amount`/`method`/`price_id` или только свои `teacher_member_id`; финансовым ролям полная строка. **В том же прогоне** `useSingleVisits` (`AttendancePanel`): teacher не селектит финансовые колонки, иначе журнал drop-in падает. Журнал (кто/дата/слот) оставить. См. **S16**.

### H33. JWT `platform_role=developer` открывает platform-таблицы **всех** тенантов из CRM SPA (L23 был неверен)

**Где:** актуальное определение `custom_access_token_hook` — `20260627000002_v2_jwt_member_role_claim.sql` (последнее в миграциях; более поздних переопределений **нет**):

```sql
platform_role := claims -> 'app_metadata' ->> 'platform_role';
IF platform_role IS NOT NULL AND platform_role <> '' THEN
  claims := jsonb_set(claims, '{platform_role}', to_jsonb(platform_role));
END IF;
```

`auth_platform_role()` (`20260620000002`) читает **top-level** claim. Политики:

| Объект | Политика | Что даёт developer JWT |
|--------|----------|-------------------------|
| `platform_audit_log` | `platform_audit_log_developer` `FOR ALL` **без** фильтра строк | SELECT/INSERT/UPDATE/DELETE **всех** активаций/инвайтов/purchase-request всех школ |
| `crm_product_versions` | `crm_product_versions_write_developer` `FOR ALL` | INSERT/UPDATE/DELETE каталога версий продукта (ломает активацию ключей **всех** тенантов) |
| `organization_version_migrations` | `…_select_developer` `USING (auth_platform_role() = 'developer')` **без** `organization_id` | журнал миграций **всех** орг |
| `platform_payment_methods` | `is_dev_console_operator()` (`20260723000002`) читает `auth.users.raw_app_meta_data`, не JWT; `GRANT UPDATE (config, …)` | смена кошельков/QR оплаты лицензий, которые видит любой authenticated (**L22**) |
| `migrate_organization_version` | `auth_platform_role() = 'developer'` | миграция **любой** орг **без** spoof `p_actor_user_id` (**H31** для не-developer остаётся) |

На production табличный ALL у `authenticated` (**M31**) — GRANT не мешает. Dev Console Edge (`isDeveloper`) дополнительно пускает email-allowlist; этот путь — **PostgREST из CRM**, без Edge-аудита `dev-console-*`.  
**Кто затронут:** учётки с `raw_app_meta_data.platform_role = 'developer'` (те же люди, что L8/L14: логинятся в CRM, создают self-service demo). Компрометация ящика разработчика = не только Dev Console, но и прямой dump/порча platform-таблиц из того же JWT, что открывает школу.  
**Импакт:** кросс-тенантное чтение platform audit; порча `crm_product_versions`; подмена реквизитов оплаты лицензий (все школы видят QR/кошельки); миграция чужих орг. Не «teacher чужой школы», а **platform-роль в клиентском JWT**.  
**Ошибка девятого прохода:** L23 утверждал, что хук claim не выставляет и политики «мертвы». Это **неверно** с `20260627000002`.  
**Как чинить:** не класть `platform_role` в клиентский JWT; `REVOKE ALL ON platform_audit_log FROM authenticated`; write на `crm_product_versions` только `service_role`; UPDATE `platform_payment_methods` — только Dev Console Edge + `service_role`. Политики `USING (auth_platform_role() = 'developer')` убрать.

---

## Средние

### M1. UI-роуты и `isReadOnly` не защищают API

**Где:** `PanelAccessRoute`, `permissions.ts`, `OrganizationProvider.isReadOnly`.  
**Суть:** скрытие `/finance` или баннер read-only не мешает вызвать RPC/таблицы с тем же JWT. Источник истины — RLS/`organization_allows_writes`. Сейчас запись после истечения демо на SQL закрыта (**кроме H10**); **модули** (`finance_basic` и т.д.) **не** дублируются в RLS — выключенный в UI финанс при живой роли accountant/owner всё ещё читается через REST.  
То же fail-open: `teachers_can_edit_clients` (H11), `teachers_can_sell_personal_lessons` / `teachers_can_view_full_schedule` / `admin_can_manage_team` (M21), `directors_can_mark_attendance` (M27, **H14**), `admin_can_edit_schedule` / `can_edit_past_schedule` (M40, **H26**), `teachers_can_sell_subscriptions` (**H27** — finish/freeze RPC; **H15** ещё и DELETE абонемента), `can_manage_prices` vs `price_disciplines`/`price_teacher_members` (**H28**), `finance_period_closed_until` вне аренды (**H29**, в т.ч. `write_off_personal_lesson_debt` с 2.8.73), прямой REST на `attendance` / `subscriptions` / `payments` / `personal_lessons` / rental billing / payroll settlements / rental series (H14–H18, H21–H22, **H25–H26**) вместо RPC. Reception: UI скрывает настройки/команду, REST даёт полный admin (**H12**). `teachers_can_export` / `admin_can_export` режут кнопку, не REST (H8) и не Storage `exports` (**M51**). `can_export_data()` в SQL читает флаги, но не используется в RLS таблиц. `admin_can_accept_payments` / `admin_can_record_single_visits` — только RPC (**H20**, **H21**). Drop-in суммы видны teacher (**H32**). Platform migrate с клиента (**H31**). Developer JWT открывает `platform_audit_log` / write `crm_product_versions` (**H33**). `list_archived_prices` отдаёт teacher `sales_count` (**M57**). `close_group_lesson_occurrence` принимает фейковый attendee_count (**M59**).  
**Импакт:** обход «выключили модуль» / «спрятали пункт меню» / «преподавателям нельзя редактировать клиентов».

### M2. Пригласивший получает plaintext `invite_url`

**Где:** `invite-member/index.ts` ответ `{ invite_url }`.  
**Импакт:** owner/director может завершить приглашение **за** invitee (вместе с C1 — смена пароля жертвы). Даже без C1 — принять приглашение и получить сессию invitee.  
**Как чинить:** не отдавать URL в API; только email; для существующего пользователя — только «войти и принять», без set-password.

### M3. Короткий токен приглашения + публичные preview/complete

**Где:** `inviteToken.ts` — 8 символов × 32; `preview-invite` / `complete-invite` без JWT. Preview отдаёт `email` + `organization_name`.  
**Импакт:** онлайн-перебор теоретически тяжёлый (~2^40), но rate limit слабый (M/H6). Preview — утечка email по токену.  
**Как чинить:** 128-bit random; durable rate limit; preview без email или после auth.

### M4. Много Edge Functions с `verify_jwt = false`

Публичные: `request-demo-key`, `preview-invite`, `complete-invite`, `verify-self-service-registration`, `landing-track-event`, `google-calendar-auth-callback`, `google-calendar-webhook`, cron-воркеры.  
Cron закрыт секретом (см. L5). Webhook GCal — токеном канала (см. L4). `landing-track-event` — неаутентифицированная запись в БД (DoS по строкам, 120 req/окно на изолят).  
**Как чинить:** durable limit; для landing — Turnstile или отбрасывать на edge.

### M5. Views преподавателя с `security_invoker = false`

**Где:** `subscriptions_teacher_v`, `personal_lessons_teacher_v` в `20260701000001_v2_client_notes_and_teacher_field_masking.sql`; актуальное тело персоналок — `20260718000001` (client_id4 + paid); также `financial_debtors_v` и последующие переопределения (`20260702000001`, `20260919000001`, `20260920000001`, …) — `WITH (security_invoker = false)`. Часть финансовых view уже `security_invoker = true` (venue costs) — паттерн непоследовательный.  
**Суть:** view выполняется с правами владельца, RLS базовых таблиц обходится; фильтр только в `WHERE` view. Сейчас `WHERE` есть (`auth_organization_id`, role, `can_read_financial` / `teacher_can_access_*`). Ошибка в фильтре = утечка чужих строк без RLS-страховки. `financial_debtors_v` отдаёт имена и telegram должников бухгалтеру — задумано, но без invoker.  
**Как чинить:** `WITH (security_invoker = true)` на PG15+ **только** для view, у которых вызывающая роль уже имеет SELECT на **все** базовые таблицы. Masking views преподавателя (`subscriptions_teacher_v`, `personal_lessons_teacher_v`) **и** `financial_debtors_v` **оставить** `security_invoker = false`: teacher SELECT на base после R4/S09 нет; дебиторы accountant джойнят payments/charges/уроки/клиентов — иначе view умирает.

### M6. `GRANT SELECT ON access_keys TO authenticated`

**Где:** `20260620000003_v2_tenant_rls.sql`. Политика: owner своей орг, `organization_id IS NOT NULL`.  
**Импакт:** owner видит `key_hash`, email, статусы ключа своей орг. Hash без pepper не обратим, но это лишняя поверхность (онлайн-сравнение, утечка факта ключа). Комментарий в миграции обещает «no direct client access» — грант этому противоречит.  
**Как чинить:** `REVOKE SELECT FROM authenticated`; только service_role.

### M7. В API включена схема `graphql_public`

**Где:** `config.toml` `[api] schemas = ["public", "graphql_public"]`.  
**Импакт:** дополнительный GraphQL-контур поверх тех же таблиц. RLS должен применяться, но это второй способ снять данные и обойти привычные REST-привычки мониторинга.  
**Как чинить:** убрать `graphql_public`, если GraphQL не используется.

### M8. Нет MFA, нет принудительного таймаута сессии

**Где:** config.toml — passkey/MFA не включены; `[auth.sessions] timebox` закомментирован.  
**Импакт:** украденный пароль/JWT живёт долго; нет второго фактора у owner (доступ к экспорту и команде).

### M9. Turnstile обязателен в UI, не в GoTrue signup

**Где:** `RegisterPage` зовёт `verify-self-service-registration` до `signUp`; `AuthProvider.signUpWithEmail` идёт напрямую в `supabase.auth.signUp` без captcha.  
**Импакт:** бот бьёт `/auth/v1/signup` минуя UI (если в Dashboard нет captcha — H5). Создание орг всё же требует consumed challenge в RPC (для не-developer). Мусорные auth-пользователи без орг остаются.

### M10. `ErrorBoundary` показывает `error.message` пользователю

**Где:** `tangodb/src/components/ui/ErrorBoundary.tsx`; также `parseAuthError` в `authErrors.ts` — неизвестные сообщения GoTrue возвращаются **как есть** (`return message`).  
**Импакт:** внутренние тексты Postgres/PostgREST (имена таблиц, RLS, RPC) в UI; сырые ответы Auth при регистрации/логине.

### M11. JWT `organization_id` живёт до истечения access token

**Где:** `custom_access_token_hook` пишет claims при выдаче JWT; `jwt_expiry = 3600`. RLS `auth_organization_id()` читает claim. `current_member_role()` смотрит **БД** — роль после demote обновляется сразу. Но org-claim до refresh: деактивированный member с ещё живым JWT и `is_active=false` должен отсекаться `is_active_member`. Если какая-то политика проверяет только `organization_id = auth_organization_id()` без member-check — окно до 1 часа.  
**Импакт:** residual; UI `claimsMismatch` режет finance/settings, не все панели и не REST.  
**Как чинить:** после смены роли/орг всегда `refreshSession`; при deactivate — logout/revoke refresh (Supabase signOut globally / ban user).

### M12. Офлайн-снимок PII на диске браузера

**Где:** IndexedDB `tangodb-offline`, TTL 72 ч, окно −3…+7 дней. `useOfflineSecurityReset` чистит при logout/смене орг — не при краже профиля ОС, не при «забыли выйти» на общем компьютере.  
**Импакт:** другой пользователь Windows / malware читает клиентов и очередь отметок.

### M13. Любой активный член орг читает полный roster команды (PII + `user_id`)

**Где:** `organization_members_select_active_org` — только `is_active_member` + `organization_allows_reads`, **без** проверки роли. `useTeamMembers` селектит `user_id, role, phone, telegram, contact_email, scope, profile_notes`.  
**Импакт:** teacher и accountant видят телефоны/Telegram/email владельца и всех сотрудников и UUID для H9. UI команды может быть спрятан — REST нет.  
**Как чинить:** roster-view без phone/telegram/`user_id`/`scope`/`profile_notes` (ФИО + `role` + `is_active` + признак reception) для сетки и дропдаунов (**S19**); полный SELECT — `TeamSettingsPage` / `MemberProfileModal`. **Не** DROP teacher SELECT на `organization_members` до view: `useTeamMembers` кормит расписание и тарифы.

### M14. Enumeration email / факта демо

**Где:** `parseAuthError` → «User already registered»; `verify-self-service-registration` / RPC demo → `Demo already used for this email`; `request-demo-key` → 409 `Demo key already requested for this email`.  
**Импакт:** бот проверяет, кто уже в Auth и кто брал демо. Для CRM с H5 (confirm email off) это список целей для C1/перебора пароля.  
**Как чинить:** одинаковый ответ на signup/demo-key независимо от существования; rate limit durable (H6).

### M15. `redirectTo` сброса пароля берётся с клиента

**Где:** `getSiteUrl()` — `VITE_SITE_URL` или `window.location.origin`; `resetPasswordForEmail({ redirectTo: …/auth/reset-password })`. GoTrue пускает только URL из `additional_redirect_urls` / `site_url`.  
**Импакт:** если в Dashboard allowlist есть preview (`*.vercel.app`) или забытый origin, фишинговый клон SPA (anon key публичный) заказывает письмо с редиректом на себя и забирает recovery-сессию. Без лишнего origin — не бьёт.  
**Как чинить:** всегда `VITE_SITE_URL` = прод; в Auth allowlist только этот origin; не добавлять preview.

### M16. Инвайт заранее создаёт confirmed-пользователя без пароля

**Где:** `ensureInvitedAuthUser` — `auth.admin.createUser({ email, email_confirm: true })` без `password`, **до** принятия.  
**Импакт:** на email появляется учётка; «забыли пароль» работает, хотя человек инвайт не принимал; `email_confirmations` в Dashboard не защитят этот ящик (уже confirmed). Связка с C1: complete потом ставит пароль.  
**Как чинить:** не createUser до complete/accept; для нового — создавать в complete-invite; для существующего — не трогать Auth.

### M17. Recovery-код владельца в JSON и в `history.state`

**Где:** `create-self-service-demo-org` отвечает `{ recovery_code }`; `RegisterPage` делает `navigate(..., { state: { recoveryCode } })`; код нужен `dev-console-transfer-owner-email`.  
**Импакт:** XSS (H3) или расширение читает код в момент онбординга; Dev Console с кодом перепривязывает owner. 12 символов × алфавит 32 ≈ 60 бит — для support-only ок, для XSS нет.  
**Как чинить:** показать код один раз на серверно отрендеренном шаге / только письмом; не класть в JSON, если клиент его уже отобразил; не таскать в `location.state`.

### M18. Waitlist: `organization_id` без проверки членства

**Где:** `submit-subscription-waitlist` — JWT обязателен, но `organization_id` из body пишется в `platform_waitlist` без `organization_members`.  
**Импакт:** спам/подмена «эта школа в waitlist» в Dev Console; не доступ к данным школы.  
**Как чинить:** принимать org id только если caller — активный member; иначе NULL.

### M19. Политики INSERT/UPDATE на `payments` для reception/admin (в обход RPC коррекций)

**Где:** `payments_write_admin` / `payments_update_admin` после R6: `can_write_all_business() OR can_write_reception()`. Явного `GRANT ON payments` в миграциях нет, но клиент **читает** таблицу (`usePayments`) — SELECT у `authenticated` точно есть. Если грант табличный ALL (auto-expose / Dashboard), reception делает `PATCH amount` без `correct_*` RPC, venue-cost ack и закрытого периода.  
**Импакт:** порча кассовой книги, если GRANT шире SELECT. На production ALL подтверждён (**M31**) — достижимо; это тот же контур, что **H21**. Не чинить отдельно от S09.  
**Как чинить:** сверить `\dp public.payments`; оставить только SELECT; запись — существующие SECURITY DEFINER RPC.

### M20. Turnstile fail-open, если `TURNSTILE_SECRET_KEY` не задан

**Где:** `tangodb/supabase/functions/_shared/turnstile.ts` — при отсутствии секрета `return { ok: true }` («Local/dev: skip»). Вызывается из `verify-self-service-registration` до insert challenge.  
**Импакт:** в production/staging с забытым секретом captcha на регистрации и повторном создании демо (`VerifyEmailPage`) **полностью отключена**; боты создают challenge и демо-орг без Turnstile. UI `RegisterPage` показывает виджет, но сервер его не проверяет.  
**Как чинить:** без секрета возвращать `{ ok: false }` в production (env `ENVIRONMENT=production`); алерт при деплое, если секрет пуст.

### M21. Часть org-флагов §9 существует в `organization_settings`, но SQL их не читает

**Где:** миграция `20260704000001_v2_rbac_org_setting_overrides.sql` добавила колонки; сравнить с использованием в `tangodb/supabase/migrations/`.  
**Не читаются в RLS/RPC (только UI `permissions.ts`):** `teachers_can_edit_clients` (H11), `teachers_can_sell_personal_lessons`, `teachers_can_view_full_schedule`, `admin_can_manage_team`.  
**Читаются в SQL RPC, но не в RLS write тех же сущностей:** `directors_can_mark_attendance` (**M27**, **H14**), `admin_can_edit_schedule` (хелпер аренды и RPC `move_group_lesson` / calendar events / vacation — **не** `schedule_slots_write_admin` / `personal_lessons_write_*`, **M40**), `can_edit_past_schedule()` только в RPC удаления/правки урока (**H26**), `teachers_can_sell_subscriptions` в RLS `subscriptions_*`, но **не** в `finish_subscription` / freeze RPC (**H27**), `can_manage_prices()` на `prices`, но **не** на `price_disciplines` / `price_teacher_members` (**H28**). `finance_period_closed_until` / `_is_finance_period_closed` — только rental RPC, не основная касса (**H29**). `teachers_can_view_full_schedule` не читается в `get_rentals_for_schedule_week` (**M47**).  
**Читаются в SQL RLS/хелперах:** `teachers_can_sell_subscriptions` (`teacher_can_write_subscriptions`), `teachers_can_manage_disciplines`, `teachers_can_record_single_visits`, `teachers_can_export` / `admin_can_export` (`can_export_data()` — но не RLS таблиц).  
**Импакт:** владелец выключает «преподавателям персональные уроки / полное расписание / admin управляет командой» — API это не видит. Reception с `admin` role всё равно `can_manage_team()` в SQL (**H12**), даже при `admin_can_manage_team = false`.  
**Как чинить:** для каждого флага §9 — helper в SQL + политики/RPC (как RBAC-3 для subscriptions); `can_manage_team()` учитывает `admin_can_manage_team` и `NOT is_restricted_admin()`.

### M22. `complete-invite` возвращает полную сессию invitee в JSON

**Где:** `tangodb/supabase/functions/complete-invite/index.ts` — ответ `{ access_token, refresh_token, organization_id, role }` после `signInWithPassword`. `verify_jwt = false`.  
**Суть:** помимо C1 (смена пароля чужого пользователя) любой, кто перехватил `invite_url` (M2) или угадал токен (M3/H6), получает **готовые JWT** в теле ответа без cookie/httpOnly.  
**Импакт:** кража ссылки = немедленный вход; логи прокси/аналитики/расширения браузера у приглашающего могут сохранить токены.  
**Как чинить:** не возвращать токены; редирект на `/login` или Set-Cookie через BFF; для существующего пользователя — только «войдите и примите инвайт».

### M23. Прямой REST на `expenses` не проверяет закрытый кассовый период

**Где:** `expenses_insert` / `expenses_update` / `expenses_delete` в `20260727000001_v2_expenses.sql` — только `can_read_financial()` + `business_row_writable()`; **нет** `_is_finance_period_closed()`. Закрытие периода проверяется в rental/payment RPC (`20260862000001_rental_operation_date.sql` и последующие), не в RLS `expenses`. Явный `GRANT` на `expenses` для `authenticated` в миграциях **не найден** — доступ зависит от Data API defaults (**L10**).  
**Импакт:** accountant (и owner/director) правит/удаляет расходы в закрытом периоде через PostgREST, минуя UI и RPC; reception после сброса `finance_period_closed_until` (**H12**) открывает период для rental RPC, но `expenses` и основная касса (**H29**) период и так не проверяют.  
**Как чинить:** в политиках write — `NOT _is_finance_period_closed(organization_id, expense_date)`. **Не** `REVOKE` write: `useCreateExpense` / `useUpdateExpense` / `useDeleteExpense` пишут таблицу напрямую, RPC расходов нет.

### M24. Admin/reception читает **все** внутренние заметки клиентов (не только свои)

**Где:** `client_notes_select_operational` в `20260701000001_v2_client_notes_and_teacher_field_masking.sql` — `can_read_operational()` без фильтра по `author_member_id` и без `teacher_can_access_client`. Teacher видит только свои заметки (`client_notes_select_teacher`).  
**Суть:** owner/director/admin (в т.ч. reception после **H12**) через REST получает заметки всех преподавателей по всем клиентам орг — внутренние комментарии, которые teacher в UI видит только у себя.  
**Импакт:** утечка внутренних оценок/комментариев staff; reception видит больше, чем предполагает модель R6.  
**Как чинить:** если заметки должны быть приватны — operational read только `author_member_id = auth_member_id()` или отдельный флаг «видны администрации»; либо явно задокументировать как фичу.

### M25. `organization_invites.token_hash` доступен через PostgREST при `can_manage_team()`

**Где:** `organization_invites_select_team` + `GRANT SELECT ON organization_invites TO authenticated` (`20260624000001_v2_organization_invites.sql`). UI (`useTeamInvites`) не запрашивает `token_hash`, но колонка в таблице.  
**Суть:** owner/director/admin/reception (**H12**) может `select=token_hash,email,expires_at` для pending invites. Hash = HMAC токена с pepper; offline brute короткого токена (**M3**) возможен **при утечке pepper** из git/env.  
**Импакт:** усиливает M2/M3/C1; сам hash без pepper не восстанавливает ссылку, но сужает круг атакующих с pepper.  
**Как чинить:** view без `token_hash` для клиента, **затем** `REVOKE SELECT` на базовую таблицу или column privilege. `useTeamInvites` читает таблицу (`id, email, role, …` без hash) — не отзывать SELECT раньше view/RPC списка.

### M26. Teacher с правом продажи абонементов читает waitlist **всей** организации

**Где:** `group_waitlist_entries_select` в `20260834000001_group_capacity_waitlist.sql` — teacher: `teacher_can_write_subscriptions()` без фильтра по `schedule_group_ids` / discipline scope.  
**Импакт:** teacher видит `client_id` и статусы waitlist по всем группам школы, не только в своём scope — расширение PII/operational data (**H7**).  
**Как чинить:** добавить `teacher_can_access_class(class_id)` или фильтр по `schedule_group_ids` из JWT-scope.

### M27. `directors_can_mark_attendance` действует только в RPC, не в RLS `attendance`

**Где:** `directors_can_mark_attendance_setting()` используется в `mark_attendance` (`20260810000001_attendance_scope_payment_comment.sql`); `attendance_write_admin` проверяет только `can_write_all_business()` (director включён).  
**Суть:** владелец выключает «директор может отмечать журнал» — UI и RPC соблюдают, прямой PATCH attendance director'ом **разрешён** (**H14**).  
**Импакт:** обход org-флага §9 для director; связка с бесплатными уроками при PATCH без списания.  
**Как чинить:** вместе с **H14** — убрать direct write; либо в политике admin write: director только если `directors_can_mark_attendance_setting()`.

### M28. Operational/reception может **редактировать и удалять** любые заметки клиентов (не только читать — M24)

**Где:** `client_notes_update_operational` / `client_notes_delete_operational` в `20260701000001_v2_client_notes_and_teacher_field_masking.sql` — `can_write_all_business()` **без** фильтра `author_member_id`. Teacher ограничен своими (`client_notes_update_teacher`).  
**Суть:** owner/director/admin/reception (**H12**) через REST меняет или удаляет внутренние заметки преподавателей — не только читает (M24). Можно подменить текст «оценки клиента» или стереть комментарий коллеги.  
**Импакт:** порча/удаление внутренних комментариев staff; reception видит и правит больше, чем R6.  
**Как чинить:** operational write только `author_member_id = auth_member_id()`; либо явный флаг «заметки видны/редактируются администрацией».

### M29. `audit_log` отдаёт owner/director полные снимки строк (`old_data` / `new_data`)

**Где:** `audit_log_select_leadership` в `20260623000001_v2_business_rls.sql`; триггер `audit_trigger_fn` пишет JSON снимки при INSERT/UPDATE/DELETE на бизнес-таблицы. `GRANT SELECT ON audit_log TO authenticated`.  
**Импакт:** director (и owner) через REST выгружает историю изменений с PII/финансами из `old_data`/`new_data` — шире, чем текущий UI. Усиливает **H9** (director → owner). Компрометация director-аккаунта = полный audit trail.  
**Как чинить:** view без `old_data` для director; отдельный permission; или audit только через RPC с фильтром полей.

### M30. Teacher меняет `subscription_groups` без `teachers_can_sell_subscriptions` — **дубль H19**

**Где:** см. **H19**. Отдельной уязвимости нет: те же политики `subscription_groups_insert_teacher` / `_delete_teacher`. Пункт оставлен, чтобы не ломать ссылку S16 («вместе с H19»).  
**Импакт / как чинить:** как **H19**. Не считать второй средней находкой при приоритизации.

### M31. `auto_expose_new_tables` на production даёт **ALL** у `authenticated` (и `anon`) — **подтверждено 2026-08-22**

**Где:** `config.toml` — `auto_expose_new_tables` не выключен (**L10**). Проверка production проекта `tangodb` (`gizfpiujqjwbjtqfstbj`): `information_schema.table_privileges` — на все проверенные таблицы у `authenticated` и `anon` привилегии `DELETE, INSERT, SELECT, TRUNCATE, UPDATE` (полный набор).  
**Таблицы без явного `GRANT` в миграциях** (`payments`, `single_visits`, `rental_invoices*`, `expenses`, …) — на production **имеют** ALL у `authenticated` → **H17–H22**, **M23**, **M19** достижимы через REST, не гипотетически.  
**Таблицы с частичным GRANT в миграциях** (`teacher_settlements` — в SQL только `SELECT, INSERT, UPDATE`; на production также `DELETE` у `authenticated` — auto-expose). DELETE по settlements блокируется отсутствием DELETE-политики RLS; INSERT/UPDATE — **H18** работает.  
**RLS:** на проверенных таблицах `relrowsecurity = true`, `relforcerowsecurity = false`.  
**Импакт:** misconfig «expose new tables» = полный write API для любой роли с проходящей RLS-политикой.  
**Как чинить:** Dashboard → Data API → Expose new tables = OFF; миграция с `REVOKE ALL ON … FROM anon, authenticated` + явный `GRANT SELECT` (или только RPC); `auto_expose_new_tables = false` в `config.toml`.

### M32. `anon` имеет табличные **ALL** на tenant-таблицы без явного `REVOKE` в миграциях

**Где:** production `\dp` (через `table_privileges`) — `anon`: `DELETE, INSERT, SELECT, TRUNCATE, UPDATE` на `clients`, `payments`, `subscriptions`, `attendance`, rental billing, payroll и т.д. Явный `REVOKE FROM anon` в миграциях — только на узком наборе (`user_google_accounts`, `platform_waitlist`, venue-cost views, …), **не** на core business tables.  
**Сейчас:** политики RLS для `anon` на `payments`/`clients`/… **не найдены** → PostgREST с anon JWT получает отказ RLS (не «открытая школа»).  
**Импакт:** defense-in-depth провален: любая ошибка политики (`TO public`, `USING (true)`), SECURITY DEFINER без `auth.uid()`, или `FORCE ROW LEVEL SECURITY` не включён для owner — anon key из SPA мгновенно даёт write.  
**Как чинить:** массовый `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon` + whitelist только публичных endpoint-таблиц; оставить RLS как второй слой.

### M33. CSV-экспорт не экранирует формулы Excel (`=`, `+`, `-`, `@`)

**Где:** `tangodb/src/lib/exportCsv.ts` — `escapeCsvCell` ставит кавычки только если в значении есть `;`, `"`, перевод строки. Префикс-quote для `=CMD|...`, `=HYPERLINK(...)`, `+`, `-`, `@` **нет**. Экспорт используют dashboard/finance/conducted lessons / rental invoice (`exportDashboardCsv`, `exportFinancialCsv`, `exportConductedLessonsCsv`, `exportRentalInvoiceDocument`).  
**Суть:** teacher/reception создаёт клиента или заметку с именем `=HYPERLINK("http://evil/","x")` (**H11** позволяет INSERT клиентов). Owner жмёт «Данные» / CSV — Excel/LibreOffice выполняет формулу при открытии. Разделитель `;` (не `,`) не спасает: формула без `;` уходит без кавычек.  
**Импакт:** классический CSV injection на машине сотрудника, который открывает выгрузку; не RCE сервера.  
**Как чинить:** если значение начинается с `=`, `+`, `-`, `@`, `\t`, `\r` — префикс `'` и всегда оборачивать в кавычки.

### M34. Пачка SECURITY DEFINER RPC без проверки членства в `p_org_id` / по UUID чужой строки

**Где:** `GRANT EXECUTE … TO authenticated` + `SECURITY DEFINER`, membership/`auth_organization_id()` не сверяется с аргументом:

| Функция | Что утекает / меняется |
|---------|------------------------|
| `apply_scheduled_subscription_member_changes(p_org_id)` | применяет due `scheduled` замены партнёров **любой** орг (write; повторно no-op) |
| `subscription_client_ids_at_date(p_sub_id, date)` | UUID клиентов абонемента **любого** тенанта |
| `subscription_client_display_for_date(p_sub_id, date)` | **ФИО** клиентов чужой школы |
| `count_group_occupied_seats(p_org_id, p_class_id, date)` | занятость группы чужой орг |
| `organization_has_lifetime_license(p_org_id)` / `organization_has_active_subscription(p_org_id)` | oracle лицензии/Stripe |
| `organization_allows_reads(p_org_id)` / `organization_allows_writes(p_org_id)` | oracle статуса/демо-write (**H10**) |
| `is_active_member(p_user_id, p_org_id)` / `member_role(p_user_id, p_org_id)` | oracle членства/роли в **чужой** орг по UUID |
| `member_scope(p_user_id, p_org_id)` | JSON scope преподавателя чужой школы (`discipline_ids`, `can_view_all_clients`, …) |
| `migrate_organization_version(..., p_actor_user_id)` | **H31** — write/oracle любой орг при spoof developer UUID |
| `venue_cost_gap_is_acknowledged(p_org_id, …)` | oracle: есть ли gap-ack у чужой орг (**M56**) |
| `teacher_member_has_future_lessons(p_org_id, p_member_id)` | oracle будущих уроков member в любой орг (**M49**, если PUBLIC EXECUTE) |
| `is_platform_developer(p_user_id)` | oracle: этот UUID — platform developer (**M49**) |

UUID угадать тяжело (v4), но они торчат в календаре, ошибках (**M10**), скриншотах, `invite`/`checkout` URL. **H23** — тот же класс, но с массовым `UPDATE`.  
**Уточнение десятого прохода:** SPA **сама** вызывает `apply_scheduled_subscription_member_changes(organizationId)` при входе в орг (`useApplyScheduledSubscriptionMemberChanges` / `OrgWorkspaceRoute`). Легитимный hot-path. Атака — тот же RPC с чужим `p_org_id` (аргумент не сверяется с `auth_organization_id()`). Не нужен отдельный «открыть DevTools и найти RPC» — он уже в каждом сеансе teacher/accountant.  
**Импакт:** точечный кросс-тенант IDOR при известном UUID; лицензионный oracle.  
**Как чинить:** внутри DEFINER: `p_org_id := auth_organization_id()` (игнорировать клиентский аргумент); для сущностей — `organization_id = auth_organization_id()` до чтения. **Не** `REVOKE EXECUTE FROM authenticated` на `organization_allows_writes/reads`, `is_active_member`, `member_role`, `member_scope` — они в RLS, без EXECUTE у роли политики не считаются. `REVOKE` только у хелперов, которых RLS не вызывает (`organization_has_*`, `is_platform_developer`). `apply_scheduled_subscription_member_changes` — игнорировать клиентский `p_org_id`, EXECUTE оставить (SPA зовёт).

### M35. Teacher/admin пишет `group_waitlist_entries` через REST, минуя RPC

**Где:** `group_waitlist_entries_write` `FOR ALL` в `20260834000001_group_capacity_waitlist.sql` + `GRANT INSERT, UPDATE, DELETE`; хелпер `member_can_manage_group_waitlist()` включает teacher с `teacher_can_write_subscriptions()` **без** фильтра по `schedule_group_ids`. RPC `add_group_waitlist_entry` / `update_group_waitlist_status` пишут status-events и spot-notifications.  
**Суть:** teacher с правом продажи абонементов `PATCH`/`DELETE` любую строку waitlist школы (не только свою группу) — смена `client_id`/`status`, удаление очереди без истории событий (**M26** — SELECT той же ширины).  
**Дополнение:** `group_spot_notifications_update` — `FOR UPDATE` без ограничения колонок (`GRANT SELECT, UPDATE`). Можно `PATCH client_id` / `waitlist_entry_id`, не только `dismissed_at` (RPC `dismiss_group_spot_notification` трогает dismiss).  
**Импакт:** операционный sabotage очереди; обход флага продажи на уровне RPC-побочек (уведомления).  
**Как чинить:** `REVOKE` write; только RPC; в политике teacher — `teacher_can_access_class(class_id)`.

### M36. Admin/reception `FOR ALL` на `classes` / `locations` / `class_teachers` минуя capacity-RPC

**Где:** `classes_write_admin`, `locations_write_admin`, `class_teachers_write_admin` в `20260623000001` — `can_write_all_business()` (owner/director/admin; reception после **H12**). RPC `update_class_max_capacity` проверяет `member_can_update_class_capacity()`.  
**Суть:** прямой `PATCH classes.max_capacity` / `DELETE` локации / перестановка преподавателей группы без RPC и без `admin_can_edit_schedule` (**M40**).  
**Импакт:** обход вместимости/waitlist-инвариантов; снос справочника залов.  
**Как чинить:** `max_capacity` только `update_class_max_capacity`. Write `locations` в SPA — прямой REST (`useLocations`); не отзывать без перевода хука. Политика admin write слотов — `admin_can_edit_schedule`.

### M37. `restate_personal_lesson_amount` не проверяет закрытый кассовый период

**Где:** `20260916000001_restate_personal_lesson_amount.sql` — `SECURITY DEFINER`, `can_read_financial()`, `GRANT EXECUTE TO authenticated`. `_is_finance_period_closed` **нет** (в отличие от rental/payment RPC).  
**Суть:** accountant/owner/director меняет `personal_lessons.price` (и `paid`) задним числом в уже закрытом периоде. Reception после сброса `finance_period_closed_until` (**H12**) — тем более.  
**Импакт:** правка AR в закрытом месяце без коррекционного контура.  
**Как чинить:** `NOT _is_finance_period_closed(org, lesson.date)` либо запрет если `lesson.date <= finance_period_closed_until`. Тот же порог — у `write_off_personal_lesson_debt` (S11 / **H29**).

### M38. `preview_rental_conflicts` отдаёт ФИО клиентов персональных уроков accountant и любому teacher

**Где:** `preview_rental_conflicts` в `20260870000001_accountant_rental_slot_write.sql` — `SECURITY DEFINER`; пускает `can_read_operational() OR teacher OR can_read_financial()`. В conflicts по personal: `'client_display', COALESCE(p.client_display, '')` **всех** уроков локации/даты, не только своих. Accountant штатно **не** имеет SELECT на `personal_lessons`.  
**Суть:** бухгалтер (и teacher вне scope) зондирует расписание зала и получает имена клиентов чужих персоналок.  
**Импакт:** PII в обход operational/teacher-scope RLS; не cross-tenant.  
**Как чинить:** accountant — только kind/time без имён; teacher — только свои `teacher_member_id` или общее «занято» без `client_display`.

### M39. Fallback `SITE_URL` = `https://tangodb.vercel.app` в инвайтах и Stripe checkout

**Где:** `invite-member/index.ts` (`inviteUrl = ${siteUrl}/accept-invite?token=…`), `create-subscription-checkout/index.ts` (`successUrl`/`cancelUrl`). `Deno.env.get("SITE_URL") ?? "https://tangodb.vercel.app"`.  
**Суть:** если секрет `SITE_URL` не задан в production Edge Functions, письма-инвайты и возврат Stripe ведут на hardcoded Vercel-хост (связка **M15** / **C1**: токен в query).  
**Импакт:** misconfig деплоя = фишинговый/чужой origin получает invite token или checkout session return. Если домен принадлежит проекту — ок; если preview/чужой — критично вместе с C1.  
**Как чинить:** без `SITE_URL` в production — 500, не fallback; тот же origin, что в `ALLOWED_ORIGINS`.

### M40. `admin_can_edit_schedule` действует в RPC аренды/переноса, не в RLS `schedule_slots` / `personal_lessons` / `classes`

**Где:** колонка `organization_settings.admin_can_edit_schedule` (`20260730000002`, default **true**). Читается в `member_can_manage_rentals`, `move_group_lesson_occurrence`, calendar-event RPC, vacation. Политики `schedule_slots_write_admin` / `personal_lessons_write_admin` / `classes_write_admin` — только `can_write_all_business()`.  
**Суть:** владелец выключает «админ редактирует расписание» — UI/часть RPC соблюдают, прямой REST admin на слоты/уроки/группы **разрешён**.  
**Импакт:** обход org-флага §9 для admin; усиливает **H16/H26**.  
**Как чинить:** в admin write-политиках слотов/уроков — `admin_can_edit_schedule` (как в rental helper); либо только RPC.

### M41. Любой активный член читает историю замен партнёров (`subscription_member_changes`)

**Где:** `subscription_member_changes_select` в `20260835000001_subscription_partner_replacement.sql` — только `is_active_member(auth.uid(), organization_id)` **без** роли. Отдельная `subscription_member_changes_teacher_select` с `teacher_can_access_subscription` **не** сужает доступ: политики OR. `GRANT SELECT ON subscription_member_changes TO authenticated`. Колонки: `outgoing_client_id`, `incoming_client_id`, `member_slot`, `effective_date`, `reason`.  
**Суть:** teacher/accountant/reception через `GET /rest/v1/subscription_member_changes` видят все запланированные и применённые замены партнёров в парных абонементах школы — UUID клиентов и причины, даже если teacher не имеет `teacher_can_access_subscription` на конкретный абонемент (первая политика пропускает).  
**Импакт:** утечка operational PII (кто с кем танцует / смена партнёра); расширение разведки перед **H7** (UUID клиентов). UI истории замен может быть спрятан — REST нет.  
**Как чинить:** убрать широкую политику; SELECT — `can_read_operational()` или `teacher_can_access_subscription(subscription_id)`; accountant — `can_read_financial()` если нужен доступ.

### M42. `preview_calendar_event_conflicts` отдаёт ФИО клиентов персоналок teacher/accountant вне discipline-scope

**Где:** `preview_calendar_event_conflicts` в `20260848000001_fix_preview_calendar_event_conflicts.sql` — `SECURITY DEFINER`; пускает `can_read_operational() OR teacher`. В conflicts по personal: `'client_display', COALESCE(p.client_display, '')` для **всех** `personal_lessons` на локации/дату/пересечении времени — без `teacher_can_access_lesson` / `teacher_member_id` filter. Параллель **M38** (`preview_rental_conflicts`).  
**Суть:** teacher вне scope дисциплины (или accountant без SELECT на `personal_lessons`) при создании мастер-класса зондирует зал и получает имена клиентов чужих персоналок.  
**Импакт:** PII в обход teacher-scope RLS; не cross-tenant.  
**Как чинить:** для teacher — только свои `teacher_member_id` или маска «занято»; для operational — без `client_display` (как в фиксе M38 для accountant).

### M43. Любой активный член читает Stripe-подписку организации (`organization_subscriptions`)

**Где:** `organization_subscriptions_select_member` в `20260626000001_v2_organization_subscriptions.sql` — `is_active_member` без роли. `GRANT SELECT ON organization_subscriptions TO authenticated`. Колонки: `plan`, `billing_period`, `status`, `provider`, `current_period_start`, `current_period_end`, `stripe_subscription_id` (если есть).  
**Суть:** teacher/reception/accountant видят, есть ли у школы активная SaaS-подписка, период биллинга и статус (`active`/`past_due`/`canceled`). UI лицензии — owner; REST открыт всем членам. Дублирует oracle **M34** (`organization_has_active_subscription`), но с деталями периода.  
**Импакт:** раскрытие коммерческого статуса школы сотрудникам; `past_due` — сигнал для социнженерии; не cross-tenant.  
**Как чинить:** не `REVOKE SELECT` всей таблицы. `OrganizationProvider` читает `plan, billing_period, status, provider, current_period_*` у **каждого** члена (`isReadOnly` при `past_due`; throw на error). Member: эти колонки; `stripe_subscription_id` — только owner / `can_manage_settings()`. Либо узкий RPC бандла. См. **S24**.

### M44. `update_payment_in_place` не проверяет закрытый кассовый период

**Где:** `20260929000003_update_payment_in_place.sql` — `SECURITY DEFINER`, `member_can_correct_payments()` (= `can_read_financial()`), `GRANT EXECUTE TO authenticated`. `_is_finance_period_closed()` **нет**. Ранее в этом пункте было «в отличие от `storno_payment` / `correct_payment`» — **ошибка аудита**: `storno`/`correct_payment` / `update_payment_method` периода тоже не читают (см. **H29**).  
**Суть:** owner/director/accountant меняет `payments.amount` / `method` «на месте» (без storno-строки) задним числом в уже закрытом месяце; затрагивает связанные `personal_lesson_charges` / billed amount. Reception после сброса `finance_period_closed_until` (**H12**) — тем более.  
**Импакт:** правка кассы в закрытом периоде без коррекционного контура; искажение AR персоналок.  
**Как чинить:** вместе с **H29**.

### M45. Любой активный член читает `organization_licenses` (тип ключа, `access_key_id`)

**Где:** `organization_licenses_select_member` в `20260620000003_v2_tenant_rls.sql` — `is_active_member` без роли. `GRANT SELECT ON organization_licenses TO authenticated`. Колонки: `license_type`, `access_key_id`, `activated_at`, `expires_at`, `crm_version_id`.  
**Суть:** teacher/reception/accountant видят, lifetime это или subscription, UUID ключа активации и срок. UI лицензии — owner. Параллель **M43** (`organization_subscriptions`) и oracle **M34**.  
**Импакт:** коммерческий статус школы + идентификатор ключа (сам plaintext ключа нет). Не cross-tenant.  
**Как чинить:** не `REVOKE SELECT` всей таблицы. `OrganizationProvider` читает `license_type, activated_at, expires_at` у каждого члена (throw на error). `access_key_id` — только owner / `can_manage_settings()`. См. **S24**.

### M46. Любой активный член читает все периоды заморозки абонементов

**Где:** `subscription_freeze_periods_select` в `20260833000001_subscription_freeze_periods.sql` — `is_active_member` без роли. Узкая `subscription_freeze_periods_teacher_select` **не** сужает: политики OR. `GRANT SELECT ON subscription_freeze_periods TO authenticated`. Колонки: `subscription_id`, `start_date`, `end_date`, `reason`, `status`, `expires_days_added`, `created_by_member_id`.  
**Суть:** teacher/accountant без доступа к абонементу всё равно видит, кто заморожен и на сколько (UUID абонемента + даты + причина). Тот же паттерн, что **M41**.  
**Импакт:** operational PII / разведка UUID перед **H7**; не cross-tenant.  
**Как чинить:** убрать широкую политику; SELECT — `can_read_operational()` или `teacher_can_access_subscription(subscription_id)`.

### M47. `get_rentals_for_schedule_week` отдаёт teacher все слоты аренды организации

**Где:** `get_rentals_for_schedule_week` в `20260845000001_rental_series_tariffs.sql` — `SECURITY DEFINER`; пускает `can_read_operational() OR teacher`. Фильтра по `teacher_has_location_access` / `schedule_group_ids` / `teachers_can_view_full_schedule` **нет**. Sensitive поля (имя арендатора, суммы) маскируются через `member_can_see_rental_sensitive()`. Teacher всё равно получает `rental_id`, `rental_date`, `time_start`/`time_end`, `location_id`, `booking_status` по **всем** подтверждённым арендам недели.  
**Суть:** флаг «преподавателям полное расписание» (M21) не действует на этот RPC. Teacher вне location-scope зондирует занятость всех залов. Параллель **M38**/**L11**.  
**Импакт:** occupancy intel; не суммы и не ФИО (для teacher). Не cross-tenant.  
**Как чинить:** для teacher — только локации из scope или общее «занято» без `rental_id`; либо требовать `teachers_can_view_full_schedule` для полного списка.

### M48. Прямой Storage `renter-documents`: upload/delete минуя prepare/finalize RPC

**Где:** политики `renter_documents_storage_insert` / `_select` / `_delete` в `20260844000001_renters_crm.sql` — `bucket_id = renter-documents` и `(storage.foldername(name))[1] = auth_organization_id()` и `member_can_read_renter_documents()` (owner/director/admin не-reception). RPC `prepare_renter_document_upload` / `finalize_renter_document_upload` / `delete_renter_document` пишут реестр `renter_documents` и аудируют. Политики Storage **не** требуют совпадения пути с строкой реестра. UPDATE-политики нет (overwrite = DELETE+INSERT).  
**Суть:** те же роли, что **H25** на таблице, могут: залить файл в `{orgId}/любое-имя` без finalize (орфан в bucket); `DELETE` любой объект папки орг (договоры коллег) без RPC; скачать все документы листингом SELECT. MIME bucket — заявленный Content-Type, не magic bytes.  
**Импакт:** порча/вынос документов арендаторов; обход аудита RPC. Не открывает чужой тенант (префикс = JWT org).  
**Как чинить:** Storage insert/delete только service_role; клиент — signed upload URL из `prepare_*`. Либо path = `{orgId}/{renterId}/{docId}` + EXISTS в `renter_documents`.

### M49. SECURITY DEFINER без `REVOKE FROM PUBLIC` — дефолтный EXECUTE у `anon`

**Где:** PostgreSQL при `CREATE FUNCTION` выдаёт `EXECUTE` роли `PUBLIC`. Часть миграций делает `REVOKE ALL … FROM PUBLIC` перед узким `GRANT`, часть — нет.  
**Без `REVOKE FROM PUBLIC` в разобранных миграциях:**

| Функция | GRANT в SQL | Риск, если у `anon` остался EXECUTE |
|---------|-------------|-------------------------------------|
| `run_version_migration_v2_to_v3` / `_v3_to_v2` | только `service_role` | аноним с anon key считает клиентов чужой орг / меняет `crm_version_id` (тот же stub, что **H31**) |
| `execute_version_migration_script` | только `service_role` | то же через диспетчер |
| `is_platform_developer(uuid)` | только `service_role` | oracle «этот UUID — developer» (сужает **H31**) |
| `teacher_member_has_future_lessons(org, member)` | ни GRANT, ни REVOKE | oracle будущих уроков по UUID |

**Суть:** `\dp` таблиц (**M31**) функции не покрывает. PostgREST отдаёт RPC, на которые у роли есть EXECUTE. Если production не отозвал PUBLIC — `anon` ключ из SPA достаточен, JWT member не нужен.  
**Импакт:** defense-in-depth как **M32**; при подтверждённом EXECUTE у anon — класс **H31** без учётки.  
**Как чинить:** сверить `has_function_privilege('anon', 'run_version_migration_v2_to_v3(uuid,boolean)', 'execute')` и аналоги; массовый `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon` + явный GRANT.

### M50. `get_schedule_calendar_sync_labels` отдаёт имена календарей всех преподавателей любому member

**Где:** `20260926000001_schedule_calendar_sync_labels.sql` — `SECURITY DEFINER`, `GRANT EXECUTE TO authenticated`. Проверка только `auth_organization_id()` + `business_row_readable()`. Фильтра по роли / `teacher_can_access_lesson` / `teachers_can_view_full_schedule` **нет**.  
**Суть:** teacher/accountant/`reception` за неделю получает `calendar_name` (часто email или «Имя — Work») по всем персоналкам, групповым слотам и мероприятиям орг. Параллель **M47** / **L11**.  
**Импакт:** occupancy + идентификация чужих Google-календарей; не refresh-token. Не cross-tenant.  
**Как чинить:** owner/director — полный список; teacher — только свои `teacher_member_id` / scope.

### M51. Storage bucket `exports`: любой authenticated, без `can_export_data()`

**Где:** `20260619000001_exports_storage_bucket.sql` — insert/select/delete если `(storage.foldername(name))[1] = auth.uid()`. MIME: `text/csv`, `text/plain`, `application/csv`, **`application/octet-stream`**. `can_export_data()` читается в RPC отчётов (`get_conducted_group_lessons_report`), **не** в политиках Storage. Клиент (`exportCsv.ts`) грузит CSV в `{uid}/…` и берёт signed URL.  
**Суть:** флаги `teachers_can_export` / `admin_can_export` режут кнопку (**H8**), не bucket. Любой member заливает файл до 5 MB в свою папку и чеканит signed URL (в т.ч. `octet-stream`).  
**Импакт:** обход флага экспорта на уровне хранения; удобный хостинг произвольного файла под origin Storage для фишинга по signed URL. Не чужой тенант (префикс = uid).  
**Как чинить:** в Storage WITH CHECK — `can_export_data()`; убрать `octet-stream`; upload только через RPC после проверки роли.

### M52. Прямой REST на `teacher_pay_rates` минует `save_teacher_pay_rule`

**Где:** `teacher_pay_rates_insert` / `_update` / `_delete` в `20260728000001_v2_teacher_payroll.sql` — `can_manage_payroll_rates()` = owner/director. `GRANT SELECT, INSERT, UPDATE, DELETE ON teacher_pay_rates TO authenticated`. Новая модель `teacher_pay_rules` — `write_none` + RPC `save_teacher_pay_rule` / `end_teacher_pay_rule_early` (перекрытия версий). Закрытый период не читается (**H29** таблица «Прочее»).  
**Суть:** owner/director `PATCH teacher_pay_rates` (percent/fixed) без RPC правил: дубли, дыры в интервалах, обход audit trail `save_teacher_pay_rule`. Accountant write не проходит (только owner/director).  
**Импакт:** порча payroll-ставок в обход контура правил; не cross-tenant.  
**Как чинить:** сначала `MemberProfileModal` / `useUpsertTeacherPayRate` перевести на `save_teacher_pay_rule`, **потом** `REVOKE INSERT, UPDATE, DELETE ON teacher_pay_rates FROM authenticated` (или `USING (false)`). Пока UI пишет таблицу — не отзывать.

### M53. Любой активный член читает `organization_version_migrations`

**Где:** `organization_version_migrations_select_member` в `20260625000002` — `is_active_member` без роли. `GRANT SELECT … TO authenticated`. Колонки: `from_version_id`, `to_version_id`, `status`, `error_message`, `initiated_by`, `metadata` (коды версий, dry_run_result).  
**Суть:** teacher видит журнал платформенных миграций школы и текст ошибок (внутренности schema). UI этого нет. Усиливает разведку перед **H31**.  
**Импакт:** operational intel, не PII клиентов. Не cross-tenant.  
**Как чинить:** SELECT только owner / `auth_platform_role() = 'developer'`; остальным — ничего.

### M54. Преподаватель читает `teacher_settlement_line_items.monetary_base` и `title` (выручка + ФИО)

**Где:** `teacher_settlement_line_items_select_own` в `20260837000001_teacher_settlement_detail.sql`; RPC `get_teacher_settlement_detail` пускает teacher на **свой** settlement. `title` для drop-in часто `client_display`; `monetary_base` — база начисления (= сумма урока/посещения). Write-политик нет.  
**Суть:** R4 спрятал `price` с view персоналок. Payroll self-service отдаёт ту же выручку и имена клиентов в строках расчёта. UI «моя зарплата» это показывает — REST тот же объём.  
**Импакт:** обход R4 через payroll; не чужие settlements (есть `member_id = auth_member_id()`). Не cross-tenant.  
**Как чинить:** teacher view без `monetary_base` / без ФИО в `title` (только «занятие ДД.ММ»); полные строки — `can_read_financial()`.

### M55. Преподаватель читает свои `teacher_pay_rules` (ставки %) целиком

**Где:** `teacher_pay_rules_select` — `can_read_financial() OR member_id = auth_member_id()`; RPC `list_teacher_pay_rules(p_member_id)` — то же. Write — `write_none` (только RPC owner/director).  
**Суть:** teacher `GET teacher_pay_rules` / `rpc/list_teacher_pay_rules` на свой `member_id` видит `value`, `amount_type`, `valid_from`/`valid_to` (формула зарплаты). UI ставок — администрация.  
**Импакт:** раскрытие payroll strategy сотруднику; не чужие правила (проверка `p_member_id`). Не cross-tenant.  
**Как чинить:** SELECT правил только `can_read_financial()`; teacher — только итог settlement без формулы.

### M56. `venue_cost_gap_is_acknowledged(p_org_id, …)` не сверяет членство

**Где:** `20260860000001_venue_cost_gap_acknowledgement.sql` — `SECURITY DEFINER`, `GRANT EXECUTE TO authenticated, service_role`. Тела проверки `p_org_id IS NOT DISTINCT FROM auth_organization_id()` **нет**. Соседний `venue_cost_status_for_org` у `authenticated` **отозван**.  
**Суть:** любой JWT вызывает RPC с UUID чужой орг и rule id — boolean «gap закрыт ack'ом». Класс **M34**.  
**Импакт:** точечный oracle при известных UUID; не чтение сумм venue cost.  
**Как чинить:** `p_org_id := auth_organization_id()`; `REVOKE` у клиента, если RPC нужен только внутри других DEFINER.

### M57. `list_archived_prices` отдаёт teacher число продаж архивных тарифов (DEFINER, обход R4)

**Где:** `20260876000001_price_tariff_archive.sql` — `SECURITY DEFINER`, `GRANT EXECUTE TO authenticated`. Пускает `can_read_prices()` (`20260806000001`) — teacher с `teacher_has_any_scope()`. View/таблица `prices` для teacher и так читается (**L15**). RPC дополнительно, правами владельца, считает:

```sql
(SELECT count(*) FROM subscriptions s WHERE s.price_id = p.id)
+ (SELECT count(*) FROM single_visits sv WHERE sv.price_id = p.id)
```

и отдаёт `teacher_member_ids` из `price_teacher_members`. Teacher **не** имеет SELECT на `single_visits.amount` как финансовая роль, но count drop-in + абонементов по тарифу — объём продаж.  
**Импакт:** обход R4 по объёму (не суммам); teacher видит, какой архивный пакет сколько раз продали. Не cross-tenant.  
**Как чинить:** для teacher не считать `sales_count` (или null). **Не** запрещать RPC целиком: `useArchivedPrices` нужен EditLessonPopup / PayPersonalLessonModal. Полный count — `can_manage_prices()` / `can_read_financial()`.

### M58. Токен приглашения в `sessionStorage` и в query `/accept-invite?token=`

**Где:** `tangodb/src/auth/AcceptInvitePage.tsx` — `tangodb_pending_invite_token`; `searchParams.get("token")`. Письмо и `invite_url` (**M2**) кладут plaintext в query.  
**Суть:** XSS (**H3**) читает не только JWT в `localStorage`, но и отложенный invite token (сценарий: жертва открыла ссылку, ушла залогиниться, token ждёт в `sessionStorage`). История браузера, скриншоты, прокси той же origin видят query. Связка с **C1**/M22: кто украл token, тот complete-invite.  
**Импакт:** усиливает C1/M2/M3; сам по себе без XSS/перехвата ссылки не бьёт.  
**Как чинить:** одноразовый token только POST body после логина; не класть в query/storage; fragment (`#token=`) хотя бы не уходит в Referer/логи сервера.

### M59. Teacher закрывает групповое занятие с произвольным `attendee_count` и пишет venue-cost ledger

**Где:** `close_group_lesson_occurrence` в `20260853000001_internal_venue_cost_rules.sql` — `SECURITY DEFINER`, `GRANT EXECUTE TO authenticated`. Пускает teacher через `member_can_close_group_venue_occurrence` → `teacher_can_mark_group_attendance` (тот же контур, что **H14**/журнал). Параметр `p_confirmed_attendee_count` **не** сверяется с `attendance` (`present` count) и **не** ограничен вместимостью группы. `post_venue_cost_for_closure` берёт этот count в `venue_cost_amount_for_lesson` → `attendance_tiers` (min/max attendees → amount) и пишет `venue_cost_accruals`. Для не-financial ролей из JSON ответа вычитается только ключ `amount`; строка ledger **уже** создана.  
**Суть:** teacher (или reception с журналом) вызывает `POST /rest/v1/rpc/close_group_lesson_occurrence` с `p_confirmed_attendee_count` = 0 или 999 на доступную группу — выбирает дешёвый/дорогой тир аренды зала без фактической явки. Повтор с другим count даёт `closure_attendee_count_conflict` (первая запись фиксируется). Accountant видит искажённую себестоимость в `get_finance_costs`.  
**Импакт:** инсайдерская порча финансового регистра hall rent; не cross-tenant; суммы в ответе teacher не видит (R4 на JSON), но эффект на кассу владельца — да.  
**Как чинить:** считать attendees из `attendance` (present) той даты/группы; верхняя граница — `classes.max_capacity`; закрытие с расхождением — error; либо close только `can_read_financial()` / owner.

---

## Низкие / информационные

### L1. Хардкод email разработчика

`submit-purchase-request/index.ts`: `DEFAULT_DEVELOPER_EMAIL = "omowdance@gmail.com"`. Утечка контакта в репозитории/бандле, если константа попадёт в клиент; в функции — server-only, но git публичен = OSINT.

### L2. `.env.example` включает `ACTIVATION_DEBUG=true`

При копировании в production активация начнёт отдавать `debug` с текстом SQL в JSON (`activate-access-key`).

### L3. Скрипт Telegram Web App без Subresource Integrity

`index.html` — компрометация `telegram.org` или MITM = XSS в origin CRM (связка с H3/H4).

### L4. Google Calendar webhook: сравнение `channel_id` с самим собой

`google-calendar-webhook/index.ts`: `constantTimeEqual(watch.channel_id, channelId)` после lookup по тому же id — no-op. Реальная защита — `resource_id` + `channel_token`. Если токен канала слабый/утечёт — можно enqueue incremental sync (нагрузка, не чтение CRM извне).

### L5. `Access-Control-Allow-Headers` включает `x-cron-secret`

Браузер с XSS на allowed origin может дернуть cron-функции, **если** секрет известен (он не в SPA). Сам по себе header не утекает секрет; это лишняя поверхность. Сравнение секрета в `verifyCronSecret` не constant-time и принимает значение в `Authorization` (коллизия с Bearer JWT, если секрет когда-либо совпадёт по форме — маловероятно).

### L6. `crm_product_versions` читается любым authenticated

Политика `USING (true)`. Утечка внутренних кодов версий продукта, не данных школ.

### L7. Клиентское приложение можно сохранить с сайта

Это норма для SPA. В бандле будут URL Supabase, anon key (публичный по дизайну Supabase), имена RPC/таблиц. **Не** будут: `SERVICE_ROLE`, `ACCESS_KEY_PEPPER`, исходники Edge Functions, SQL. Свой клон CRM = git + свой проект Supabase. Чужой production с украденным UI без учётки не откроет чужие строки (RLS).

### L8. Dev Console: `isDeveloper` = JWT `platform_role` **или** email allowlist

`devAuth.ts`. Allowlist в секрете сервера — нормально. Компрометация ящика из `DEV_CONSOLE_ALLOWLIST` = выдача lifetime-ключей, purge орг, сброс пароля owner (`dev-console-reset-owner-password` **возвращает `temporary_password` в JSON**). Это модель угроз платформы, не тенанта.

### L9. Recovery-ссылка даёт полноценную сессию CRM

Письмо сброса логинит пользователя (Supabase recovery = JWT). `ResetPasswordPage` не проверяет `PASSWORD_RECOVERY`; старый пароль жив, пока не сменят. Украденная ссылка = вход во все орг жертвы (пока не сменят пароль и не revoke). Усиливает H3/H5; `secure_password_change = false`.

### L10. `auto_expose_new_tables` в `config.toml` не выключен явно — **на production ON (подтверждено)**

Комментарий откладывает `false`. На проекте `tangodb` (2026-08-22) все tenant-таблицы имеют ALL у `authenticated` и `anon` (**M31**, **M32**). Новая таблица без `REVOKE` автоматически в Data API с полными правами.

### L11. Free/busy любого преподавателя орг доступен любому активному члену

`google-calendar-freebusy`: достаточно членства в той же орг, роль не проверяется. Accountant/teacher видят busy-интервалы коллеги. Не календарные события, но график занятости. Сузить до ролей, которые ставят уроки.

### L12. Пустой `ALLOWED_ORIGINS` ломает CORS Edge Functions для браузера

**Где:** `tangodb/supabase/functions/_shared/http.ts` — `corsHeadersFor` возвращает `null`, если allowlist пуст; `corsDeniedStatus()` → **500**; `jsonResponse` без Origin и без валидного `x-cron-secret` отдаёт 403/500.  
**Импакт:** misconfig при деплое (забыли env) = CRM не вызывает Edge Functions из браузера (активация ключа, инвайты, checkout, GCal). Cron/pg_net без Origin работает через `x-cron-secret`. Не утечка данных, но «тихий» отказ функций безопасности.  
**Как чинить:** health-check деплоя; в production требовать непустой `ALLOWED_ORIGINS`.

### L13. `landing-track-event` при rate limit отвечает `200 { ok: true }`

**Где:** `tangodb/supabase/functions/landing-track-event/index.ts`.  
**Импакт:** злоумышленник не видит 429 — сложнее детектить флуд; данные в `landing_events` всё равно не пишутся после лимита (только insert пропускается внутри try). Информационно.

### L14. Platform developer обходит лимит «одно демо на email»

**Где:** `create_self_service_demo_org` в `20260816000001_platform_developer_self_service_demo.sql` — для `is_platform_developer(p_user_id)` пропускаются проверки `demo_owner_retention` и legacy demo keys.  
**Импакт:** учётка с `raw_app_meta_data.platform_role = 'developer'` (Dev Console) может многократно создавать self-service demo на одном email после purge/смены учётки. Штатная модель платформы (**L8**), не тенанта; обычный пользователь не может выставить себе `platform_role` без service_role.

### L15. Все преподаватели читают полный каталог тарифов организации

**Где:** `prices_select` — role `teacher` в списке (`20260623000001_v2_business_rls.sql`); `GRANT SELECT ON prices TO authenticated`.  
**Импакт:** teacher видит все цены/пакеты орг (включая не свой discipline), даже если UI прячет — удобно для продажи, но раскрывает pricing strategy. Не cross-tenant.

### L16. `audit_log` с полными diff доступен owner/director через REST — **дубль M29**

**Где:** см. **M29**. Политика `audit_log_select_leadership` — role IN ('owner', 'director'). Пункт оставлен как отсылка (S40 шаг 7). Не вторая независимая находка.  
**Импакт:** штатный контур для leadership, но при компрометации director-учётки (**H9**) или уволенном director с живым JWT — экспорт полной истории изменений с PII. Не cross-tenant.

### L17. `isDeveloper` дополнительно парсит payload JWT **без** проверки подписи

**Где:** `tangodb/supabase/functions/_shared/devAuth.ts` — `platformRoleFromJwt`: `JSON.parse(atob(token.split(".")[1]))`. Вызывается как fallback, если `user.app_metadata.platform_role` пуст, после `auth.getUser()` (подпись там проверяется).  
**Импакт:** при текущем порядке вызовов (сначала getUser) подделать `platform_role` нельзя — тот же токен. Риск — копия паттерна в новую функцию без getUser, или расхождение header vs getUser. Код-smell платформы (**L8**).  
**Как чинить:** убрать fallback; только `user.app_metadata` после getUser.

### L18. Любой активный член читает все `organization_settings` (modules, freeze, закрытый период, брендинг)

**Где:** `organization_settings_select_member` — `is_active_member` без роли. Teacher/accountant видят `finance_period_closed_until`, `modules`, `teachers_can_*`, locale. UI настроек спрятан. `OrganizationProvider` грузит `.select("*")`.  
**Импакт:** раскрытие внутренней конфигурации школы, не PII клиентов. Удобно для разведки перед H10/H12 (знать, что период закрыт / какие флаги выключены).  
**Как чинить:** не отрезать member SELECT полей, без которых падает SPA (`locale`, `modules`, `teachers_can_*`, `admin_can_*`, `directors_can_mark_attendance`, `org_preset`, `terminology`, `freeze_*`, `low_balance_threshold`, `branding_name` — `OrganizationProvider` / `permissions.ts` / `mapSettings`). **Не** column-REVOKE при `select("*")`. Можно спрятать у teacher `finance_period_closed_until` только вместе со сменой хука на явный список **всех** полей `mapSettings`. См. S39.

### L19. `refresh_token_reuse_interval = 10` в локальном `config.toml`

**Где:** `[auth]` — при включённой rotation reuse окно 10 секунд.  
**Импакт:** если production = этот файл, украденный refresh чуть проще использовать параллельно с легитимным клиентом в узком окне. Не отменяет H3/H5. Сверить Dashboard.

### L20. `extra_search_path` включает схему `extensions`

**Где:** `tangodb/supabase/config.toml` `[api] extra_search_path = ["public", "extensions"]`.  
**Импакт:** PostgREST резолвит неквалифицированные имена ещё и в `extensions`. При `CREATE` у `authenticated` на этой схеме (обычно нет) — классический search_path hijack DEFINER-функций без `SET search_path`. Сейчас риск низкий, если CREATE отозван; это defense-in-depth.  
**Как чинить:** `extra_search_path = ["public"]`; у всех DEFINER оставить явный `SET search_path`.

### L21. Owner/director читает GCal `last_error` / `last_error_code` через REST

**Где:** `calendar_sync_outbox_select_management`, `gcal_event_links_select_management`, `org_gcal_bindings_select_management` (`20260892000001`, `20260891000001`) — role IN ('owner', 'director'). Текст Google API: `google_calendar_event_links.last_error`; у outbox — `last_error_message` / `last_error_code`. У **bindings** колонки `last_error` нет — есть `last_error_code` / `last_error_at` (код, не длинное тело).  
**Импакт:** при компрометации director — диагностика интеграции, не refresh-token (он в `user_google_accounts`, отозван у authenticated). Информационно.  
**Как чинить (S39):** не светить текст `last_error` / `last_error_message` лишним ролям в UI и не отдавать teacher в RPC урока (**L24**). **Не** column-REVOKE `last_error_code` / `last_error_at` на bindings: `fetchMemberGoogleBinding` / `fetchOrganizationGoogleBinding` их селектят, IntegrationsSettingsPage / OrgEventsGoogleSyncSection показывают `last_error_code`. Column-REVOKE несуществующего `last_error` на bindings не делать.

### L22. `platform_payment_methods` читается любым authenticated (`USING (true)`)

**Где:** `20260723000001_platform_payment_waitlist.sql` + UPDATE только `is_dev_console_operator()` (`20260723000002`). Singleton `config` JSON — реквизиты ручной оплаты платформы (кошельки, карты).  
**Импакт:** teacher любой демо-школы видит, куда TangoDB принимает оплату лицензий. Те же данные читает CRM SPA (`usePlatformPaymentConfig` в `App.tsx` / лицензия / `ManualPurchasePanel`) — **SELECT нужен**, иначе страница покупки пустая. Если те же реквизиты на лендинге публичны — SELECT не усиливает. **UPDATE жив** для учётки с `raw_app_meta_data.platform_role = 'developer'` (функция читает `auth.users`, не JWT) — см. **H33**.

### L23. ~~Footgun: политики developer «мертвы»~~ — **ошибочно; см. H33**

**Где:** те же политики, что **H33**. Девятый проход считал, что хук не копирует `platform_role` и политики всегда false.  
**Факт:** с `20260627000002` claim **выставляется**. Это не будущий footgun, а **живая** дыра — **H33**. Пункт оставлен, чтобы не ломать ссылки.

### L24. Teacher в discipline-scope читает GCal `last_error` урока коллеги

**Где:** `get_personal_lesson_google_sync_status` (`20260926000002`) — teacher с `teacher_can_access_lesson` (тот же scope, что **H16**). Поле `last_error` в ответе RPC; UI: `LessonInfoPopup` / `EditLessonPopup` (`googleSyncStatus.row?.last_error`). Параллель **L21** (management REST на event_links, не bindings).  
**Импакт:** текст ошибки Google API (иногда email календаря). Не refresh-token.  
**Как чинить (S39):** не отдавать `last_error` teacher в этом RPC / не рендерить в попапе. Не column-REVOKE на bindings (`last_error` там нет; `last_error_code` нужен странице интеграций).

### L25. Realtime включён в локальном `config.toml`

**Где:** `[realtime] enabled = true`. Клиент `tangodb/src` **не** подписан на `postgres_changes` (поиск по репозиторию пуст). Если production Realtime publication включает tenant-таблицы, отдельный websocket-канал дублирует SELECT по RLS (тот же объём, что REST).  
**Импакт:** сейчас клиент канал не использует; misconfig publication + дырявая политика = ещё один способ снять строки. Информационно, пока SPA не подписан.

### L26. Leftover v1: `allowed_users` + `is_allowed_teacher()` + `auth_telegram_id()` читает `user_metadata`

**Где:** `20260610120000_initial_schema.sql` (seed `telegram_id = 123456789`), `20260611180000_fix_auth_telegram_id.sql` (fallback `user_metadata.telegram_id` и email `tg_N@tangodb.auth`), `20260611190000` — `GRANT EXECUTE ON is_allowed_teacher() TO authenticated`. Таблицы `clients`/`subscriptions`/… **пересозданы** в `20260622000001` — старые политики `"teacher_select"` на бизнес-таблицах сняты вместе с DROP. Таблица `allowed_users` и функции **остались**.  
**Импакт сегодня:** живых политик на tenant-таблицах с `is_allowed_teacher()` не видно. Пользователь может `updateUser({ data: { telegram_id: "123456789" } })` и получить `rpc/is_allowed_teacher = true` (oracle «я в allowlist»), без SELECT чужих строк.  
**Риск:** любая новая политика `USING (is_allowed_teacher())` = кросс-тенантный write/read для того, кто выставит `user_metadata` под seed из git.  
**Как чинить:** `DROP TABLE allowed_users CASCADE`; `DROP FUNCTION is_allowed_teacher(), auth_telegram_id()`; убрать копирование `telegram_id` из хука JWT, если Mini App login больше не используется (комментарий в `telegram.ts`: «removed Telegram login»).

### L27. `window.open(signedUrl)` без `noopener` на документах арендатора

**Где:** `tangodb/src/components/renters/RenterDetailPanel.tsx` — `window.open(res.url, "_blank")` (без `"noopener,noreferrer"`). Остальные `window.open` в проекте (Telegram, GCal OAuth) указывают `noopener`.  
**Импакт:** классический tabnabbing, если signed URL отдаёт HTML (MIME bucket не magic bytes — **M48**). Окно документа получает `window.opener` на CRM. Низкий, нужен вредоносный файл в своём же bucket.  
**Как чинить:** `window.open(url, "_blank", "noopener,noreferrer")`.

### L28. `get_venue_cost_rule_status` без `can_read_financial()` (в отличие от `list_venue_cost_rule_versions`)

**Где:** `20260853000001_internal_venue_cost_rules.sql` — `SECURITY DEFINER`, `GRANT EXECUTE TO authenticated`. Проверка только `auth.uid()` + `auth_organization_id()`. Соседний `list_venue_cost_rule_versions` требует `can_read_financial()`.  
**Суть:** teacher/reception получают `current_mode`, `acknowledgement_required`, `pending_unpriced_count`, id текущих правил (не JSON сумм `rules`).  
**Импакт:** operational intel по hall-rent контуру; не суммы и не чужой тенант.  
**Как чинить:** дашборд teacher не показывать `VenueRuleExpiryNotice` (intel). **Не** сажать RPC на `can_read_financial()`: `checkVenueRuleBeforePayment` throw из записи оплаты абонемента/персоналки/drop-in — reception и teacher-касса мертвы. EXECUTE оставить ролям, которые зовут `record_*_payment` / `record_single_visit`. См. **S39**.

---

## Использование без ключа доступа — сводка сценариев

| Сценарий | Ключ нужен? | Запись в свою орг | Чужие орг |
|----------|-------------|-------------------|-----------|
| Регистрация + self-service demo | Нет (продукт) | 30 дней | Нет (RLS) |
| `request-demo-key` + activate | Демо-ключ, выдаётся публично | 30 дней | Нет |
| Lifetime/подписка | Да | Пока licensed + lifetime/active sub | Нет |
| Истёкшее демо | — | SQL запрещает write **пока не H10** | Read своей орг до purge |
| Подмена UI / свой фронт на тот же anon key | Нужна **учётка** | Как у роли; **director → owner (H9)**; **admin PATCH demo_expires_at (H10)**; **reception = full admin (H12)**; **scope escalation (H13)**; **expire_monthly на чужие орг (H23)**; **migrate_organization_version spoof developer (H31)**; **developer JWT → platform tables (H33)** | Нет строк чужой школы через обычный REST+RLS; **H23/H31/H33/M34/M49/M56** — write/oracle по UUID или platform-роли без членства в жертве |
| Аноним без signup | — | Нет | Нет |

Обхода «стать owner чужой школы без инвайта/ключа» в разобранном коде **не видно**. Критичный обход — **C1** (захват чужого **пользователя**, затем его орг). Внутри своей школы director становится owner **без инвайта** — **H9**; reception с ролью admin — то же плюс настройки/демо — **H12**. Бессрочное демо без оплаты — **H10**. Кросс-тенантная **запись** без членства — **H23** (`expire_monthly_subscriptions`) и **H31** (`migrate_organization_version` с чужим developer UUID); учётка **platform developer** пишет platform-таблицы всех тенантов из CRM JWT — **H33**. Кросс-тенантное **чтение ПИИ** — только при известном UUID (**M34**); counts/версия орг — **H31** dry_run / **M49**.

---

## Копирование данных и CRM — сводка

**Данные (инсайдер со сессией)**

1. DevTools → Network / Application → скопировать JSON ответов Supabase.  
2. `curl` PostgREST: `apikey` = anon (из JS) + `Authorization: Bearer <access_token>`.  
3. Настройки → «Данные» → CSV (если роль/флаг экспорта).  
4. IndexedDB `tangodb-offline`.  
5. Storage: CSV в `exports/{uid}/`, файлы в `renter-documents/{orgId}/`.  
6. Буфер обмена, скриншоты, печать — вне контроля сервера.  
7. Teacher: прямое изменение/удаление/создание строк `clients` (H11); scope escalation (H13); прямой PATCH `attendance` / `subscriptions` / `payments` / `personal_lessons.paid` (H14–H15, H21–H22, **H26**); `DELETE subscriptions` при флаге продажи (**H15**); `finish_subscription` / freeze RPC (H27); уроки/слоты на других преподавателей (H16); `subscription_groups` (H19); финансы мастер-классов через `calendar_events` (**H24**); `personal_lesson_charges.billed_amount` (**H30**); drop-in `single_visits.amount` (**H32**); payroll `monetary_base` (**M54**); own pay rules (**M55**); waitlist REST (**M35**); `preview_calendar_event_conflicts` client names (**M42**); freeze/licenses SELECT (**M45–M46**); occupancy аренды (**M47**); GCal labels коллег (**M50**); `list_archived_prices` sales_count (**M57**); close group с фейковым attendee_count (**M59**). Director/reception/accountant: прямое изменение `organization_members` / rental billing / payroll settlements / rental series / `price_disciplines` / `teacher_pay_rates` (H9, H12, H13, H17–H18, **H25**, **H28**, **M52**); касса в «закрытом» периоде (**H29**); Storage документов арендаторов (**M48**); Storage `exports` (**M51**). Любой authenticated: `expire_monthly_subscriptions(null)` (**H23**); `migrate_organization_version` с UUID developer (**H31**); `subscription_member_changes` PII (**M41**); `organization_subscriptions` billing (**M43**). Учётка **platform developer**: `platform_audit_log` / `crm_product_versions` / UPDATE `platform_payment_methods` (**H33**).

**Защита от внешнего вора без учётки:** RLS + отсутствие GRANT anon на бизнес-таблицы. `landing_events` и `platform_waitlist` отозваны у anon/authenticated (waitlist) / только service_role (events). **Оговорка:** GRANT anon ALL на production есть (**M32**); отказ сейчас даёт отсутствие политик RLS для `anon`, не REVOKE.

**Само приложение**

| Артефакт | Скачивается из браузера? |
|----------|--------------------------|
| JS/CSS SPA | Да |
| `VITE_SUPABASE_ANON_KEY` | Да (так устроен Supabase) |
| Типы/имена таблиц и RPC | Да, по строкам в бандле |
| Миграции SQL, RLS | Нет |
| Edge Functions source | Нет |
| `SERVICE_ROLE` / pepper / cron | Нет (если не утекли git/.env) |
| Dev Console | Отдельный деплой; те же правила |

DRM «запретить копирование фронта» для веб-CRM **невозможен**. Имеет смысл: приватный git, секреты только в Dashboard, obfuscation не считать защитой.

---

## Приоритет починки

| Волна | Пункты | Зачем |
|-------|--------|--------|
| **0 — сразу** | **C1**, M2, M22, **H9**, **H10**, **H12**, **H13**, **H14**, **H15**, **H16**, **H17**, **H18**, **H21**, **H22**, **H23**, **H26**, **H27**, **H29**, **H31**, **H33** | Пароль/инвайт; не PATCH role/demo/settings; reception ≠ full admin; **scope/meta только RPC (H13, S05)**; attendance/subscriptions/payments/personal_lessons/rental billing/payroll только через RPC; **H16/H26 в S09 (FOR ALL)**; **запретить клиентский `expire_monthly_subscriptions`**; finish/freeze только с `teachers_can_sell_subscriptions`; **закрытый период на приём денег (не сторно/correct)**; **`migrate_organization_version` только service_role, без клиентского `p_actor_user_id`**; **не класть `platform_role` в клиентский JWT; REVOKE write на `platform_audit_log` / `crm_product_versions`** |
| **1** | H5 (сверить prod Auth), H2, H4, H6, **H11**, **H19**, **H20**, **H24**, **H25**, **H28**, **H30**, **H32**, M13, M20, M24–M31, M28, **M33–M59** | Email confirm, демо-ключ, headers, rate limit, clients/subscription_groups/single_visits/calendar_events/rental series/tariff bindings, charges R4, drop-in R4, PII, Turnstile, заметки, waitlist, director/admin schedule flags, CSV injection, DEFINER IDOR, SITE_URL, partner-change/freeze/licenses PII, calendar preview PII, billing oracle, in-place payment period, rental occupancy, Storage, PUBLIC EXECUTE, GCal labels, exports bucket, pay rates REST, version_migrations, payroll lines, own pay rules, gap-ack, archived prices sales_count, invite sessionStorage, venue-cost attendee spoof |
| **2** | H3, M8, M11, H8 (revoke session при deactivate), M15–M17, **M39**, **M58** | Кража сессии, recovery-code, redirect сброса, уход сотрудника, invite/checkout origin, token в query/storage |
| **3** | H7, M1, M5, M6, M7, M12, M19, **M21**, **M23**, M25, M29, **M31**, **M32**, **M37**, **M44**, **M49** | PII teacher, GraphQL, views, access_keys, офлайн, REVOKE anon/auto-expose/PUBLIC functions, org-флаги, invite hash, audit trail, закрытый период на restate/in-place |
| **4** | L1–L28, M4 landing, M9–M10, M14, M18 | Гигиена, enumeration, waitlist org, CORS misconfig, developer demo bypass, JWT decode, settings SELECT, extra_search_path, GCal errors, platform wallets, Realtime, leftover v1 allowlist, tabnabbing, venue-cost status teacher |

H1 (демо без оплаты) — **продуктовое решение**, не чинить как баг, если 30 дней + purge — осознанная воронка. **H10** (PATCH `demo_expires_at`) — это уже не воронка, а обход лимита. Имеет смысл явно писать в UI «это демо, не коммерческая лицензия» и гарантировать работающий cron purge.

Таблица выше — **ранжирование риска**, не порядок работ. Исполнение только **S01 → S40**. Копировать в новый чат: раздел **«Промпты реализации»** → **«Тексты для нового чата»** (поиск по файлу: `Тексты для нового чата`). Не идти по этой таблице вместо промптов.

**Промпты для агента** — раздел **«Промпты реализации»** в конце этого файла. **Что вставлять в новый чат** — «Тексты для нового чата» (короткий блок). Длинный fenced-блок `#### S0N` копировать руками не обязательно: агент открывает его в этом файле. Один номер = один запуск. Порядок **S01 → S40**, без прыжков и без «заодно». Волну N+1 не начинать, пока не закрыты все промпты волны N. H1 в промпты не входит. После DoD поставь ✅ в колонке «Готово» таблицы последовательности.

---

## Проверка production `\dp` (2026-08-22)

**Проект:** `tangodb` / `gizfpiujqjwbjtqfstbj` (ap-southeast-1), linked CLI.  
**Метод:** `npx supabase db query --linked` → `information_schema.table_privileges`, `pg_policies`, `pg_class.relrowsecurity`.

| Таблица | `authenticated` (production) | RLS | Write-политики (authenticated) | Статус H* |
|---------|-------------------------------|-----|--------------------------------|-----------|
| `payments` | ALL (auto-expose) | ON | INSERT, UPDATE, DELETE policies | **H21** — REST write доступен |
| `personal_lessons` | ALL | ON | `FOR ALL` teacher/admin | **H22** — REST write доступен |
| `single_visits` | ALL | ON | INSERT/UPDATE admin (`can_write_all_business`); SELECT teacher с `amount` | **H20** write; **H32** teacher SELECT сумм |
| `expenses` | ALL | ON | INSERT/UPDATE/DELETE financial | **M23** — REST write доступен |
| `teacher_settlements` | ALL (DELETE есть в GRANT, политики DELETE нет) | ON | INSERT, UPDATE, SELECT | **H18** — INSERT/UPDATE; DELETE → RLS deny |
| `teacher_settlement_payments` | ALL | ON | INSERT only | **H18** — INSERT доступен |
| `rental_invoices` | ALL | ON | `rental_invoices_write` FOR ALL + `can_read_financial()` | **H17** — REST write доступен |
| `rental_invoice_payments` | ALL | ON | аналогично | **H17** |
| `rental_advances`, `rental_deposits`, … | ALL | ON | `can_read_financial()` FOR ALL | **H17** |
| `attendance`, `subscriptions` | ALL | ON | teacher/admin write policies | **H14–H15** — подтверждено |
| `calendar_events`, `rental_series` | не в выборке `\dp` | ON (миграции) | teacher SELECT / `FOR ALL` manage_rentals | **H24 / H25** — по SQL; GRANT на prod как у остальных (M31) |

**Шестой проход (SQL, не новый `\dp`):** RPC `expire_monthly_subscriptions` EXECUTE у `authenticated` (**H23**); `personal_lessons` `FOR ALL` (**H26**).

**Седьмой проход (SQL):** `finish_subscription` / freeze без `teacher_can_write_subscriptions` (**H27**); `price_disciplines` / `price_teacher_members` write через `can_write_all_business` (**H28**); `subscription_member_changes` SELECT любому member (**M41**); `preview_calendar_event_conflicts` PII (**M42**); `organization_subscriptions` SELECT member (**M43**); `update_payment_in_place` без `_is_finance_period_closed` (**M44**).

**Восьмой проход (SQL, не новый `\dp`):** `_is_finance_period_closed` вызывается только из rental RPC (**H29**); `personal_lesson_charges_select_teacher` (**H30**); `organization_licenses` / `subscription_freeze_periods` SELECT member (**M45–M46**); `get_rentals_for_schedule_week` без location-scope (**M47**); Storage `renter-documents` insert/delete (**M48**). `storno_payment` / `correct_payment` периода не читают (уточнение **M44**).

**Девятый проход (SQL, не новый `\dp`):** `migrate_organization_version` EXECUTE у `authenticated` + spoof `p_actor_user_id` (**H31**); `single_visits` SELECT teacher с `amount` (**H32**, GRANT ALL на prod как **H20**); DEFINER без `REVOKE PUBLIC` (**M49**); `get_schedule_calendar_sync_labels` (**M50**); Storage `exports` (**M51**); `teacher_pay_rates` write (**M52**); `organization_version_migrations` SELECT member (**M53**); settlement line items (**M54**); own `teacher_pay_rules` (**M55**); `venue_cost_gap_is_acknowledged` (**M56**). Привилегии функций у `anon` на production **не** снимались.

**Десятый проход (SQL, не новый `\dp`):** хук `custom_access_token_hook` копирует `app_metadata.platform_role` в top-level claim — политики `platform_audit_log_developer` / `crm_product_versions_write_developer` **живы** (**H33**, L23 ошибочен); `list_archived_prices` DEFINER + `can_read_prices()` для teacher (**M57**); `close_group_lesson_occurrence` не сверяет attendee_count с `attendance` (**M59**); leftover `is_allowed_teacher()` (**L26**). Живой JWT developer на production **не** гонялся.

**`anon`:** на всех строках таблицы — ALL в `table_privileges`; политики RLS с role `anon` на `payments`/`clients`/… **не найдены** → запросы отклоняются RLS, но GRANT остаётся (**M32**).

**Миграции vs production:** `payments`, `single_visits`, `rental_invoices*` — **нет** `GRANT TO authenticated` в SQL; на production ALL (auto-expose). `teacher_settlements` — в миграции `GRANT SELECT, INSERT, UPDATE`; на production также DELETE в GRANT.

**Не проверялось:** живой POST/PATCH с JWT accountant/reception (только схема прав); настройка Dashboard «Expose new tables» (косвенно — ALL на таблицах без GRANT в миграциях = expose активен).

---

## Что этот аудит не покрыл

- Фактические настройки **production** Supabase Auth / Network Restrictions / leaked service_role — **`\dp` на ключевые таблицы проверён 2026-08-22** (см. секцию выше); живые REST write-тесты с role JWT не гонялись.  
- Привилегии **функций** у `anon`/`PUBLIC` (`has_function_privilege`) — **не** проверялись на production (**M49**).  
- Права бота Telegram и Mini App `initData` (legacy synthetic email ещё есть в `routeGuards`; отдельный Telegram-login в Edge Functions **не найден** — вход email/password). Leftover v1 `allowed_users` / `is_allowed_teacher()` / `auth_telegram_id()` — **L26** (живых политик на бизнес-таблицах нет).  
- Нагрузочный DoS PostgREST / Realtime.  
- Цепочка зависимостей npm (supply chain).  
- Физический доступ к бэкапам и Supabase Dashboard.  
- Социальная инженерия и фишинг пароля.  
- Контент загружаемых файлов арендаторов / `exports` (MIME vs magic bytes) — путь санитизируется, buckets private; прямой Storage write без RPC — **M48**; bucket `exports` без `can_export_data` — **M51**.  
- Фактический GRANT на таблицы без явного `GRANT` в миграциях — **частично закрыто M31/M32** (`\dp` 2026-08-22); `calendar_events` / `rental_series` / `personal_lesson_charges` в той выборке `\dp` **не** было (H24/H25/H30 — по миграциям + auto-expose).  
- Корректность RLS INSERT для `personal_lessons` / `schedule_slots` у teacher на **чужой** `teacher_member_id` — подтверждено как **H16**.  
- Живой вызов `expire_monthly_subscriptions(null)` на production (только SQL; **H23**).  
- Живой вызов `migrate_organization_version` с чужим `p_actor_user_id` на production (только SQL; **H31**).  
- Живой JWT с `platform_role=developer` на production (только SQL хука + политики; **H33**). Живой PATCH `platform_payment_methods` с developer JWT не гонялся (политика `is_dev_console_operator` по `auth.users`).  
- Кэш GCal access token (**2.8.76**, `encrypted_access_token`): живой SELECT таблицы с JWT не гонялся; по SQL — `REVOKE ALL` у `authenticated` с создания таблицы. `calendar-sync-kick` membership — по коду Edge, не живой кросс-тенант тест.  
- Живой `close_group_lesson_occurrence` с фейковым attendee_count (только SQL; **M59**).  
- Живой `record_subscription_payment` / `write_off_personal_lesson_debt` в закрытом периоде на production (только SQL; **H29**). RPC списания появился в **2.8.73** (`20261001000001`), после исходного аудита.  
- Цепочка `findAuthUserByEmail` (`listUsers` постранично, service_role) — нагрузка на Auth при инвайте, не утечка клиенту.

Проверку C1 после фикса стоит сделать вручную: два аккаунта, инвайт email уже существующего пользователя в другую орг — пароль **не** должен меняться, сессия жертвы **не** должна выдаваться по одной ссылке.

Проверку H9/H10/H12: под учётом director/admin/**reception** прямой `UPDATE` через Data API на `organization_members.role`, `organizations.demo_expires_at`, `organization_settings.finance_period_closed_until` **должен** получить отказ (403/RLS) после фикса; UI-RPC при этом остаются рабочими.

Проверку **H14/H15**: teacher с scope не делает `PATCH attendance` / `PATCH subscriptions.lessons_left` / `DELETE subscriptions` через REST (403/RLS); UI `mark_attendance` меняет `lessons_left`; продажа **не-группы** через прямой INSERT (`useAddSubscription`) и `create_group_subscription` для группы — работают.

Проверку **H17–H22**: accountant/reception не делает прямой `PATCH` на `rental_invoices`, `teacher_settlements`, `payments`, `personal_lessons.paid` (403/RLS или нет GRANT); RPC `record_*_payment` / `recalculate_teacher_settlement` работают. Сверить `\dp` на rental billing tables (**M31**).

Проверку **H23**: под обычным JWT teacher/accountant `rpc/expire_monthly_subscriptions` с чужим `p_org_id` или `null` — **403 / permission denied**, не массовый UPDATE. Отметка журнала (`mark_attendance`) по-прежнему истекает monthly своей орг через внутренний `PERFORM`. Cron Edge для этого RPC **нет** — не требовать.

Проверку **H24**: teacher `GET /calendar_events?select=income_amount,paid_amount` — отказ или пустые/скрытые колонки; owner/director/accountant видят суммы. Teacher-сетка недели **открывает** мастер-классы (название, слот) без ошибки и без сумм в JSON.

Проверку **H25/H26**: admin не `DELETE` `rental_series` / teacher не `SELECT personal_lessons.price` с **base** и не `PATCH` урок вчерашней даты через REST; UI-RPC create/cancel rental и edit lesson на будущие даты работают. **Teacher-сетка недели** (excludeCancelled) по-прежнему показывает персоналки без цены.

Проверку **M34**: `subscription_client_display_for_date(<uuid чужой орг>)` не возвращает ФИО; `organization_has_lifetime_license(<чужой uuid>)` — false или denied.

Проверку **H27**: teacher при `teachers_can_sell_subscriptions = false` не вызывает `finish_subscription` / `apply_subscription_freeze_period` на доступный абонемент (403/error); owner/director — работает. Не требовать waitlist-notify после finish: актуальное SQL его не вызывает.

Проверку **H28**: reception/admin не `INSERT`/`DELETE` на `price_disciplines` / `price_teacher_members` (403/RLS); owner/director через UI тарифов (REST `syncPriceDisciplines` / `syncPriceTeacherMembers`) — работает.

Проверку **M41**: teacher без scope на абонемент не `GET subscription_member_changes` с чужими `outgoing_client_id` (пусто или 403).

Проверку **M42**: teacher вне discipline-scope `rpc/preview_calendar_event_conflicts` — conflicts personal без `client_display` или только свои уроки.

Проверку **M43**: teacher не видит `organization_subscriptions.stripe_subscription_id` (только owner или колонка скрыта). `status` / период для `isReadOnly` у любого члена орг по-прежнему читаются (OrganizationProvider).

Проверку **M44**: accountant не `update_payment_in_place` на платёж в закрытом периоде (error); после открытия периода — работает.

Проверку **H29**: при `finance_period_closed_until` = вчера accountant/reception **не** делает `rpc/record_subscription_payment`, `record_personal_lesson_payment`, `record_single_visit`, `record_calendar_event_payment`, **`write_off_personal_lesson_debt`** (error `periodClosed`); rental RPC по-прежнему режет. `storno_payment` / `correct_payment` на закрытый день **ещё разрешены** (correction path). UI продажи абонемента в закрытом дне — та же ошибка, не только аренда. Кнопка «Удалить» долга персоналки в Финансы → Дебиторы — та же ошибка периода.

Проверку **H30**: teacher `GET /personal_lesson_charges?select=billed_amount,client_id` — отказ или пустые суммы; owner/accountant видят. Teacher-сетка: блок должников без ошибки (без сумм). PayPersonalLessonModal открывается.

Проверку **M45**: teacher не видит `organization_licenses.access_key_id`. `license_type` (для `isReadOnly`) читается. Owner видит полный ряд.

Проверку **M46**: teacher без scope на абонемент не `GET subscription_freeze_periods` с чужими `subscription_id` (пусто или 403).

Проверку **M47**: teacher с узким `location_ids` `rpc/get_rentals_for_schedule_week` не получает аренды чужих залов (пусто или без `rental_id`).

Проверку **M48**: owner не `storage.from('renter-documents').upload('{orgId}/orphan.pdf')` в обход `prepare_renter_document_upload` (403); UI загрузка через RPC работает.

Проверку **M34** (дополнение): `rpc/member_scope` / `member_role` с UUID чужой орг — false/empty/denied, не JSON scope.

Проверку **H31**: под JWT обычного teacher `rpc/migrate_organization_version` с `p_actor_user_id` = UUID developer (не свой) и `p_organization_id` чужой/своей орг — **403 / forbidden**, не dry_run counts и не смена `crm_version_id`. Dev Console / service_role по-прежнему мигрирует.

Проверку **H32**: teacher `GET /single_visits?select=amount,method,client_id` — отказ или без сумм; owner/accountant видят. Журнал AttendancePanel у teacher показывает drop-in (кто/дата/слот) без ошибки.

Проверку **M49**: `has_function_privilege('anon','run_version_migration_v2_to_v3(uuid,boolean)','execute')` = false; то же для `is_platform_developer` / `execute_version_migration_script`.

Проверку **M50**: teacher `rpc/get_schedule_calendar_sync_labels` не возвращает `calendar_name` чужих преподавателей.

Проверку **M51**: teacher с `teachers_can_export = false` не `storage.from('exports').upload('{uid}/x.bin')` (403); owner с флагом — CSV через UI работает.

Проверку **M52**: owner не `PATCH teacher_pay_rates` в обход `save_teacher_pay_rule` (403); RPC сохранения правила работает.

Проверку **M53**: teacher не `GET organization_version_migrations` (пусто или 403).

Проверку **M54**: teacher `GET teacher_settlement_line_items?select=monetary_base,title` на чужой `member_id` — пусто; на свой — без сумм выручки / без ФИО после фикса.

Проверку **M55**: teacher `rpc/list_teacher_pay_rules` на свой id — forbidden или без `value`; accountant/owner видят.

Проверку **M56**: teacher `rpc/venue_cost_gap_is_acknowledged` с UUID чужой орг — false/denied, не oracle.

Проверку **H33**: JWT **без** `app_metadata.platform_role` — `GET /platform_audit_log` и `PATCH /crm_product_versions` дают 403/пусто. JWT учётки developer **сегодня** (до фикса) — SELECT всех строк `platform_audit_log` и write каталога версий; после фикса — отказ. **После фикса:** `PATCH /platform_payment_methods` из CRM JWT developer тоже 403 (`is_dev_console_operator` без GRANT UPDATE). Teacher не читает `platform_audit_log`. Dev Console Edge + service_role по-прежнему пишет audit и config кошельков. SELECT `config` для страницы покупки лицензии работает.

Проверку **M57**: teacher `rpc/list_archived_prices` — без `sales_count`, RPC **не** forbidden (модалка оплаты архивного тарифа); owner/director видят архив с count.

Проверку **M58**: после логина token нет в `sessionStorage` и не в query string (только POST). XSS в origin не читает pending invite.

Проверку **M59**: teacher `rpc/close_group_lesson_occurrence` с `p_confirmed_attendee_count`, не равным present в `attendance`, — error; совпадающий count — accrues как UI. Accountant `get_finance_costs` не меняется от фейкового count.

Проверку **L26**: `rpc/is_allowed_teacher` после `updateUser({ data: { telegram_id: '123456789' } })` — функция удалена или всегда false; нет политик `USING (is_allowed_teacher())`.

Проверку **L27**: download документа арендатора — `window.open(..., "noopener,noreferrer")` (DevTools: `opener` у нового окна `null`).

Проверку **L28**: teacher **дашборд** без баннера venue-rule (intel). Reception/`record_subscription_payment` и teacher/`record_personal_lesson_payment` не падают из‑за `get_venue_cost_rule_status`. Accountant/owner `list_venue_cost_rule_versions` и страница hall-rent работают.

---

## Промпты реализации (строго по порядку)

Готовые блоки для нового чата с агентом. Источник истины по уязвимостям — пункты **C1 / H\* / M\* / L\*** выше. Раздел задаёт порядок работ. После сверки с кодом (2026-08-22, четыре прохода + пятый–седьмой 2026-08-26) в блоки S02 / S04 / S05 / S08 / S09 / S11 / S12 / S15 / S16 / S17 / S18 / S19 / S20 / S22 / S24 / S25 / S27 / S28 / S32 / S34 / S35 / S39 добавлены **запреты регрессий SPA/RLS** — без них буквальный REVOKE/триггер/`security_invoker`/неполный GRANT/`select("*")`/запрет venue-status кассиру/Captcha в S12/SELECT `payments` «только financial»/ковровый REVOKE EXECUTE/миграция с timestamp < `20261003` / снятие JWT `platform_role` без REVOKE UPDATE кошельков ломает приложение или оставляет H33 (см. «Сверка документа с кодом»).

H1 (self-service demo 30 дней) **не** входит в промпты: это продуктовое решение. Обход лимита — **H10** (S06).

### Как запускать

1. Новый чат / новый контекст на **один** номер (S01, затем S02, … S40).
2. Скопируй **короткий** блок из **«Тексты для нового чата»** ниже. Длинный fenced-блок `#### S0N` дальше в файле копировать руками не нужно — агент читает его сам и выполняет буквально.
3. Шаги внутри блока `#### S0N` — **сверху вниз**. Не перескакивать. Не чинить соседний пункт аудита, даже если он в том же файле — кроме явно перечисленных в этом промпте ID.
4. Не начинать промпт N, пока N−1 не закрыт (DoD в конце блока). После DoD поставь ✅ в колонке «Готово».
5. Волну N+1 не начинать, пока не закрыты все промпты волны N.
6. Не объединять промпты «за один прогон, быстрее». Не запускать два S* параллельно и не писать «сделай S01–S05».
7. После каждого промпта с миграцией: UI-пути через существующие RPC **и прямые хуки** (продажа не-группы, сетка `schedule_slots`, `useAddPersonalLessons`, `usePersonalLessons({ excludeCancelled: true })`, `useCalendarEventsForWeek`, `useLocations`, `useExpenses`, `useTeamMembers`, `useDisciplines`, `useClientNotes`, `usePlatformPaymentConfig`, `useSingleVisits` в журнале, `usePersonalLessonChargeBalances` / должники сетки / `PayPersonalLessonModal`, `checkVenueRuleBeforePayment` при `record_*`, `useWriteOffPersonalLessonDebt` / FinanceDebtorsPage, `OrganizationProvider` включая `organization_settings.select("*")`) должны остаться рабочими, пока этот промпт явно не перевёл их на RPC/view. Нельзя «закрыть таблицу» и оставить хук.
8. Не `REVOKE EXECUTE FROM authenticated` на функции, которые вызываются **из RLS-политик** (`organization_allows_writes/reads`, `is_active_member`, `member_role`, …) — это роняет весь CRM. См. S22.
9. Не ставить `security_invoker=true` на teacher masking views **и** на `financial_debtors_v`. Не включать GoTrue captcha до S37 (ни config.toml, ни Dashboard). Триггеры на `organization_members` не завязывать на `auth.uid()`. Не column-REVOKE при хуке `select("*")`. `REVOKE ALL ON ALL TABLES` включает views — вернуть GRANT SELECT на masking views. Не сажать `get_venue_cost_rule_status` на `can_read_financial()` — касса reception/teacher зовёт его из `checkVenueRuleBeforePayment`. Не сужать RLS/`GRANT SELECT` `payments` до «только financial» — операционный дашборд admin и касса teacher. Не `REVOKE EXECUTE FROM authenticated` коврово (S22). В S04 не считать снятие JWT `platform_role` достаточным для UPDATE кошельков (`is_dev_console_operator` читает `auth.users`).

Очередь с нуля: начинай с **S01**. Ничего из S\* в коде ещё не закрыто.

### Тексты для нового чата (копируй один блок)

Это **твоя** очередь: один fenced-блок = один новый чат. Агент обязан открыть этот файл, прочитать сверку / таблицу регрессий / «Общие правила» и выполнить длинный блок `#### S0N` буквально. Не склеивай два номера. Не перефразируй шаги.

**Волна 0 — сразу** (S01 … S11)

**S01**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка документа с кодом, таблица «Регрессии: буквальный S* ломает приложение», «Общие правила», длинный fenced-блок #### S01.

Задача: только S01 (C1, M2, M22, M16, M3). Выполни блок S01 буквально, сверху вниз. Не чини H9, H23, M58. Не переходи к S02.

Когда DoD S01 закрыт — стоп. В ответе: файлы, бамп 2.8.y, что проверить вручную для C1 из раздела «Что этот аудит не покрыл».
```

**S02**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, регрессии S02, «Общие правила», длинный блок #### S02.

Задача: только S02 (H23). Предшественник S01 должен быть закрыт; если нет — остановись. Выполни блок S02 буквально.

ЗАПРЕЩЕНО: в теле expire_monthly требовать service_role / auth.uid() IS NULL — PERFORM из mark_attendance идёт с JWT преподавателя. REVOKE EXECUTE у authenticated (PostgREST). Внутренний PERFORM оставить.

Не переходи к S03. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H23.
```

**S03**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S03.

Задача: только S03 (H31). Предшественник S02. Выполни блок S03 буквально. Не чини H33 (это S04).

Не переходи к S04. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H31.
```

**S04**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, регрессии S04, «Общие правила», длинный блок #### S04.

Задача: только S04 (H33). Предшественник S03. Выполни блок S04 буквально.

ЗАПРЕЩЕНО: считать снятие platform_role из JWT достаточным. is_dev_console_operator() читает auth.users.raw_app_meta_data — шаг 3 (REVOKE UPDATE кошельков) обязателен. SELECT config на platform_payment_methods оставить (L22 / страница лицензии).

Не переходи к S05. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H33.
```

**S05**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, регрессии S05, «Общие правила», длинный блок #### S05.

Задача: только S05 (H9, H13). Предшественник S04. Выполни блок S05 буквально.

ЗАПРЕЩЕНО: триггер «auth.uid() IS NOT NULL → запрет role/scope/meta». SECURITY DEFINER не обнуляет auth.uid() — убьёт update_team_member и accept-invite. Нужен SET LOCAL из RPC или current_user.

Не переходи к S06. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H9/H13.
```

**S06**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S06.

Задача: только S06 (H10). Предшественник S05. Выполни блок S06 буквально.

ЗАПРЕЩЕНО: выдумывать RPC смены organizations.name — в SPA нет .from("organizations").update; имя школы это organization_settings.branding_name.

Не переходи к S07. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H10.
```

**S07**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S07.

Задача: только S07 (H12). Предшественник S06. Выполни блок S07 буквально. Не чини H11 (S15).

Не переходи к S08. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H12.
```

**S08**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, регрессии S08, «Общие правила», длинный блок #### S08.

Задача: только S08 (H14, H15, H27, M27). Предшественник S07. Выполни блок S08 буквально.

ЗАПРЕЩЕНО: отзывать INSERT на subscriptions (продажа private/package — прямой insert). REVOKE DELETE — да (rollback .delete() мёртвый). REVOKE UPDATE — да (H15 PATCH lessons_left). Не чинить H21/H22 (S09).

Не переходи к S09. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H14/H15/H27.
```

**S09**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (H26/S09 price_id, S09 SELECT payments), регрессии S09, «Общие правила», длинный блок #### S09.

Задача: только S09 (H21, H22, H26, H16, M19). Предшественник S08. Выполни блок S09 буквально. Это опасный шаг для SPA.

Порядок: сначала DROP+CREATE personal_lessons_teacher_v (+ cancelled_at, + price_id, сохранить client_id4) и перевод excludeCancelled на view; personalLessonsSelectTeacher дополнить price_id. INSERT REST на уроки оставить. REVOKE UPDATE/DELETE на personal_lessons. payments: REVOKE только write; GRANT SELECT у authenticated оставить; RLS SELECT не сужать до «только financial».

ЗАПРЕЩЕНО: триггер на paid/price при INSERT продажи; SELECT payments только бухгалтеру; снимать SELECT из FOR ALL без перевода хука на view.

Не переходи к S10. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H16/H21/H22/H26.
```

**S10**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S10.

Задача: только S10 (H17, H18). Предшественник S09. Выполни блок S10 буквально. Не чини H29 (S11) и не трогай expenses (S35).

Не переходи к S11. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H17/H18.
```

**S11**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (H29, write_off_personal_lesson_debt), регрессии S11, «Общие правила», длинный блок #### S11.

Задача: только S11 (H29, M44, M37). Предшественник S10. Конец волны 0. Выполни блок S11 буквально.

Период на money-in RPC и на update_payment_in_place / restate_* / write_off_personal_lesson_debt. ЗАПРЕЩЕНО резать storno_payment / correct_payment тем же порогом (correction path). Не забыть write_off — иначе дыра H29 остаётся.

Не переходи к S12. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H29/M44. Волна 0 закрыта только если S01–S11 все с DoD.
```

**Волна 1** (S12 … S27) — не начинать, пока волна 0 не закрыта.

**S12**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (S12 vs S37, H5/S12), регрессии S12, «Общие правила», длинный блок #### S12.

Задача: только S12 (H5). Предшественник S11, волна 0 закрыта. Выполни блок S12 буквально.

S12: пароль ≥8, confirm email, timebox, max_frequency, allowlist. ЗАПРЕЩЕНО включать GoTrue captcha в config.toml или Dashboard — signUp без токена даст 400 до S37.

Не переходи к S13. DoD закрыт — стоп. Ответ: файлы, бамп, чеклист Dashboard без Captcha.
```

**S13**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S13.

Задача: только S13 (H2, H6, M20). Предшественник S12. Выполни блок S13 буквально. Не включать captcha на signup (S37).

Не переходи к S14. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S14**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S14.

Задача: только S14 (H4). Предшественник S13. Выполни блок S14 буквально.

Не переходи к S15. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S15**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, регрессии S15, «Общие правила», длинный блок #### S15.

Задача: только S15 (H11). Предшественник S14. Выполни блок S15 буквально.

После S08 REVOKE UPDATE на subscriptions — шаг 3 S15 не возвращать GRANT UPDATE. Не чини H7 (S32) и не DROP teacher SELECT clients.

Не переходи к S16. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H11.
```

**S16**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (H32/S16), регрессии S16, «Общие правила», длинный блок #### S16.

Задача: только S16 (H19, M30, H20, H32). Предшественник S15. Выполни блок S16 буквально.

Teacher view / select single_visits: журнал AttendancePanel должен остаться живым (кто/когда/слот). Не DROP amount без правки хука — замапить или убрать финансовые колонки в teacher-select в том же прогоне.

Не переходи к S17. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H19/H20/H32.
```

**S17**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (H24/SPA), регрессии S17, «Общие правила», длинный блок #### S17.

Задача: только S17 (H24, H25, H28). Предшественник S16. Выполни блок S17 буквально.

Политика junction price_disciplines / price_teacher_members = can_manage_prices(); GRANT write оставить — syncPrice* это прямой insert/delete. Сетка teacher: хук не селектит income_amount/paid_amount; SELECT title/типа/сессий оставить. Не DROP teacher SELECT calendar_events без правки хука.

Не переходи к S18. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H24/H25/H28.
```

**S18**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (H30/S18, S18/M57), регрессии S18, «Общие правила», длинный блок #### S18.

Задача: только S18 (H30, M54, M55, M57). Предшественник S17. Выполни блок S18 буквально.

ЗАПРЕЩЕНО: forbidden list_archived_prices для teacher (модалка оплаты архивного тарифа). Убрать sales_count, EXECUTE оставить. Не DROP teacher SELECT personal_lesson_charges без хука — usePersonalLessonChargeBalances на сетке должников и PayPersonalLessonModal. Сначала хук/view без сумм для списка; оплату не ломать.

Не переходи к S19. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H30/M57.
```

**S19**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (S19 useTeamMembers), регрессии S19, «Общие правила», длинный блок #### S19.

Задача: только S19 (M13, M24, M28, M25). Предшественник S18. Выполни блок S19 буквально.

useTeamMembers — один хук на 15+ callers. Нужны ДВА queryFn/хука: roster (ФИО, display_name, role, is_active, meta.restricted_admin; без phone/telegram/user_id/scope) и full только для TeamSettingsPage. MemberProfileModal хук не зовёт — член приходит пропсом. Не DROP SELECT членов до view.

Не переходи к S20. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S20**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, регрессии S20, «Общие правила», длинный блок #### S20.

Задача: только S20 (M26, M35, M36, M40). Предшественник S19. Выполни блок S20 буквально.

Не отзывать write локаций без RPC и перевода useLocations (прямой insert/update/delete). Waitlist-мутации уже RPC — там REVOKE ок.

Не переходи к S21. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S21**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S21.

Задача: только S21 (M33). Предшественник S20. Выполни блок S21 буквально.

Не переходи к S22. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S22**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (S22 шаг 5), регрессии S22, «Общие правила», длинный блок #### S22.

Задача: только S22 (M34, M56, M49). Предшественник S21. Выполни блок S22 буквально. Это опасный шаг для всего CRM.

ЗАПРЕЩЕНО: REVOKE EXECUTE ON ALL FUNCTIONS FROM authenticated. Только PUBLIC и anon. Не трогать EXECUTE у authenticated на RPC и RLS-хелперы (organization_allows_writes/reads, is_active_member, member_role, mark_attendance, record_*, write_off_personal_lesson_debt, set_active_organization, apply_scheduled_subscription_member_changes). apply_scheduled SPA сама зовёт — не revoke.

Не переходи к S23. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка M34/M49/M56.
```

**S23**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S23.

Задача: только S23 (M38, M42, M47, M50). Предшественник S22. Выполни блок S23 буквально.

Не переходи к S24. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка M38/M42/M47/M50.
```

**S24**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (M43/M45), регрессии S24, «Общие правила», длинный блок #### S24.

Задача: только S24 (M41, M43, M45, M46, M53). Предшественник S23. Выполни блок S24 буквально.

OrganizationProvider для КАЖДОГО члена грузит license_type/activated_at/expires_at и plan/billing_period/status. REVOKE SELECT всей таблицы → белый экран. Узкий набор колонок или RPC бандла; не throw на пустой лицензии. stripe_subscription_id / access_key_id teacher не видит.

Не переходи к S25. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка M43/M45.
```

**S25**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, регрессии S25, «Общие правила», длинный блок #### S25.

Задача: только S25 (M48, M51, M52). Предшественник S24. Выполни блок S25 буквально.

Сначала UI на save_teacher_pay_rule, потом REVOKE write teacher_pay_rates (MemberProfileModal → useUpsertTeacherPayRate → .insert).

Не переходи к S26. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка M48/M51/M52.
```

**S26**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S26.

Задача: только S26 (M59). Предшественник S25. Выполни блок S26 буквально.

Не переходи к S27. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка M59.
```

**S27**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (S27 GRANT), регрессии S27, «Общие правила», длинный блок #### S27.

Задача: только S27 (M31, M32, L10). Предшественник S26. Конец волны 1. Выполни блок S27 буквально. Это опасный шаг: REVOKE ALL снимает и views.

После REVOKE ALL: GRANT SELECT на ИМЕНОВАННЫЙ список таблиц и views из блока S27 (не «и т.д.»). В списке обязательны: personal_lessons_teacher_v, subscriptions_teacher_v, financial_debtors_v, calendar_events, calendar_event_sessions, schedule_occurrence_cancellations, lesson_occurrence_closures, other_income, audit_log, GCal bindings, waitlist, freeze, subscription_refunds, payroll tables, single_visits, personal_lesson_charges, subscription_groups, platform_payment_methods, renter_documents. Write — список S27; RPC-only write не возвращать. Write disciplines / client_notes нужен SPA.

Не переходи к S28. DoD закрыт — стоп. Ответ: файлы, бамп. Волна 1 закрыта только если S12–S27 все с DoD.
```

**Волна 2** (S28 … S31) — не начинать, пока волна 1 не закрыта.

**S28**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, регрессии S28, «Общие правила», длинный блок #### S28.

Задача: только S28 (H3, M8). Предшественник S27, волна 1 закрыта. Выполни блок S28 буквально.

Default remember-me = false в readRememberMePreference И в дефолте аргумента signInWithEmail. Галочка — явное согласие. Комментария в supabase.ts недостаточно.

Не переходи к S29. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S29**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S29.

Задача: только S29 (H8, M11). Предшественник S28. Выполни блок S29 буквально.

Не переходи к S30. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S30**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S30.

Задача: только S30 (M15, M39, M58). Предшественник S29. Выполни блок S30 буквально.

Не переходи к S31. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка M58.
```

**S31**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S31.

Задача: только S31 (M17). Предшественник S30. Конец волны 2. Выполни блок S31 буквально. Dev Console можно трогать, если блок S31 это требует.

Не переходи к S32. DoD закрыт — стоп. Ответ: файлы, бамп. Волна 2 закрыта только если S28–S31 все с DoD.
```

**Волна 3** (S32 … S36) — не начинать, пока волна 2 не закрыта.

**S32**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (H7/S32), регрессии S32, «Общие правила», длинный блок #### S32.

Задача: только S32 (H7). Предшественник S31, волна 2 закрыта. Выполни блок S32 буквально.

Сначала хук useClients / useClientDirectory на clients_teacher_v, потом DROP teacher SELECT на base clients. Иначе пустые журнал, sale form, ФИО на сетке.

Не переходи к S33. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка H7.
```

**S33**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S33.

Задача: только S33 (M21). Предшественник S32. Выполни блок S33 буквально. Только флаги §9, которые ещё не закрыли S07–S20. Не дублировать S07/S08/S15/S20.

Не переходи к S34. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S34**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (S34 financial_debtors_v, S34/M5), регрессии S34, «Общие правила», длинный блок #### S34.

Задача: только S34 (M5, M6, M7). Предшественник S33. Выполни блок S34 буквально.

ЗАПРЕЩЕНО: security_invoker=true на personal_lessons_teacher_v, subscriptions_teacher_v и financial_debtors_v. После S09 teacher без SELECT на base — masking view пустой; accountant-страница дебиторов падает. Invoker=true только где роль уже имеет SELECT на все base.

Не переходи к S35. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S35**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, регрессии S35, «Общие правила», длинный блок #### S35.

Задача: только S35 (M12, M23, M29). Предшественник S34. Выполни блок S35 буквально.

Предпочтительно _is_finance_period_closed в RLS на expenses, не REVOKE write: useExpenses — прямой insert/delete.

Не переходи к S36. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S36**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S36.

Задача: только S36 (M1). Предшественник S35. Конец волны 3. Выполни блок S36 буквально. Только остаток UI≠API, который ещё не закрыли S07–S33.

Не переходи к S37. DoD закрыт — стоп. Ответ: файлы, бамп. Волна 3 закрыта только если S32–S36 все с DoD.
```

**Волна 4** (S37 … S40) — не начинать, пока волна 3 не закрыта.

**S37**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (S12 vs S37), «Общие правила», длинный блок #### S37.

Задача: только S37 (M4, M9, M10, M14, M18). Предшественник S36, волна 3 закрыта. Выполни блок S37 буквально.

Здесь (не в S12) включать GoTrue captcha и передавать токен в signUp. После этого — чеклист Dashboard Captcha.

Не переходи к S38. DoD закрыт — стоп. Ответ: файлы, бамп, чеклист Captcha.
```

**S38**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S38.

Задача: только S38 (L2, L3, L4, L5, L9, L12, L17, L19, L20). Предшественник S37. Выполни блок S38 буквально.

Не переходи к S39. DoD закрыт — стоп. Ответ: файлы, бамп.
```

**S39**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка (S39 колонки settings, L21 bindings, L22, L28), регрессии S39, «Общие правила», длинный блок #### S39.

Задача: только S39 (L11, L15, L18, L21, L22, L24, L26, L27, L28). Предшественник S38. Выполни блок S39 буквально. Это опасный шаг для белого экрана орг и кассы.

ЗАПРЕЩЕНО: column-REVOKE при OrganizationProvider select("*"); явный SELECT без org_preset/terminology/directors_can_*/low_balance_threshold/branding_name; REVOKE SELECT platform_payment_methods; сажать get_venue_cost_rule_status на can_read_financial(); column-REVOKE last_error_code/last_error_at на GCal bindings (колонки last_error там нет).

Не переходи к S40. DoD закрыт — стоп. Ответ: файлы, бамп, ручная проверка L26/L27/L28.
```

**S40**

```
Прочитай .cursor/docs/ai/AI_CONTEXT.md, затем .cursor/docs/ai/crm_security_audit_2026-08-22.md: сверка, «Общие правила», длинный блок #### S40.

Задача: только S40 (L1, L6, L7, L8, L13, L14, L16, L25). Предшественник S39. Последний промпт очереди. Выполни блок S40 буквально. Не открывать заново C1/H*. L14 не чинить как баг. L16 пропустить, если закрыл S35.

Когда DoD S40 закрыт — стоп. Не начинай S01 заново и не выдумывай S41. В ответе: таблица S01–S40 (что закрыто этим прогоном / что уже было). Волна 4 и вся очередь закрыты только если S37–S40 все с DoD.
```

Длинные блоки `#### S01` … `#### S40` ниже — источник шагов, файлов и DoD. Их не обязательно копировать в чат.

### Последовательность выполнения промптов

Это **единственный** допустимый порядок. Следующий номер — только после DoD предыдущего. Параллельно, «через один» и «два S* в одном чате» — нельзя. Копировать в чат — блоки в **«Тексты для нового чата»** выше.

**Канон одной строкой:**

S01 → S02 → S03 → S04 → S05 → S06 → S07 → S08 → S09 → S10 → S11 → S12 → S13 → S14 → S15 → S16 → S17 → S18 → S19 → S20 → S21 → S22 → S23 → S24 → S25 → S26 → S27 → S28 → S29 → S30 → S31 → S32 → S33 → S34 → S35 → S36 → S37 → S38 → S39 → S40

**Волны (следующую не начинать, пока не закрыта текущая):**

| Волна | Промпты | Смысл |
|-------|---------|--------|
| **0 — сразу** | S01 … S11 | Захват аккаунта → кросс-тенант → привилегии тенанта → касса только через RPC → закрытый период |
| **1** | S12 … S27 | Auth/abuse, org-флаги, R4, DEFINER, Storage, ковровый GRANT |
| **2** | S28 … S31 | Сессия, увольнение, origin инвайта/сброса, recovery-код |
| **3** | S32 … S36 | PII teacher, оставшиеся флаги, views/GraphQL, офлайн/audit, остаток UI≠API |
| **4** | S37 … S40 | Публичные Edge, гигиена, низкие SELECT/legacy |

После DoD поставь ✅ вместо ☐.

| Готово | Шаг | Делать | Волна | Закрывает | Не раньше чем | Зачем этот шаг сейчас |
|--------|-----|--------|-------|-----------|---------------|------------------------|
| ✅ | 1 | **S01** | 0 | **C1**, M2, M22, M16, M3 | — | Захват чужого `auth.users` через инвайт |
| ✅ | 2 | **S02** | 0 | **H23** | S01 | Кросс-тенантный `UPDATE subscriptions` |
| ✅ | 3 | **S03** | 0 | **H31** | S02 | Кросс-тенантная миграция версии + spoof developer |
| ✅ | 4 | **S04** | 0 | **H33** | S03 | `platform_role` в JWT CRM; write platform-таблиц. После S03, чтобы клиентский migrate уже был мёртв |
| ✅ | 5 | **S05** | 0 | **H9**, **H13** | S04 | Director → owner и эскалация `scope`/`meta` через REST |
| ✅ | 6 | **S06** | 0 | **H10** | S05 | Бессрочное демо / смена `owner_user_id` через `UPDATE organizations` |
| ✅ | 7 | **S07** | 0 | **H12** | S06 | Reception ≠ full admin. После S05–S06 REST на members/orgs уже закрыт; остаются helpers и settings |
| ✅ | 8 | **S08** | 0 | **H14**, **H15**, **H27**, M27 | S07 | Журнал/абонементы только через RPC; finish/freeze с флагом продажи |
| ✅ | 9 | **S09** | 0 | **H21**, **H22**, **H26**, **H16**, M19 | S08 | Касса и персоналки: REST write + R4 + чужие уроки |
| ✅ | 10 | **S10** | 0 | **H17**, **H18** | S09 | Rental billing и payroll settlements только RPC |
| ✅ | 11 | **S11** | 0 | **H29**, M44, M37 | S10 | Закрытый период на всю кассу (в т.ч. `write_off` 2.8.73). После REVOKE REST, иначе PATCH обходит RPC |
| ☐ | 12 | **S12** | 1 | **H5** | S11 (волна 0 закрыта) | Auth: пароль, confirm email, timebox, redirect allowlist (Captcha GoTrue — **S37**, не здесь) |
| ☐ | 13 | **S13** | 1 | **H2**, **H6**, M20 | S12 | Демо-ключ не в JSON; durable rate limit; Turnstile fail-closed |
| ☐ | 14 | **S14** | 1 | **H4** | S13 | CSP / frame-ancestors / HSTS |
| ☐ | 15 | **S15** | 1 | **H11** | S14 | Teacher write клиентов только при `teachers_can_edit_clients` |
| ☐ | 16 | **S16** | 1 | **H19**, M30, **H20**, **H32** | S15 | `subscription_groups`; drop-in флаг + маскирование сумм |
| ☐ | 17 | **S17** | 1 | **H24**, **H25**, **H28** | S16 | Финансы мастер-классов; rental series REST; привязки тарифов |
| ☐ | 18 | **S18** | 1 | **H30**, M54, M55, M57 | S17 | Остатки обхода R4: charges, payroll lines, ставки, `sales_count` |
| ☐ | 19 | **S19** | 1 | M13, M24, M28, M25 | S18 | Roster команды, заметки, `token_hash` инвайта |
| ☐ | 20 | **S20** | 1 | M26, M35, M36, M40 | S19 | Waitlist; classes/locations; `admin_can_edit_schedule` в RLS |
| ☐ | 21 | **S21** | 1 | M33 | S20 | CSV formula injection |
| ☐ | 22 | **S22** | 1 | M34, M56, M49 | S21 | DEFINER без членства; `REVOKE PUBLIC` у функций |
| ☐ | 23 | **S23** | 1 | M38, M42, M47, M50 | S22 | Preview/occupancy PII и имена календарей |
| ☐ | 24 | **S24** | 1 | M41, M43, M45, M46, M53 | S23 | Широкий SELECT member: замены, Stripe, лицензии, freeze, миграции |
| ☐ | 25 | **S25** | 1 | M48, M51, M52 | S24 | Storage документов/`exports`; REST `teacher_pay_rates` |
| ☐ | 26 | **S26** | 1 | M59 | S25 | `attendee_count` закрытия группы из журнала, не с клиента |
| ☐ | 27 | **S27** | 1 | M31, M32, L10 | S26 | Auto-expose OFF; `REVOKE` у `anon`; явные GRANT. Последним в волне 1, когда табличные write уже сняты точечно |
| ☐ | 28 | **S28** | 2 | **H3**, M8 | S27 (волна 1 закрыта) | Сессия: remember-me, MFA/timebox |
| ☐ | 29 | **S29** | 2 | **H8**, M11 | S28 | Revoke при deactivate; не держать JWT орг час после увольнения |
| ☐ | 30 | **S30** | 2 | M15, M39, M58 | S29 | `redirectTo` / `SITE_URL` / токен инвайта не в query и не в `sessionStorage` |
| ☐ | 31 | **S31** | 2 | M17 | S30 | Recovery-код владельца не в JSON и не в `history.state` |
| ☐ | 32 | **S32** | 3 | **H7** | S31 (волна 2 закрыта) | Teacher PII карточки клиента через view |
| ☐ | 33 | **S33** | 3 | M21 | S32 | Оставшиеся org-флаги §9 в SQL (что не закрыли S07–S20) |
| ☐ | 34 | **S34** | 3 | M5, M6, M7 | S33 | `security_invoker`; `access_keys`; выключить GraphQL |
| ☐ | 35 | **S35** | 3 | M12, M23, M29 | S34 | Офлайн PII; `expenses` + период; `audit_log` без полных diff director |
| ☐ | 36 | **S36** | 3 | M1 | S35 | Остаток «UI ≠ API»: модули/флаги, которые ещё только в `permissions.ts` |
| ☐ | 37 | **S37** | 4 | M4, M9, M10, M14, M18 | S36 (волна 3 закрыта) | Публичные Edge; Turnstile на signup; тексты ошибок; enumeration; waitlist org |
| ☐ | 38 | **S38** | 4 | L2, L3, L4, L5, L9, L12, L17, L19, L20 | S37 | Гигиена Edge/Auth/config |
| ☐ | 39 | **S39** | 4 | L11, L15, L18, L21, L22, L24, L26, L27, L28 | S38 | Узкие SELECT/legacy/tabnabbing |
| ☐ | 40 | **S40** | 4 | L1, L6, L7, L8, L13, L14, L16, L25 | S39 | Информационный остаток и чеклист Dashboard |

**Вытащены вперёд** (в аудите стоят в более поздней волне, но чинятся здесь, потому что тот же код/политика):

- M3, M16 → **S01** (текст C1: не createUser до accept, длинный токен)
- H13 → **S05** («вместе с H9»)
- H16, H26, M19 → **S09** (те же `FOR ALL` / таблица `payments`, что H21/H22)
- M27 → **S08** («вместе с H14»)
- M37, M44 → **S11** («вместе с H29»; с 2.8.73 туда же `write_off_personal_lesson_debt`)
- M30 → **S16** («вместе с H19»)
- M32, L10 → **S27** (тот же GRANT/auto-expose, что M31)
- L23 не чинится: superseded **H33** / **S04**

Ручные проверки из раздела «Что этот аудит не покрыл» гонять **после DoD того S\*, который закрывает пункт**, не откладывая все проверки на конец файла.

### Общие правила (все промпты с кодом)

- Сначала `.cursor/docs/ai/AI_CONTEXT.md`, затем этот файл (указанные пункты) и файлы из «Прочитай сначала».
- Логика Supabase — только `tangodb/src/hooks/` и `tangodb/src/lib/`. Компоненты не зовут PostgREST в обход хуков.
- RLS и GRANTs **менять можно и нужно**, если шаг промпта это требует. Новые политики — только в **новой** миграции. Имя файла: timestamp **строго больше** последней существующей в `tangodb/supabase/migrations/` (сейчас хвост `20261003000001_gcal_sync_token_cache_and_claim_org.sql`; не `20261002000002`, не `20260930000003` и не перетирать старые файлы).
- Не дублировать хуки, RPC, политики. Сначала codegraph / существующие `mark_*` / `record_*` / `update_team_member`.
- Не обходить RLS с клиента. Не добавлять `SECURITY DEFINER` без проверки `auth.uid()` / `auth_organization_id()` / роли. Новым DEFINER: `SET search_path` + `REVOKE ALL FROM PUBLIC, anon` + узкий `GRANT`.
- После кода: бамп третьей цифры `APP_VERSION` (`tangodb/src/lib/appVersion.ts`) и `tangodb/package.json` на +1 от **текущего** значения; строка в `.cursor/docs/ai/changelog.md`. Для C1, H9, H10, H12, H23, H31, H33 — ещё `.cursor/docs/ai/lessons.md` (дата, ошибка, причина, как избежать).
- В конце прогона: `npx tsc --noEmit` в `tangodb/` — без новых ошибок.
- Если упираешься в другой пункт аудита — остановись и напиши, какой **S\*** его закрывает. Не чини его сам.
- Не трогай `tangodb-dev-console/` кроме промптов, где Dev Console указан явно (S03, S04, S31).

---

### Волна 0 — сразу (захват аккаунта, кросс-тенант, привилегии, касса)

#### S01 — C1: инвайт не перезаписывает пароль и не выдаёт сессию

**Предшественник:** нет (первый промпт).  
**Закрывает:** C1, M2, M22, M16, M3.

```
Задача: S01 аудита безопасности CRM 2026-08-22. Только C1 + M2 + M22 + M16 + M3. Не чинить H9, H23, M58 (query/sessionStorage — S30).

Предшественник: нет. Если complete-invite уже не зовёт updateUserById(password) для существующего auth.users и не возвращает access_token — остановись и скажи, что именно осталось.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md разделы C1, M2, M22, M16, M3
- tangodb/supabase/functions/complete-invite/index.ts
- tangodb/supabase/functions/invite-member/index.ts
- tangodb/supabase/functions/preview-invite/index.ts
- tangodb/src/auth/AcceptInvitePage.tsx
- хелпер генерации токена (inviteToken / аналог)

Делай строго по шагам:

1. Существующий auth.users (ветка else после findAuthUserByEmail): ЗАПРЕЩЕНО auth.admin.updateUserById с password. ЗАПРЕЩЕНО signInWithPassword за invitee. Не менять email_confirm. Ответ complete-invite: needs_login / accept_after_auth без токенов. Invitee принимает инвайт только со своей уже существующей сессией (или magic link на вход, без set-password).
2. Новый пользователь: не createUser в invite-member / ensureInvitedAuthUser до принятия (M16). Создавать учётку в complete-invite в момент accept. Не confirmed-без-пароля заранее.
3. Ни complete-invite, ни invite-member не возвращают access_token / refresh_token в JSON (M22).
4. invite-member не возвращает invite_url / plaintext token пригласившему (M2). Только email_sent + без токена. Письмо — единственный канал ссылки.
5. Токен приглашения: ≥128 бит CSPRNG, не 8 символов алфавита 32 (M3). Хранение по-прежнему hash+pepper. Старые короткие токены: либо инвалидировать миграцией, либо принимать только новый формат.
6. preview-invite: не отдавать email чужого ящика по одному токену (убрать email из ответа или требовать сессию того же email).
7. AcceptInvitePage: сценарий «уже есть аккаунт» → логин → accept без формы нового пароля. Сценарий «новый» → пароль только для новой учётки; после complete-invite **не** требовать result.access_token (сейчас handleSetupPassword падает без JWT). Не отображать и не логировать plaintext token. Edge и страница — **один** прогон, не деплоить только функцию.
8. Бамп 2.8.y, changelog, lessons.md (инвайт существующего email ≠ смена пароля платформы).

Не делать: CSP (S14), sessionStorage token (S30), SITE_URL fallback (S30), H6 durable Redis (S13) — in-memory rate limit complete-invite можно чуть ужесточить, но не заменять инфраструктуру.

DoD:
- Инвайт email уже существующего пользователя: пароль жертвы не меняется; в ответе нет JWT; захват аккаунта по ссылке невозможен.
- Пригласивший не получает invite_url в API.
- Новый invitee не появляется в auth.users до accept.
- tsc зелёный. Другие пункты аудита не изменены.

Стоп. Не переходи к S02.
```

#### S02 — H23: `expire_monthly_subscriptions` не с клиента и не на чужие орг

**Предшественник:** S01.  
**Закрывает:** H23.

```
Задача: S02 аудита безопасности CRM 2026-08-22. Только H23. Не чинить H31, M34, H15.

Предшественник: S01 в коде (complete-invite не отдаёт JWT и не ставит пароль существующему).

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H23 и раздел «Сверка документа» (S02)
- определение expire_monthly_subscriptions (20260715000001 и более поздние CREATE OR REPLACE)
- кто вызывает: PERFORM из mark_attendance / freeze / partner-replacement (SPA **не** зовёт; cron Edge **не** зовёт)

Делай строго по шагам:

1. Новая миграция: REVOKE EXECUTE ON expire_monthly_subscriptions FROM PUBLIC, anon, authenticated. GRANT service_role — только если появится cron/pg_net. Owner функции (postgres) по-прежнему может PERFORM из других DEFINER.
2. ЗАПРЕЩЕНО в теле: IF auth.uid() IS NULL; IF auth.role() = service_role; отказ всем JWT. mark_attendance вызывает expire_monthly с сессией преподавателя — такой guard **убивает истечение monthly в журнале**.
3. Клиентский PostgREST не должен вызывать RPC (шаг 1). SPA-вызова нет — не выдумывать cron «вместо журнала». Не убирать PERFORM expire_monthly_subscriptions из mark_attendance / freeze / замены партнёра.
4. Не менять семантику UPDATE status='finished' для billing_model monthly_unlimited; только кто имеет право вызывать **через PostgREST**.
5. Бамп 2.8.y, changelog, lessons.md (DEFINER + GRANT authenticated + p_org_id NULL = кросс-тенант write).

DoD: JWT teacher/accountant rpc/expire_monthly_subscriptions (свой, чужой, null) → permission denied. Отметка журнала по-прежнему истекает monthly своей орг через PERFORM внутри mark_attendance. tsc зелёный.

Стоп. Не переходи к S03.
```

#### S03 — H31: `migrate_organization_version` только service_role, без spoof actor

**Предшественник:** S02.  
**Закрывает:** H31.

```
Задача: S03 аудита безопасности CRM 2026-08-22. Только H31. Не чинить H33 (JWT platform_role — S04), M49 целиком, M53.

Предшественник: S02 (expire_monthly не EXECUTE у authenticated).

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H31
- 20260625000002_v2_version_migration.sql (migrate_organization_version)
- вызовы из tangodb/ и tangodb-dev-console/ (Edge dev-console migrate, если есть)

Делай строго по шагам:

1. Новая миграция: внутри migrate_organization_version всегда v_actor := auth.uid() (или явный service_role path). Игнорировать p_actor_user_id с клиента. Нельзя пройти is_platform_developer(чужой uuid).
2. REVOKE EXECUTE ON migrate_organization_version FROM PUBLIC, anon, authenticated. GRANT service_role. Клиентский PostgREST не вызывает migrate.
3. Платформенная миграция — только Dev Console Edge с service_role (существующий путь). Не добавляй новый DEFINER «для SPA».
4. Бамп 2.8.y, changelog, lessons.md (никогда не доверять p_actor_user_id из клиента в DEFINER).

DoD: JWT обычного member rpc/migrate_organization_version с p_actor_user_id=UUID developer и чужим/своим p_organization_id → 403/forbidden, без dry_run counts и без смены crm_version_id. Dev Console/service_role мигрирует. tsc зелёный.

Стоп. Не переходи к S04.
```

#### S04 — H33: не класть `platform_role` в клиентский JWT

**Предшественник:** S03.  
**Закрывает:** H33 (L23 не чинить — ошибочный пункт).

```
Задача: S04 аудита безопасности CRM 2026-08-22. Только H33. Не чинить L8 allowlist Dev Console, L14 developer demo, L22 SELECT кошельков (S39), M53.

Предшественник: S03 (migrate не EXECUTE у authenticated).

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H33
- custom_access_token_hook (20260627000002 и актуальное тело)
- политики platform_audit_log_developer, crm_product_versions_write_developer
- auth_platform_role()
- tangodb-dev-console: как Edge проверяет developer (getUser app_metadata, не PostgREST из CRM)

Делай строго по шагам:

1. Хук выдачи JWT: НЕ копировать app_metadata.platform_role в top-level claim. CRM JWT без platform_role.
2. Политики USING (auth_platform_role() = 'developer') на platform_audit_log / write crm_product_versions / select всех organization_version_migrations — убрать или USING (false) для authenticated.
3. REVOKE ALL ON platform_audit_log FROM authenticated. Write crm_product_versions — только service_role. UPDATE platform_payment_methods — только service_role / Dev Console Edge (не PostgREST из CRM). **SELECT config** на `platform_payment_methods` не отзывать (SPA purchase UI). Снятие claim (шаг 1) **не** закрывает UPDATE: `is_dev_console_operator()` читает `auth.users.raw_app_meta_data`. Нужен REVOKE UPDATE / политика USING (false) для authenticated.
4. Dev Console по-прежнему определяет developer через auth.getUser() + app_metadata / allowlist на Edge, не через claim в SPA.
5. Бамп 2.8.y, changelog, lessons.md (platform-роль в клиентском JWT = PostgREST на все тенанты).

DoD: JWT без app_metadata.platform_role — GET platform_audit_log и PATCH crm_product_versions → 403/пусто. JWT учётки developer из CRM SPA после фикса — то же. PATCH platform_payment_methods из CRM JWT (в т.ч. developer) → 403; Dev Console Edge + service_role пишет config. Teacher не читает platform_audit_log. SELECT config для страницы покупки лицензии работает. tsc зелёный.

Стоп. Не переходи к S05.
```

#### S05 — H9 + H13: команда только через RPC, не PATCH `organization_members`

**Предшественник:** S04.  
**Закрывает:** H9, H13.

```
Задача: S05 аудита безопасности CRM 2026-08-22. Только H9 и H13 (не разносить). Не чинить H10, H12 (S06–S07), M13 (S19).

Предшественник: S04.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H9, H13
- политики organization_members_insert_team / _update_team / _delete_team
- RPC update_team_member, create_organization_invite
- GRANT на organization_members
- useTeamInvites / хуки команды

Делай строго по шагам:

1. REVOKE INSERT, UPDATE, DELETE ON organization_members FROM authenticated (и anon). Оставить SELECT, если ещё нужен UI; сужение колонок — S19, не здесь.
2. Мутации роли/scope/meta/is_active — только существующие RPC. В RLS не оставлять FOR ALL write с can_manage_team() без проверки колонок.
3. В update_team_member и create_organization_invite: inviter_can_assign_role как сейчас в RPC; нельзя назначить owner с director; нельзя снять последнего owner; p_scope/p_meta — whitelist полей как в UI isTeacherScopeConfigured, не произвольный JSONB (H13). Edge invite-member не пробрасывает произвольный body.meta/scope.
4. Триггер BEFORE INSERT/UPDATE/DELETE на organization_members **опционален** (REVOKE уже закрывает REST). Если делаешь: запрет менять role/scope/meta, когда **нет** `SET LOCAL app.allow_member_mutation` (выставляют DEFINER RPC). ЗАПРЕЩЕНО детектировать «клиент» через `auth.uid() IS NOT NULL` — внутри update_team_member / ensure_own_member_profile uid тот же JWT, команда и автопрофиль умрут. `current_user` = postgres/supabase_admin тоже ок как белый список.
5. UI не переводить на прямой .from('organization_members').update. Только хуки RPC.
6. Бамп 2.8.y, changelog, lessons.md (RLS can_manage_team без ограничения колонки role).

DoD: director/admin PATCH своей строки role=owner → 403. PATCH scope.can_view_all_clients → 403. RPC update_team_member у owner по-прежнему работает в прежних правилах. `ensure_own_member_profile` при входе в орг работает. tsc зелёный.

Стоп. Не переходи к S06.
```

#### S06 — H10: нельзя продлить демо и сменить owner через `UPDATE organizations`

**Предшественник:** S05.  
**Закрывает:** H10.

```
Задача: S06 аудита безопасности CRM 2026-08-22. Только H10. Не чинить H12 (S07), H1 как продукт.

Предшественник: S05 (organization_members write с клиента снят).

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H10
- organizations_update_admin
- GRANT на organizations
- кто в SPA пишет organizations (должно быть никто / только name)

Делай строго по шагам:

1. REVOKE UPDATE ON organizations FROM authenticated, anon. Прямого `.from("organizations").update` в SPA нет. Отображаемое имя школы — `organization_settings.branding_name` (GeneralSettingsPage), не `organizations.name`. Не выдумывать RPC смены name, если UI его не зовёт. Онбординг `complete_organization_onboarding` (DEFINER) должен по-прежнему писать name.
2. demo_expires_at, status, owner_user_id, access_key_id, data_purge_at, crm_version_id — не обновляются с роли authenticated. Только service_role / существующие license RPC.
3. Не ломай SELECT своей орг для UI (`OrganizationProvider` читает id, name, slug, status, demo_expires_at, data_purge_at).
4. Бамп 2.8.y, changelog, lessons.md (organization_allows_writes смотрит demo_expires_at, а UPDATE открыт admin).

DoD: owner/director/admin PATCH organizations.demo_expires_at / owner_user_id / status → 403. Онбординг и branding_name в настройках работают. SELECT своей орг у teacher не падает. Запись после истечения демо по-прежнему режется organization_allows_writes. tsc зелёный.

Стоп. Не переходи к S07.
```

#### S07 — H12: reception не полный admin

**Предшественник:** S06.  
**Закрывает:** H12.

```
Задача: S07 аудита безопасности CRM 2026-08-22. Только H12 (is_restricted_admin в tenant helpers + settings). Не чинить M21 целиком (S33), H9/H10 повторно.

Предшественник: S06.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H12
- can_manage_settings / can_manage_team / is_restricted_admin
- organization_settings_update_* 
- RPC create_organization_invite, update_team_member (проверка can_manage_team)

Делай строго по шагам:

1. Во всех can_manage_team / can_manage_settings и политиках organization_settings_update: AND NOT is_restricted_admin(). Reception не PATCH modules, teachers_can_*, admin_can_*, finance_period_closed_until, freeze_*, branding_*.
2. create_organization_invite / update_team_member: та же проверка NOT is_restricted_admin(), кроме узких reception-RPC если они есть и должны остаться (касса). Не открывай командные RPC reception.
3. Снять restricted_admin с своей строки meta клиент уже не может после S05; не возвращай UPDATE meta.
4. Бамп 2.8.y, changelog, lessons.md (R6 закрыл business write, не tenant can_manage_*).

DoD: учётка reception (meta.restricted_admin) не проходит can_manage_team/settings; PATCH organization_settings.finance_period_closed_until → 403; RPC инвайта → отказ. Owner/director без restricted — UI настроек и команды работают. tsc зелёный.

Стоп. Не переходи к S08.
```

#### S08 — H14 + H15 + H27: журнал и абонементы только через RPC

**Предшественник:** S07.  
**Закрывает:** H14, H15, H27, M27.

```
Задача: S08 аудита безопасности CRM 2026-08-22. Вместе H14, H15, H27, M27. Не чинить H21/H22 (S09), M59 (S26).

Предшественник: S07.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H14, H15, H27, M27 и «Сверка документа» (S08)
- политики attendance_write_* / subscriptions_update_* / subscriptions_delete_*
- RPC mark_attendance, correct_attendance, finish/freeze, create_group_subscription
- GRANT на attendance, subscriptions
- хуки useMarkAttendance / useAddSubscription (не-группа = прямой INSERT)

Делай строго по шагам:

1. REVOKE INSERT, UPDATE, DELETE ON attendance FROM authenticated, anon. SELECT оставить для журнала и офлайн-синк SELECT. Write только mark_attendance / correct_attendance / sync_offline_* (DEFINER).
2. REVOKE UPDATE **и DELETE** ON subscriptions FROM authenticated, anon — PATCH lessons_left/status и DELETE строки с клиента (H15). Rollback `.from("subscriptions").delete()` в useAddSubscription **мёртвый код**: при scheduleGroupIds.length > 0 хук уже ушёл в create_group_subscription и return. Не оставляй DELETE «на всякий rollback».
3. INSERT в subscriptions: НЕ отзывать и НЕ требовать «только sell-RPC» в этом прогоне. useAddSubscription для не-группы делает прямой insert; RPC есть только create_group_subscription. Перевод всей продажи на RPC — отдельный объём; без хука REVOKE INSERT = нельзя продать private/package.
4. finish_subscription / apply_subscription_freeze_period (и соседние freeze RPC): для teacher — teacher_can_write_subscriptions() / teachers_can_sell_subscriptions, как RLS INSERT подписок. Owner/director без этого флага — по роли, как задумано в RPC продажи.
5. directors_can_mark_attendance: после REVOKE write на attendance директор не обходит флаг REST-ом (M27). В RPC флаг уже есть — не снимай.
6. UI/офлайн не переводить на .from('attendance').insert. Только существующие хуки RPC.
7. Бамп 2.8.y, changelog, lessons.md (нет триггера lessons_left на REST attendance).

DoD: teacher PATCH attendance и PATCH subscriptions.lessons_left → 403. Teacher DELETE subscriptions → 403. mark_attendance работает и меняет lessons_left. Продажа абонемента не-группы через UI (прямой INSERT) работает. Teacher при teachers_can_sell_subscriptions=false не finish/freeze. Director при directors_can_mark_attendance=false не пишет журнал через REST. tsc зелёный.

Стоп. Не переходи к S09.
```

#### S09 — H21 + H22 + H26 + H16: платежи и персоналки не через REST FOR ALL

**Предшественник:** S08.  
**Закрывает:** H21, H22, H26, H16, M19.

```
Задача: S09 аудита безопасности CRM 2026-08-22. Вместе H21, M19, H22, H26, H16. Не чинить H17/H18 (S10), H29 (S11), H30 (S18).

Предшественник: S08.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H21, H22, H26, H16, M19 и «Сверка документа» (S09)
- payments_write_admin / payments_update_admin
- personal_lessons_write_teacher / _admin, schedule_slots_write_teacher / _admin
- teacher_can_access_lesson / teacher_can_access_schedule_slot
- RPC record_personal_lesson_payment, update_personal_lesson, delete_personal_lesson (create_personal_lesson **нет**)
- useAddPersonalLessons (.insert paid+price), usePersonalLessons (excludeCancelled: true → СЕЙЧАС base table), useSchedule.ts (insert/update/delete schedule_slots)
- views personal_lessons_teacher_v (R4; **актуально `20260718000001`**: есть `paid` и `client_id4`, **нет** `cancelled_at` и **нет** `price_id`. Не брать за актуальное `20260711000001`.)

Делай строго по шагам:

1. payments: REVOKE INSERT, UPDATE, DELETE FROM authenticated, anon. GRANT SELECT ON payments TO authenticated **оставить** (Postgres-роль одна — `authenticated`; «только бухгалтеру» через GRANT нельзя). RLS SELECT **не сужать**: сейчас `can_read_operational() OR can_read_financial()` — полный admin (не reception) видит кассу на операционном дашборде (`usePayments` + `payments.read.operational`). Сужение до `can_read_financial()` убивает этот дашборд. Teacher строки RLS не пропускает (пусто, не 403). REVOKE SELECT = 403 в `usePersonalLessonChargeBalances` / `usePersonalLessonPayments` / `PayPersonalLessonModal` / `LessonInfoPopup`. Reception SELECT и так нет. Write только record_* / storno / correct / update_payment_* RPC. В RLS write не оставлять can_write_reception() без RPC.
2. personal_lessons — порядок обязателен:
   a) DROP+CREATE personal_lessons_teacher_v: сохранить все текущие колонки включая client_id4 и paid; **добавить cancelled_at и price_id** (FK тарифа, не сумма; PayPersonalLessonModal резолвит архивный тариф по lesson.priceId). Не добавлять price/paid_amount. security_invoker=false не менять. CREATE OR REPLACE без DROP не вставит колонку в середину — как в 20260718000001, DROP VIEW сначала.
   b) usePersonalLessons: teacher ВСЕГДА читает view, включая excludeCancelled (фильтр .is("cancelled_at", null) на view). **personalLessonsSelectTeacher дополнить price_id** (сейчас его нет). Иначе сетка недели / sale form / venue estimate / missing teachers умрут на шаге c, а модалка оплаты не резолвит архив.
   c) Снять FOR ALL. INSERT-политика оставить (продажа). REVOKE UPDATE, DELETE ON personal_lessons FROM authenticated — SPA не .update/.delete таблицу, только RPC update_personal_lesson / delete_personal_lesson.
   d) ЗАПРЕЩЕНО триггером/column GRANT резать paid/price на INSERT: useAddPersonalLessons пишет эти колонки. Резать только UPDATE (шаг c уже).
3. schedule_slots: НЕ переводить сетку на RPC и НЕ REVOKE INSERT/UPDATE/DELETE. Отдельные SELECT-политики уже есть (schedule_slots_select_*). Write-политики не FOR ALL SELECT. useSchedule.ts — штатный write всей недели.
4. Teacher INSERT с выбранным teacher_member_id коллеги в форме — штатный UX, не запрещать. REST UPDATE/DELETE урока после шага 2c уже нет (RPC). В RPC update/delete чужого урока: teacher_member_id = auth_member_id() **или** явное продуктовое «замена в своей дисциплине».
5. Прошлое: can_edit_past_schedule в SQL write-пути слотов и в RPC уроков (H26). teachers_can_sell_personal_lessons — в SQL INSERT персоналок, если ещё нет. `useUnpaidPersonalLessonsCountByPrice` бьёт base `personal_lessons` + колонку `price` — только PricesPanel при редактировании (`prices.write` = owner/director, teacher на `/prices` не пускают). Не включать этот хук для teacher после снятия SELECT с base.
6. Admin write слотов оставить REST (полного RPC расписания нет). admin_can_edit_schedule целиком — S20.
7. Бамп 2.8.y, changelog, lessons.md (FOR ALL = SELECT цены + write прошлого + paid без кассы).

DoD: reception/admin прямой PATCH payments и personal_lessons.paid → 403. Teacher не SELECT personal_lessons.price с base. Teacher-сетка недели, excludeCancelled, продажа персоналки (INSERT с paid/price) работают. Teacher PayPersonalLessonModal видит price_id урока (архивный тариф резолвится). Полный admin по-прежнему видит сегодняшние платежи на операционном дашборде. RPC оплаты и update/delete своих уроков работают. tsc зелёный.

Стоп. Не переходи к S10.
```

#### S10 — H17 + H18: rental billing и payroll settlements только RPC

**Предшественник:** S09.  
**Закрывает:** H17, H18.

```
Задача: S10 аудита безопасности CRM 2026-08-22. Вместе H17 и H18. Не чинить H25 (S17), M52 (S25), H29 (S11).

Предшественник: S09.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H17, H18
- политики rental_invoices_write и соседние advances/deposits/payments
- teacher_settlements_insert/_update, teacher_settlement_payments_insert
- RPC create_rental_invoice, record_rental_*, recalculate_teacher_settlement, record_teacher_settlement_payment

Делай строго по шагам:

1. REVOKE INSERT, UPDATE, DELETE на rental_invoices, rental_invoice_payments, rental_advances, rental_deposits, rental_pricing_adjustments (и прочие rental money tables из H17) FROM authenticated, anon. SELECT — can_read_financial(). Write только существующие DEFINER RPC (они уже проверяют период).
2. Политики FOR ALL с can_read_financial() на write — заменить: write USING false либо удалить write policy.
3. teacher_settlements / teacher_settlement_payments: REVOKE INSERT, UPDATE, DELETE FROM authenticated. Payments строк — только record_teacher_settlement_payment. Не оставлять PATCH amount_accrued/amount_paid с клиента.
4. can_write_payroll() не равен can_read_financial() для REST write (REST write должен исчезнуть). RPC пересчёта — кто сейчас имеет право в SQL, без расширения.
5. Бамп 2.8.y, changelog.

DoD: accountant PATCH rental_invoices / teacher_settlements → 403. RPC record_rental_* и recalculate_teacher_settlement работают. tsc зелёный.

Стоп. Не переходи к S11.
```

#### S11 — H29: закрытый кассовый период на всю кассу

**Предшественник:** S10.  
**Закрывает:** H29, M44, M37 (списание AR `write_off_personal_lesson_debt` 2.8.73 — тот же прогон).  
**Конец волны 0.**

```
Задача: S11 аудита безопасности CRM 2026-08-22. Вместе H29, M44, M37. Не чинить M23 expenses (S35), M52 (S25), REST payments (уже S09).

Предшественник: S10 (rental/payroll REST write снят; rental RPC период уже умеют).

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H29, M44, M37 (таблица RPC)
- _is_finance_period_closed / _org_local_date
- актуальные определения: record_subscription_payment, record_personal_lesson_payment, record_single_visit, record_calendar_event_payment, finish_subscription_with_refund, storno_payment, correct_payment, update_payment_method, update_payment_in_place, restate_personal_lesson_amount, **write_off_personal_lesson_debt** (20261001000001, хук useWriteOffPersonalLessonDebt)
- UI isFinancePeriodClosed (сейчас только аренда); Финансы → Дебиторы кнопка списания долга

Делай строго по шагам:

1. В каждом **приёме денег** из таблицы H29 (record_subscription_payment, record_personal_lesson_payment, record_single_visit, record_calendar_event_payment, finish_subscription_with_refund с датой операции): IF _is_finance_period_closed(org, operation_date) THEN error как у rental (periodClosed). Нет отдельной даты — _org_local_date(org).
2. finish_subscription_with_refund: запрет клиентского p_operation_date ≤ закрытого дня как обхода приёма денег (не доверять дате с клиента).
3. storno / correct_payment / update_payment_method — **не** резать тем же порогом в этом прогоне. Комментарий колонки: закрытый период требует correction path. update_payment_in_place, restate_personal_lesson_amount (M44/M37) и **write_off_personal_lesson_debt** — период как у приёма денег (правка/списание AR «на месте» ≠ сторно-строка). Дата для write-off — personal_lessons.date урока. Если продукт позже запретит и сторно — отдельное решение, не этот S11.
4. UI продажи абонемента / персоналки / drop-in / мастер-класса: тот же признак закрытого периода, что RecordRentalPaymentModal. Не только прятать кнопку: RPC всё равно ошибка. Кнопка списания долга в FinanceDebtorsPage — та же ошибка периода, не молчаливый успех.
5. Бамп 2.8.y, changelog, lessons.md (период только на аренде = касса школы открыта).

DoD: finance_period_closed_until = вчера → record_subscription_payment, record_personal_lesson_payment, record_single_visit, record_calendar_event_payment, update_payment_in_place, restate_personal_lesson_amount, write_off_personal_lesson_debt → periodClosed. storno_payment / correct_payment на платёж закрытого дня **ещё работают** (correction path). Rental RPC по-прежнему режет. После открытия периода — приём денег и списание долга работают. tsc зелёный.

Стоп. Волна 0 закрыта. Не переходи к S12, пока не прогнаны проверки C1, H9, H10, H12, H14/H15, H21/H22, H23, H31, H33 из раздела «Что этот аудит не покрыл».
```

---

### Волна 1 — инсайдерские флаги, R4, DEFINER, Storage, GRANT

#### S12 — H5: политика Auth как в production, не как дырявый config.toml

**Предшественник:** волна 0 (S01–S11) закрыта.  
**Закрывает:** H5.

```
Задача: S12 аудита безопасности CRM 2026-08-22. Только H5. Не чинить H3 remember-me (S28), M8 MFA целиком (S28), M15 allowlist редиректов сверх Auth (уточнение redirectTo клиента — S30).

Предшественник: S11 и ручные проверки волны 0.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H5
- tangodb/supabase/config.toml секции [auth], [auth.email], captcha, sessions
- RegisterPage (UI min 8)

Делай строго по шагам:

1. config.toml (локальный/staging, который копируют): minimum_password_length ≥ 8; включить разумные password_requirements (буквы+цифры как минимум); enable_confirmations = true; secure_password_change = true; задать sessions timebox (не оставлять закомментированным без значения); [auth.email] max_frequency ≥ 60s; additional_redirect_urls — только прод-origin, без *.vercel.app и без голого 127.0.0.1 как единственного прод-редиректа.
   ЗАПРЕЩЕНО включать [auth.captcha] / GoTrue captcha в этом прогоне: AuthProvider.signUpWithEmail не передаёт captcha token (M9 → S37). Иначе регистрация 400 до волны 4. Чеклист Dashboard «Captcha» — включить оператору **после** S37 или вместе с правкой signUp, не здесь.
2. UI регистрации/инвайта: min длина не слабее Auth (уже 8 — не снижать).
3. В changelog/lessons или коротком чеклисте оператора: сверить Supabase Dashboard production (Confirm email ON, min password ≥8, timebox, max_frequency, allowlist редиректов). **Captcha Auth в Dashboard в этом прогоне не включать** (тот же 400, что config.toml). Агент Dashboard сам не кликает — чеклист обязателен в конце ответа.
4. Бамп 2.8.y, changelog.

DoD: локальный config.toml больше не описывает 6-символьный пароль, выключенный confirm и 1s email. Чеклист Dashboard **без** Captcha ON. tsc зелёный.

Стоп. Не переходи к S13.
```

#### S13 — H2 + H6 + M20: демо-ключ только письмом, лимиты и Turnstile не fail-open

**Предшественник:** S12.  
**Закрывает:** H2, H6, M20.

```
Задача: S13 аудита безопасности CRM 2026-08-22. Вместе H2, H6, M20. Не чинить H1 как продукт, L14 developer demo, M14 enumeration (S37).

Предшественник: S12.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H2, H6, M20
- tangodb/supabase/functions/request-demo-key/index.ts
- tangodb/supabase/functions/_shared/rateLimit.ts
- tangodb/supabase/functions/_shared/turnstile.ts
- кто ещё зовёт checkRateLimit / verifyTurnstile

Делай строго по шагам:

1. request-demo-key: не возвращать plaintext key в JSON. Только «письмо отправлено» (одинаково, если можно без enumeration — точный одинаковый ответ на повтор; тонкая доводка M14 в S37). Ключ только в email.
2. rateLimit.ts: убрать единственную защиту Map в памяти как production-контроль. Durable store: таблица в БД / Upstash / аналог, доступный всем изолятам. Подключить к request-demo-key, preview-invite, complete-invite, activate-access-key, landing-track-event (те, что уже лимитятся). IP: только cf-connecting-ip (или документированный CDN-заголовок), не слепо x-forwarded-for.
3. turnstile.ts: если TURNSTILE_SECRET_KEY пуст и окружение production/staging — return { ok: false }, не skip. Dev local может skip только при явном не-production. Алерт/лог при пустом секрете на деплое.
4. Бамп 2.8.y, changelog, lessons.md (ключ в JSON + in-memory limit + fail-open captcha).

DoD: POST request-demo-key не содержит TDB-DEMO в теле. Пустой секрет Turnstile на production не пропускает verify-self-service-registration. Лимит переживает второй инстанс (хотя бы таблица, не только Map). tsc зелёный.

Стоп. Не переходи к S14.
```

#### S14 — H4: security headers на фронте

**Предшественник:** S13.  
**Закрывает:** H4.

```
Задача: S14 аудита безопасности CRM 2026-08-22. Только H4. Не чинить L3 SRI Telegram (S38), H3 localStorage (S28).

Предшественник: S13.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H4
- tangodb/vercel.json, tangodb-dev-console/vercel.json, корневой vercel.json если есть
- tangodb/index.html (telegram script)

Делай строго по шагам:

1. Headers на Vercel для CRM и dev-console: Content-Security-Policy с frame-ancestors 'self' (и необходимые script/connect для Supabase, Turnstile, Vite prod). X-Content-Type-Options nosniff. Referrer-Policy. Strict-Transport-Security.
2. CSP не должен сломать логин, Turnstile, GCal redirect, Telegram script в этом прогоне: если Telegram ещё без SRI — оставить host в CSP; SRI — S38.
3. Не включать unsafe-inline без нужды; если Vite требует — минимально и с комментарием.
4. Бамп 2.8.y, changelog.

DoD: vercel.json отдаёт frame-ancestors и HSTS. CRM не встраивается в чужой iframe. Страницы логина/приложения открываются. tsc зелёный.

Стоп. Не переходи к S15.
```

#### S15 — H11: флаг «преподаватели правят клиентов» в SQL

**Предшественник:** S14.  
**Закрывает:** H11.

```
Задача: S15 аудита безопасности CRM 2026-08-22. Только H11. Не чинить H7 view PII (S32), H13 (уже S05).

Предшественник: S14.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H11
- clients_insert_teacher / _update_teacher / _delete_teacher
- teacher_can_write_clients() vs organization_settings.teachers_can_edit_clients
- subscriptions_update_teacher WITH CHECK client_id2/3
- permissions.ts canTeacherWriteClients

Делай строго по шагам:

1. Политики INSERT/UPDATE teacher на clients: EXISTS teachers_can_edit_clients = true в organization_settings текущей орг. Разделить scope-хелпер и org-флаг (переименовать teacher_can_write_clients если путает).
2. DELETE clients для teacher запретить полностью (RLS USING false / нет политики delete teacher).
3. subscriptions UPDATE teacher: WITH CHECK — все client_id* уже были доступны teacher_can_access_client до UPDATE (нельзя дописать чужой UUID). **Не** возвращать GRANT UPDATE на subscriptions: S08 его снял. Это страховка политики, если GRANT когда-нибудь вернут.
4. UI не менять смысл флага; он должен совпасть с SQL.
5. Бамп 2.8.y, changelog, lessons.md (флаг только в permissions.ts).

DoD: при teachers_can_edit_clients=false teacher INSERT/UPDATE/DELETE clients → 403. При true — update доступной карточки работает, delete нет. PATCH subscriptions чужим client_id2 → отказ. tsc зелёный.

Стоп. Не переходи к S16.
```

#### S16 — H19 + H20 + H32: группы абонемента и drop-in

**Предшественник:** S15.  
**Закрывает:** H19, M30, H20, H32.

```
Задача: S16 аудита безопасности CRM 2026-08-22. Вместе H19, M30, H20, H32. Не чинить H7, M26 waitlist (S20).

Предшественник: S15.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H19, M30, H20, H32
- subscription_groups_insert_teacher / _delete_teacher
- single_visits_insert_admin / _update_admin / SELECT teacher
- RPC record_single_visit, teacher_can_write_subscriptions

Делай строго по шагам:

1. subscription_groups teacher INSERT/DELETE: teacher_can_write_subscriptions() (как subscriptions_insert_teacher). Иначе 403.
2. single_visits admin write: читать admin_can_record_single_visits (как RPC). Лучше REVOKE write + только record_single_visit.
3. Teacher SELECT single_visits: view без amount/method/price_id или только свои teacher_member_id без сумм. Финансовые роли — полная строка (H32 / R4).
   ОБЯЗАТЕЛЬНО в том же прогоне: useSingleVisits (`SINGLE_VISITS_SELECT` = id… amount, method, price_id) читает AttendancePanel (журнал teacher). DROP колонок / SELECT без правки хука = **ошибка журнала drop-in**, не «скрытые суммы». Для teacher не селектить amount/method/price_id (маппинг amount: 0 ок); client_display, дата, слот, discipline/location оставить. FinancePaymentsPage / FinancialDashboard — финансовые роли, полный select.
4. Бамп 2.8.y, changelog.

DoD: teacher без флага продажи не пишет subscription_groups. Admin при выключенном admin_can_record_single_visits не INSERT REST. Teacher GET amount/method → отказ или без сумм. Журнал AttendancePanel у teacher **показывает** drop-in (кто, дата, слот) без ошибки PostgREST. record_single_visit у тех, кому можно — работает. tsc зелёный.

Стоп. Не переходи к S17.
```

#### S17 — H24 + H25 + H28: мастер-классы, аренда серии, привязки тарифов

**Предшественник:** S16.  
**Закрывает:** H24, H25, H28.

```
Задача: S17 аудита безопасности CRM 2026-08-22. Вместе H24, H25, H28. Не чинить M38/M42 preview (S23), M40 целиком (S20).

Предшественник: S16.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H24, H25, H28
- SELECT calendar_events для teacher (income_amount, paid_amount)
- политики rental_series / renters / контакты write
- price_disciplines / price_teacher_members vs can_manage_prices()
- RPC create/cancel rental (арендаторы уже upsert_renter; привязки тарифа — REST usePrices, не RPC)

Делай строго по шагам:

1. Teacher не читает финансовые колонки calendar_events (view без сумм или RLS column/view как R4). Owner/director/accountant видят.
   ОБЯЗАТЕЛЬНО в том же прогоне: useCalendarEventsForWeek эмбедит calendar_events(payment_status, income_amount, paid_amount, currency, planned_guest_count, actual_guest_count) для **всех** ролей. DROP teacher SELECT / убрать колонки без правки хука = **ошибка PostgREST, пустая сетка мастер-классов** у teacher, не «скрытые суммы». Для teacher не селектить income_amount/paid_amount/payment_status (или читать masking view); title, event_type, guest_teacher, сессии — оставить. SELECT на calendar_event_sessions оставить.
2. REVOKE write на rental_series, арендаторов и контакты с authenticated; create/cancel/update только существующие RPC (H25). UI уже на upsert_renter / create_rental_series / create_rental — не переводить заново.
3. price_disciplines / price_teacher_members: политика write = can_manage_prices(), не can_write_all_business(). Reception не INSERT/DELETE. GRANT write **оставить** — usePrices синхронизирует junction REST-ом (syncPriceDisciplines / syncPriceTeacherMembers). Не требовать «только RPC тарифа».
4. Бамп 2.8.y, changelog.

DoD: teacher GET calendar_events?select=income_amount,paid_amount — отказ/пустые. Teacher-сетка недели **показывает** мастер-классы (название, время, зал) без сумм, без ошибки PostgREST. Admin DELETE rental_series REST → 403; UI-RPC аренды работают. Reception не пишет price_disciplines. Owner/director сохраняет привязки дисциплин/преподавателей тарифа в UI. tsc зелёный.

Стоп. Не переходи к S18.
```

#### S18 — H30 + M54 + M55 + M57: остатки обхода R4 (деньги teacher)

**Предшественник:** S17.  
**Закрывает:** H30, M54, M55, M57.

```
Задача: S18 аудита безопасности CRM 2026-08-22. Вместе H30, M54, M55, M57. Не чинить H7 карточки (S32), L15 каталог цен (S39).

Предшественник: S17.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H30, M54, M55, M57
- personal_lesson_charges_select_teacher
- usePersonalLessonChargeBalances / useScheduleDebtors / PayPersonalLessonModal
- teacher_settlement_line_items_select_own / get_teacher_settlement_detail
- teacher_pay_rules_select / list_teacher_pay_rules
- list_archived_prices

Делай строго по шагам:

1. Teacher REST dump billed_amount закрыть, но **сначала хуки**. usePersonalLessonChargeBalances селектит billed_amount и payments.amount. Callers: useScheduleDebtors (блок должников на **teacher**-сетке; UI сумму прячет через canShowScheduleDebtAmount, запрос — нет) и PayPersonalLessonModal.
   a) Teacher-должники: список по personal_lessons_teacher_v paid='no' (или без billed_amount); remaining без показа суммы. Не throw на сетке.
   b) PayPersonalLessonModal / teacher cashier: сумма из тарифа (usePrices / list_archived_prices) или узкий RPC remaining по уроку, который teacher оплачивает — не табличный dump всех charges. Модалка оплаты не должна падать.
   c) Потом teacher SELECT billed_amount запретить / view без суммы. Финансовым ролям — полные строки.
2. Teacher payroll self-service: без monetary_base и без ФИО в title (маска «занятие ДД.ММ»). Полные строки — can_read_financial().
3. teacher_pay_rules SELECT / list_teacher_pay_rules: только can_read_financial(). Teacher не видит value/формулу; итог settlement без ставки ок, если уже так в UI после шага 2.
4. list_archived_prices: teacher **не** получает sales_count. EXECUTE у authenticated **оставить** — useArchivedPrices в EditLessonPopup / PayPersonalLessonModal резолвит архивный тариф при оплате. Forbidden RPC ломает эти модалки. can_manage_prices / can_read_financial видят sales_count.
5. Бамп 2.8.y, changelog.

DoD: проверки H30, M54, M55, M57 из конца аудита проходят. Teacher-сетка: блок должников без ошибки (без сумм в UI). PayPersonalLessonModal / резолв архивного тарифа работают. tsc зелёный.

Стоп. Не переходи к S19.
```

#### S19 — M13 + M24 + M28 + M25: PII команды, заметки, hash инвайта

**Предшественник:** S18.  
**Закрывает:** M13, M24, M28, M25.

```
Задача: S19 аудита безопасности CRM 2026-08-22. Вместе M13, M24, M28, M25. Не чинить M41 (S24), H7 (S32).

Предшественник: S18.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M13, M24, M28, M25
- organization_members_select_active_org, useTeamMembers
- client_notes_*_operational / teacher
- organization_invites_select_team, GRANT, useTeamInvites

Делай строго по шагам:

1. В том же прогоне, до сужения SELECT: **два** пути чтения, не правка одного `useTeamMembers`.
   a) Roster view/RPC: `id`, `first_name`, `last_name`, `patronymic`, `display_name`, `role`, `is_active`, признак reception (`meta.restricted_admin` **или** отдельная колонка — `memberListLabel` иначе показывает «admin»). Без `user_id`, `scope`, `phone`, `telegram`, `profile_notes`, `contact_email`.
   b) `useTeamMembers` на roster: сетка, тарифы, персоналки, finance pages, AuditLogSection, DataExportPage (в CSV команды — ФИО, не телефоны), VenueCostsSettingsPage, RentalInfoPopup, `useClientNotes` (author label).
   c) Полный SELECT (PII + `user_id` + `scope` + `meta`) — новый хук, например `useTeamMembersFull`, **только** `TeamSettingsPage`. `MemberProfileModal` хук не зовёт: член приходит пропсом со страницы команды. Не сужать единственный хук — карточка сотрудника потеряет телефон/scope, либо roster снова утечёт PII.
2. SELECT полной строки organization_members (PII + user_id + scope): can_manage_team() или своя строка user_id = auth.uid() (OrganizationProvider уже фильтрует .eq("user_id", session.user.id)).
3. client_notes operational SELECT/UPDATE/DELETE: только author_member_id = auth_member_id() ИЛИ явный флаг «видны администрации», если продукт решает задокументировать админ-доступ — тогда флаг в settings + SQL, не скрытый REST. По умолчанию аудита: чужие заметки reception/admin не правит и не читает пачкой.
4. organization_invites: клиенту view/RPC списка без token_hash. REVOKE SELECT на базовую таблицу с hash или column privilege.
5. Бамп 2.8.y, changelog.

DoD: teacher не GET чужие phone/telegram/user_id команды. Расписание, персоналки, тарифы, финансы и audit UI по-прежнему показывают ФИО преподавателей. TeamSettingsPage / MemberProfileModal по-прежнему показывают телефон, telegram, scope. Reception в дропдауне не превращается в «admin». Reception не читает/не PATCH чужие client_notes. GET organization_invites?select=token_hash → пусто/403. Список инвайтов в UI без hash работает. tsc зелёный.

Стоп. Не переходи к S20.
```

#### S20 — M26 + M35 + M36 + M40: waitlist, справочники, флаг расписания admin

**Предшественник:** S19.  
**Закрывает:** M26, M35, M36, M40.

```
Задача: S20 аудита безопасности CRM 2026-08-22. Вместе M26, M35, M36, M40. Не чинить M59 (S26), H16 (уже S09).

Предшественник: S19.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M26, M35, M36, M40
- group_waitlist_entries_select / _write, group_spot_notifications_update
- RPC add_group_waitlist_entry / update_group_waitlist_status / dismiss_group_spot_notification
- classes_write_admin, locations_write_admin, class_teachers_write_admin, update_class_max_capacity
- admin_can_edit_schedule vs schedule_slots / personal_lessons / classes write

Делай строго по шагам:

1. Waitlist SELECT teacher: teacher_can_access_class / schedule_group_ids, не вся орг. Write REST REVOKE; мутации уже идут через add_group_waitlist_entry / update_group_waitlist_status — не ломай хуки. spot_notifications: клиент не PATCH client_id/waitlist_entry_id, только dismiss RPC. SELECT waitlist оставить (useGroupWaitlist читает таблицу).
2. classes: max_capacity только update_class_max_capacity (хук уже RPC). SPA **не** INSERT в classes: группа создаётся INSERT schedule_slots → DEFINER ensure_schedule_group. REVOKE INSERT на classes у authenticated сетку не ломает. SELECT classes оставить (useScheduleGroups).
3. locations: useLocations делает прямой insert/update/delete. НЕ отзывать write и НЕ требовать RPC в этом прогоне, пока хук не переведён. Можно WITH CHECK admin_can_edit_schedule / can_manage_settings на UPDATE/DELETE, но REST оставить.
4. Admin write слотов: admin_can_edit_schedule в SQL политик schedule_slots (как rental helper). Write REST слотов не убирать (S09).
5. Бамп 2.8.y, changelog.

DoD: teacher без группы не видит всю waitlist. REST PATCH waitlist → 403, RPC add/update работают. PATCH classes.max_capacity в обход RPC → 403. Добавление/правка зала в настройках работает. Admin при выключенном admin_can_edit_schedule не пишет слоты REST. tsc зелёный.

Стоп. Не переходи к S21.
```

#### S21 — M33: CSV без формул Excel

**Предшественник:** S20.  
**Закрывает:** M33.

```
Задача: S21 аудита безопасности CRM 2026-08-22. Только M33. Не чинить H8 экспорт как модель (S29), M51 Storage (S25).

Предшественник: S20.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M33
- tangodb/src/lib/exportCsv.ts escapeCsvCell
- call sites exportDashboardCsv / exportFinancialCsv / exportConductedLessonsCsv / exportRentalInvoiceDocument

Делай строго по шагам:

1. Если значение начинается с = + - @ или \t \r — префикс ' и всегда кавычки. Не только при наличии ; в ячейке.
2. Один хелпер на все перечисленные экспорты, не копипаста.
3. Бамп 2.8.y, changelog.

DoD: имя клиента =HYPERLINK(...) уходит в CSV как безопасная строка, не формула. tsc зелёный.

Стоп. Не переходи к S22.
```

#### S22 — M34 + M56 + M49: DEFINER сверяет орг; нет PUBLIC EXECUTE

**Предшественник:** S21.  
**Закрывает:** M34, M56, M49.

```
Задача: S22 аудита безопасности CRM 2026-08-22. Вместе M34, M56, M49. Не повторять H23/H31 (уже S02–S03). Не чинить apply_scheduled как вынос из queryFn продукта — только membership check.

Предшественник: S21.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M34 (таблица функций), M56, M49 и «Сверка документа» (S22 — не REVOKE RLS-хелперы)
- GRANT/REVOKE каждой функции из таблиц
- useApplyScheduledSubscriptionMemberChanges

Делай строго по шагам:

1. Для каждой функции таблицы M34 с аргументом орг/UUID сущности: внутри DEFINER p_org_id := auth_organization_id() (игнорировать клиентский) ИЛИ до чтения ФИО проверить organization_id = auth_organization_id(). Так закрывается IDOR, EXECUTE у authenticated для RLS сохраняется.
2. apply_scheduled_subscription_member_changes: игнорировать клиентский p_org_id, всегда JWT org. SPA-вызов своей орг остаётся. НЕ REVOKE EXECUTE у authenticated на эту функцию.
3. ЗАПРЕЩЕНО REVOKE EXECUTE FROM authenticated на функции, которые вызываются **из RLS-политик**: organization_allows_writes, organization_allows_reads, is_active_member, member_role, member_scope, auth_member_role, current_member_role, business_row_writable/readable и любые другие из USING/WITH CHECK. Это роняет весь CRM (permission denied при оценке политики).
4. Хелперы, которые RLS не вызывает и SPA не зовёт (organization_has_lifetime_license, organization_has_active_subscription, is_platform_developer, venue_cost_gap_is_acknowledged если только внутренний): можно REVOKE FROM authenticated, anon, PUBLIC — их зовут другие DEFINER от имени owner.
5. M49: REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon. **ЗАПРЕЩЕНО** REVOKE EXECUTE FROM authenticated коврово (нет «whitelist потом»): это убивает mark_attendance, record_*, write_off_personal_lesson_debt, get_personal_lesson_debt_trace, set_active_organization, create_group_subscription и RLS-хелперы. GRANT у authenticated на уже существующие SPA/RLS RPC **оставить**. Особо у anon: run_version_migration_*, execute_version_migration_script, is_platform_developer, teacher_member_has_future_lessons.
6. Бамп 2.8.y, changelog, lessons.md (DEFINER без membership = IDOR по UUID; REVOKE хелперов RLS = downtime).

DoD: subscription_client_display_for_date(чужой uuid) пусто/denied. organization_has_lifetime_license как RPC у JWT — denied или всегда своя орг. venue_cost_gap_is_acknowledged чужой org denied. has_function_privilege anon на run_version_migration_* = false. SELECT/INSERT своей орг (любая бизнес-таблица) не падает с permission denied for function organization_allows_*. Своя орг apply_scheduled работает. Списание долга персоналки (write_off) и журнал mark_attendance работают. tsc зелёный.

Стоп. Не переходи к S23.
```

#### S23 — M38 + M42 + M47 + M50: preview и occupancy без чужих ФИО/календарей

**Предшественник:** S22.  
**Закрывает:** M38, M42, M47, M50.

```
Задача: S23 аудита безопасности CRM 2026-08-22. Вместе M38, M42, M47, M50. Не чинить L11 freebusy (S39).

Предшественник: S22.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M38, M42, M47, M50
- preview_rental_conflicts, preview_calendar_event_conflicts
- get_rentals_for_schedule_week, get_schedule_calendar_sync_labels

Делай строго по шагам:

1. preview_rental_conflicts и preview_calendar_event_conflicts: accountant — kind/time без client_display. Teacher — только свои teacher_member_id или маска «занято» без ФИО; не все персоналки локации.
2. get_rentals_for_schedule_week: teacher только локации из scope / teachers_can_view_full_schedule для полного списка; иначе без чужих rental_id или пусто.
3. get_schedule_calendar_sync_labels: owner/director полный список; teacher только свои слоты/уроки, не calendar_name коллег.
4. Бамп 2.8.y, changelog.

DoD: проверки M38, M42, M47, M50 из конца аудита. tsc зелёный.

Стоп. Не переходи к S24.
```

#### S24 — M41 + M43 + M45 + M46 + M53: SELECT не всему member

**Предшественник:** S23.  
**Закрывает:** M41, M43, M45, M46, M53.

```
Задача: S24 аудита безопасности CRM 2026-08-22. Вместе M41, M43, M45, M46, M53. Не чинить M6 access_keys (S34), M29 audit_log (S35).

Предшественник: S23.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M41, M43, M45, M46, M53
- широкие политики is_active_member OR узкая teacher (OR не сужает)

Делай строго по шагам:

1. subscription_member_changes: убрать широкую политику всем member. SELECT can_read_operational() ИЛИ teacher_can_access_subscription. Accountant — can_read_financial() если нужен доступ.
2. organization_subscriptions и organization_licenses: **не** оставлять OrganizationProvider без данных. Сейчас queryFn throw на error; REVOKE SELECT → белый экран орг у teacher. Варианты: (а) политика member SELECT только license_type, activated_at, expires_at / plan, billing_period, status, current_period_* — без stripe_subscription_id и access_key_id; (б) узкий RPC бандла для isReadOnly. Полный Stripe id / access_key_id — только owner / can_manage_settings.
3. subscription_freeze_periods: убрать широкую OR-политику; operational или teacher_can_access_subscription.
4. organization_version_migrations: SELECT owner (и service_role/developer Edge), не teacher.
5. Бамп 2.8.y, changelog.

DoD: проверки M41, M46, M53 из конца аудита. Teacher/accountant входят в орг: isReadOnly при past_due по-прежнему считается (license_type + subscription.status доступны). Teacher не видит stripe_subscription_id / access_key_id. tsc зелёный.

Стоп. Не переходи к S25.
```

#### S25 — M48 + M51 + M52: Storage и ставки payroll не с клиента в обход RPC

**Предшественник:** S24.  
**Закрывает:** M48, M51, M52.

```
Задача: S25 аудита безопасности CRM 2026-08-22. Вместе M48, M51, M52. Не чинить L27 noopener (S39), H8 модель экспорта (S29).

Предшественник: S24.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M48, M51, M52
- политики storage renter-documents и exports
- prepare/finalize/delete_renter_document
- exportCsv upload
- teacher_pay_rates write vs save_teacher_pay_rule

Делай строго по шагам:

1. renter-documents: insert/delete Storage не для authenticated в обход RPC. Либо только service_role + signed URL из prepare_*; либо path = orgId/renterId/docId + EXISTS renter_documents. Листинг чужих файлов папки орг — не шире RPC.
2. exports: WITH CHECK can_export_data(); убрать application/octet-stream если возможно. Upload не обходит teachers_can_export / admin_can_export.
3. teacher_pay_rates: сначала MemberProfileModal / useUpsertTeacherPayRate перевести на save_teacher_pay_rule (хук уже есть в useTeacherPayRules). Потом REVOKE INSERT, UPDATE, DELETE ON teacher_pay_rates FROM authenticated. Не отзывать write, пока UI пишет таблицу напрямую. SELECT ставок для payroll preview можно оставить owner/director.
4. Бамп 2.8.y, changelog.

DoD: upload в renter-documents в обход prepare → 403; UI через RPC работает. Teacher с выключенным экспортом не upload в exports. Прямой PATCH teacher_pay_rates → 403. Сохранение ставки в карточке сотрудника через RPC работает. tsc зелёный.

Стоп. Не переходи к S26.
```

#### S26 — M59: закрытие группы считает явку из attendance

**Предшественник:** S25.  
**Закрывает:** M59.

```
Задача: S26 аудита безопасности CRM 2026-08-22. Только M59. Не чинить H14 повторно.

Предшественник: S25.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M59
- close_group_lesson_occurrence, post_venue_cost_for_closure, venue_cost_amount_for_lesson
- member_can_close_group_venue_occurrence

Делай строго по шагам:

1. p_confirmed_attendee_count не доверять: считать present из attendance этой даты/группы. Расхождение с клиентским count → error. Верхняя граница classes.max_capacity.
2. Не писать venue_cost_accruals от фейкового count. Повтор с другим count по-прежнему conflict, если строка уже есть.
3. Бамп 2.8.y, changelog.

DoD: close_group_lesson_occurrence с count ≠ present → error; совпадающий count — как UI. get_finance_costs не меняется от фейкового count. tsc зелёный.

Стоп. Не переходи к S27.
```

#### S27 — M31 + M32 + L10: auto-expose OFF, REVOKE у anon, явные GRANT

**Предшественник:** S26.  
**Закрывает:** M31, M32, L10.  
**Конец волны 1.**

```
Задача: S27 аудита безопасности CRM 2026-08-22. Вместе M31, M32, L10. Это ковровый GRANT после точечных REVOKE S05–S26. Не открыть обратно write, который уже сняли.

Предшественник: S26.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M31, M32, L10 и секцию production \\dp
- tangodb/supabase/config.toml [api] auto_expose_new_tables, schemas
- текущие GRANT в последних миграциях

Делай строго по шагам:

1. config.toml: auto_expose_new_tables = false. Чеклист Dashboard: Expose new tables = OFF (в ответе агента).
2. Миграция: REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon. Whitelist только таблиц, которым anon реально нужен (если таких нет — не возвращать GRANT).
3. authenticated: не возвращать INSERT/UPDATE/DELETE там, где S05–S26 сделали RPC-only (attendance, payments, rental money, payroll settlements, organization_members, organizations, waitlist write, teacher_pay_rates после перевода UI, personal_lessons UPDATE/DELETE).
4. Если делаешь ковровый REVOKE ALL у authenticated — **сначала** верни SELECT. `REVOKE ALL ON ALL TABLES IN SCHEMA public` снимает и **views**. Именованный список (не «и т.д.»), всё что SPA реально `.from()`:

   Таблицы: organizations, organization_settings, organization_licenses, organization_subscriptions, organization_members, organization_invites, clients, subscriptions, subscription_groups, subscription_member_changes, subscription_freeze_periods, subscription_refunds, attendance, schedule_slots, personal_lessons, prices, price_disciplines, price_teacher_members, locations, disciplines, classes, payments, expenses, client_notes, calendar_events, calendar_event_sessions, group_waitlist_entries, group_spot_notifications, other_income, audit_log, single_visits, personal_lesson_charges, teacher_settlements, teacher_settlement_payments, teacher_pay_rates, teacher_pay_rules (SELECT; write уже RPC/S25), rental_tariff_rules, schedule_occurrence_cancellations, lesson_occurrence_closures, member_google_calendar_bindings, organization_google_calendar_bindings, platform_payment_methods, renter_documents (**обязательно** SELECT: `bindUploadedRenterDocument` → `findRenterDocumentIdByPath` `.select("id")` по `storage_path`; без GRANT после сбоя finalize — орфан в Storage или ложный cleanup).

   Views: personal_lessons_teacher_v, subscriptions_teacher_v, financial_debtors_v, и любые другие tenant views, которые хуки читают (venue-cost views — проверить useVenueCosts: часть уже RPC).

   Без GRANT SELECT на masking views teacher теряет абонементы/уроки. Без calendar_events + sessions — сетка мастер-классов. Без GCal bindings — интеграция календаря. Без cancellations/closures — оценка аренды зала. Без financial_debtors_v — страница должников (имя view то же после 2.8.75). Без teacher_settlements / teacher_settlement_payments / teacher_pay_rates SELECT — payroll UI (`useTeacherSettlements`, `useSettlementPayments`, `useTeacherPayRates`); write settlements уже RPC после S10.
   SPA **не** `.from()` `renters` / `rentals` / `rental_invoices*` / `teacher_settlement_line_items` (RPC `list_renters`, `get_rentals_for_schedule_week`, `get_teacher_settlement_detail`). Не возвращать write на эти таблицы. SELECT line items не нужен SPA — не GRANT (закрывает REST dump **M54**). `subscription_groups`: только SELECT; INSERT в хуке — мёртвый rollback, живой путь `create_group_subscription`.
5. **Обязательный GRANT write** (SPA пишет таблицы напрямую):
   - subscriptions: INSERT (**не** DELETE — rollback мёртвый, H15)
   - personal_lessons: INSERT (**не** UPDATE/DELETE — RPC)
   - schedule_slots: INSERT, UPDATE, DELETE
   - locations: INSERT, UPDATE, DELETE
   - expenses: INSERT, UPDATE, DELETE
   - prices, price_disciplines, price_teacher_members: INSERT, UPDATE, DELETE
   - clients: INSERT, UPDATE (архив = UPDATE archived_at, не DELETE)
   - organization_settings: UPDATE (SettingsProvider)
   - disciplines: INSERT, UPDATE, DELETE (useDisciplines)
   - client_notes: INSERT, DELETE (useClientNotes)
6. Default privileges: ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM anon, authenticated; затем точечно как в шагах 3–5.
7. Сверить \\dp: у attendance/payments/rental invoices/members/organizations write у authenticated нет; у списка шага 5 — есть; SELECT у authenticated на читаемые таблицы есть.
8. Бамп 2.8.y, changelog, lessons.md (auto-expose ALL = REST write при любой дырявой политике).

DoD: чеклист Dashboard. Новая таблица без GRANT не получает ALL у anon/authenticated в локальном описании. Анон по-прежнему не читает tenant-строки. UI: продажа не-группы, сетка недели **включая мастер-классы**, залы, дисциплины, заметки клиентов, расходы, привязки тарифа, карточки клиентов, сохранение настроек, должники, GCal bindings, журнал отмен/closures, freeze/waitlist SELECT, история возвратов (`subscription_refunds`), зарплаты (список settlements/платежей/ставок), загрузка документа арендатора (lookup `renter_documents`) — работают. tsc зелёный.

Стоп. Волна 1 закрыта. Не переходи к S28.
```

---

### Волна 2 — сессия, увольнение, origin инвайта

#### S28 — H3 + M8: сессия не в localStorage по умолчанию; MFA/timebox

**Предшественник:** волна 1 (S12–S27) закрыта.  
**Закрывает:** H3, M8.

```
Задача: S28 аудита безопасности CRM 2026-08-22. Вместе H3 и M8. Не чинить H4 повторно, L9 recovery=JWT (S38).

Предшественник: S27.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H3, M8
- tangodb/src/lib/supabase.ts readRememberMePreference / authStorage
- UI Remember me на логине
- config.toml [auth.sessions] timebox, MFA/passkeys (что уже трогали в S12 — не откатывать)

Делай строго по шагам:

1. Default remember-me = false. `readRememberMePreference`: если ключа в localStorage нет — **false** (сейчас `stored === null ? true`). `LoginPage` чекбокс стартует с `getRememberMePreference()`. `AuthProvider.signInWithEmail(..., rememberMe = true)` — сменить дефолт аргумента на false, чтобы вызов без третьего аргумента не писал JWT в localStorage. Без галочки — sessionStorage. Галочка — явное согласие на localStorage.
2. Не строить BFF/httpOnly в этом прогоне, если это отдельный контур; default false + не класть JWT в localStorage без галочки достаточно для H3 в рамках аудита.
3. M8: включить session timebox в config (если S12 уже задал — проверить что не закомментирован). MFA/passkeys: включить в config.toml то, что поддерживает стек; чеклист Dashboard «MFA optional/required для owner». Не блокировать всех пользователей обязательным MFA без продуктового решения — хотя бы включить возможность и timebox.
4. Бамп 2.8.y, changelog, lessons.md (Remember me default true + нет CSP).

DoD: чистый логин без галочки не пишет refresh в localStorage. Timebox описан в config/чеклисте. tsc зелёный.

Стоп. Не переходи к S29.
```

#### S29 — H8 + M11: revoke сессии при deactivate; JWT орг не живёт «просто так»

**Предшественник:** S28.  
**Закрывает:** H8 (сессионная часть), M11.

```
Задача: S29 аудита безопасности CRM 2026-08-22. H8 — не «запретить SELECT» (это свойство SPA), а revoke при deactivate + не оставлять офлайн как единственную дыру (офлайн снимок — S35). M11 — refresh после смены роли/орг и logout при deactivate.

Предшественник: S28.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H8, M11
- RPC/хук deactivate member, update_team_member is_active
- custom_access_token_hook, jwt_expiry
- signOut / ban / revoke refresh в Edge или Auth admin

Делай строго по шагам:

1. При is_active=false / удалении членства: отозвать refresh-сессии пользователя для этого контекста (Auth admin signOut/global или documented revoke). Не оставлять уволенного с живым refresh.
2. После смены роли/орг на сервере: клиент refreshSession (уже может быть claimsMismatch — не ломать). Не полагаться на час jwt_expiry с старым organization_id в политиках, которые смотрят только claim: такие политики в этом прогоне найти и добавить is_active_member.
3. Не строить DLP/watermark PostgREST. Не отключать CSV UI, если флаг экспорта включён.
4. Бамп 2.8.y, changelog.

DoD: deactivate member → последующий REST с старым refresh не проходит (или refresh revoked). Политики не живут час на одном organization_id без is_active_member. tsc зелёный.

Стоп. Не переходи к S30.
```

#### S30 — M15 + M39 + M58: origin сброса/инвайта и токен не в query/storage

**Предшественник:** S29.  
**Закрывает:** M15, M39, M58.

```
Задача: S30 аудита безопасности CRM 2026-08-22. Вместе M15, M39, M58. Не чинить C1 повторно (S01). Не ломать AcceptInvitePage после S01.

Предшественник: S29.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M15, M39, M58
- getSiteUrl / resetPasswordForEmail redirectTo
- invite-member SITE_URL fallback vercel.app
- create-subscription-checkout success/cancel URL
- AcceptInvitePage sessionStorage tangodb_pending_invite_token и searchParams token

Делай строго по шагам:

1. resetPasswordForEmail redirectTo только из VITE_SITE_URL (прод), не window.location.origin как источник истины. Чеклист Auth allowlist = этот origin, без preview *.vercel.app.
2. Edge invite-member и create-subscription-checkout: без SITE_URL в production → 500, не fallback https://tangodb.vercel.app. Origin тот же, что ALLOWED_ORIGINS.
3. Токен инвайта: не класть в sessionStorage; не оставлять plaintext в query после чтения (replaceState). Предпочтительно POST body после логина; если ссылка из письма с query неизбежна — сразу убрать из URL и не писать в storage. Fragment #token= допустим как промежуточный шаг (не уходит в Referer).
4. Бамп 2.8.y, changelog.

DoD: без SITE_URL Edge не шлёт инвайт/checkout на vercel.app. После логина token нет в sessionStorage; query очищен. Сброс пароля не берёт origin с фишингового хоста, если VITE_SITE_URL задан. tsc зелёный.

Стоп. Не переходи к S31.
```

#### S31 — M17: recovery-код владельца не в JSON и не в history.state

**Предшественник:** S30.  
**Закрывает:** M17.  
**Конец волны 2.**

```
Задача: S31 аудита безопасности CRM 2026-08-22. Только M17. Dev Console transfer-owner по коду должен остаться возможным другим каналом (письмо / одноразовый показ без state).

Предшественник: S30.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M17
- create-self-service-demo-org ответ recovery_code
- RegisterPage navigate state recoveryCode
- RecoveryCodeModal / онбординг

Делай строго по шагам:

1. Не возвращать recovery_code в JSON клиенту после того, как его уже показали, и не тащить в history.state / location.state.
2. Показать код один раз на экране из ответа, затем забыть в памяти компонента; предпочтительно дублировать только письмом. Не класть в sessionStorage/localStorage.
3. Dev Console по-прежнему принимает код, если пользователь его сохранил с экрана/письма.
4. Бамп 2.8.y, changelog.

DoD: Register/onboarding не пишет recoveryCode в history.state. Ответ API не светит код в последующих запросах. tsc зелёный.

Стоп. Волна 2 закрыта. Не переходи к S32.
```

---

### Волна 3 — PII teacher, views, GraphQL, офлайн, audit

#### S32 — H7: преподаватель не читает телефон/email/опекунов через REST

**Предшественник:** волна 2 (S28–S31) закрыта.  
**Закрывает:** H7.

```
Задача: S32 аудита безопасности CRM 2026-08-22. Только H7. Write клиентов уже S15. Не чинить L15 prices, H24/H30/H32 повторно.

Предшественник: S31.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md H7
- clients_select_teacher
- паттерн subscriptions_teacher_v / R4
- хуки useClients для роли teacher

Делай строго по шагам:

1. View clients_teacher_v без phone, telegram, email, guardian PII (и прочих чувствительных полей из пункта H7). Имена (first_name, last_name) и id **оставить** — журнал и абонементы без них мертвы.
2. Сначала перевести useClients / useClientDirectory для role===teacher на view (как subscriptions_teacher_v в useSubscriptions). Потом DROP/запретить SELECT teacher на базовую clients. Если сделать DROP раньше хука — teacher не загрузит клиентов.
3. Финансовые роли / operational — как сейчас по политикам, не расширять teacher.
4. Бамп 2.8.y, changelog, lessons.md (R4 на финансы ≠ маскирование PII contacts).

DoD: teacher GET /clients?select=phone,telegram,email → отказ или нет колонок. Журнал, расписание и список абонементов teacher показывают ФИО клиентов. tsc зелёный.

Стоп. Не переходи к S33.
```

#### S33 — M21: оставшиеся org-флаги §9 в SQL

**Предшественник:** S32.  
**Закрывает:** M21 (то, что ещё не закрыли S07, S08, S09, S15, S16, S20).

```
Задача: S33 аудита безопасности CRM 2026-08-22. Только оставшиеся флаги M21. Сначала инвентаризация: что уже читается в SQL после S01–S32, что нет.

Предшественник: S32.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M21
- 20260704000001_v2_rbac_org_setting_overrides.sql
- grep колонок teachers_can_* admin_can_* в migrations vs permissions.ts

Делай строго по шагам:

1. Список колонок §9: для каждой — где UI, где SQL. Не дублируй уже закрытое (teachers_can_edit_clients, sell subscriptions, attendance director, admin_can_edit_schedule, restricted_admin, record_single_visits, accept_payments если уже в RPC+RLS).
2. В SQL: teachers_can_sell_personal_lessons (если S09 не закрыл полностью), teachers_can_view_full_schedule (get_rentals и соседние RPC, если S23 не закрыл), admin_can_manage_team (вместе с NOT is_restricted_admin в can_manage_team).
3. Helper на каждый оставшийся флаг + политики/RPC, как RBAC-3 для subscriptions. Не оставлять «только permissions.ts».
4. Бамп 2.8.y, changelog.

DoD: выключенный в настройках флаг из списка шага 2 даёт 403/error на API, не только скрытую кнопку. tsc зелёный. Если все флаги уже закрыты предыдущими S* — напиши таблицу «уже закрыто» и не выдумывай миграцию.

Стоп. Не переходи к S34.
```

#### S34 — M5 + M6 + M7: invoker views, access_keys, GraphQL

**Предшественник:** S33.  
**Закрывает:** M5, M6, M7.

```
Задача: S34 аудита безопасности CRM 2026-08-22. Вместе M5, M6, M7.

Предшественник: S33.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M5, M6, M7
- CREATE VIEW ... security_invoker = false
- GRANT SELECT ON access_keys
- config.toml [api] schemas graphql_public

Делай строго по шагам:

1. Masking views преподавателя (subscriptions_teacher_v, personal_lessons_teacher_v) и другие, где teacher **не** имеет SELECT на base: **оставить security_invoker = false**. Invoker=true после S09 = teacher не читает view → нет абонементов/уроков в UI.
   **financial_debtors_v** тоже оставить security_invoker = false: джойнит clients/payments/charges/personal_lessons; useFinancialDebtors на FinancialDashboard / FinanceDebtorsPage / DataExportPage / FinanceMonthExportButton. Invoker=true после S09 ломает список дебиторов, если у accountant нет SELECT на все base (и teacher GRANT на view при invoker=true даёт ошибку, не пустой WHERE). 2.8.75 переписал агрегаты внутри view — имя то же.
   View, у которых вызывающая роль уже имеет SELECT на **все** базовые таблицы (часть venue-cost): можно WITH (security_invoker = true) на PG15+. WHERE-фильтры не ослаблять.
2. REVOKE SELECT ON access_keys FROM authenticated, anon. Только service_role. UI активации ключа не должен читать таблицу — только RPC activate.
3. Убрать graphql_public из api.schemas, если в tangodb/ нет клиентов GraphQL (поиск graphql). Не оставлять второй контур «на будущее».
4. Бамп 2.8.y, changelog.

DoD: access_keys не SELECT у JWT member. GraphQL схема не в API. Teacher по-прежнему читает subscriptions_teacher_v / personal_lessons_teacher_v. Accountant FinanceDebtorsPage загружает financial_debtors_v без ошибки PostgREST. tsc зелёный.

Стоп. Не переходи к S35.
```

#### S35 — M12 + M23 + M29: офлайн PII, expenses+период, audit без полных снимков director

**Предшественник:** S34.  
**Закрывает:** M12, M23, M29.

```
Задача: S35 аудита безопасности CRM 2026-08-22. Вместе M12, M23, M29. Не чинить H8 «инсайдер всегда может SELECT».

Предшественник: S34.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M12, M23, M29
- IndexedDB tangodb-offline, useOfflineSecurityReset
- expenses_insert/_update/_delete
- audit_log_select_leadership, колонки old_data/new_data

Делай строго по шагам:

1. Офлайн: не хранить полный PII снимок дольше необходимого; шифрование ключом сессии или урезать поля (без phone/email) + чистить при hide/logout/смене орг (уже частично есть). Не оставлять −3…+7 клиентов на диске общего Windows без защиты. Минимально: не писать phone/telegram/email в IndexedDB.
2. expenses: в политиках write — NOT _is_finance_period_closed(organization_id, expense_date). НЕ REVOKE INSERT/DELETE в этом прогоне: useExpenses пишет таблицу напрямую. RPC расходов нет. Согласовать порог с H29 (приём денег), не выкидывать UI расходов.
3. audit_log: director не SELECT old_data/new_data пачкой (view без снимков или RPC с усечением). Owner может оставить полный trail, если продукт так хочет — тогда только owner, не director. Не расширять SELECT teacher.
4. Бамп 2.8.y, changelog.

DoD: офлайн-запись без контактов клиентов. PATCH expenses в закрытом периоде → 403/error. Добавление расхода в открытом периоде через UI работает. Director GET audit_log old_data → пусто/403. tsc зелёный.

Стоп. Не переходи к S36.
```

#### S36 — M1: остаток «UI-гейт ≠ API»

**Предшественник:** S35.  
**Закрывает:** M1.  
**Конец волны 3.**

```
Задача: S36 аудита безопасности CRM 2026-08-22. Только остаток M1 после S01–S35. Не начинай новые контуры «на всякий случай».

Предшественник: S35.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M1 (список fail-open)
- PanelAccessRoute, permissions.ts, OrganizationProvider.isReadOnly
- modules в organization_settings vs RLS can_read_financial / can_read_operational

Делай строго по шагам:

1. Инвентаризация: какие пункты M1 ещё воспроизводятся прямым REST/RPC. Закрытые S* вычеркни.
2. Оставшееся: либо SQL (модуль finance_basic не даёт REST, если роли нет — не ломать accountant), либо явная запись в architecture/lessons «модуль — UI, роль — API» если это осознанно. Не оставлять скрытый пункт меню как единственную защиту денег.
3. teachers_can_export / can_export_data: если S25 не привязал Storage, добить здесь. Табличный REST экспорт не существует — не выдумывай.
4. Бамп 2.8.y только если был код. Если только документация — changelog без версии приложения, запись в lessons.md.
5. Не чинить H1.

DoD: таблица «M1 пункт → закрыт Sxx / осознанно UI-only» в ответе агента. Нет нового fail-open, который аудит уже назвал. tsc зелёный если менялся код.

Стоп. Волна 3 закрыта. Не переходи к S37.
```

---

### Волна 4 — гигиена Edge, enumeration, низкие

#### S37 — M4 + M9 + M10 + M14 + M18: публичные функции, signup, ошибки, waitlist org

**Предшественник:** волна 3 (S32–S36) закрыта.  
**Закрывает:** M4, M9, M10, M14, M18.

```
Задача: S37 аудита безопасности CRM 2026-08-22. Вместе M4, M9, M10, M14, M18. Не ослаблять S01 (preview/complete без JWT могут остаться публичными, но с durable limit из S13).

Предшественник: S36.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md M4, M9, M10, M14, M18
- config.toml verify_jwt у функций
- RegisterPage vs AuthProvider.signUpWithEmail vs GoTrue captcha
- ErrorBoundary, parseAuthError
- submit-subscription-waitlist organization_id

Делай строго по шагам:

1. M4: не включать verify_jwt=true на complete-invite, если accept без сессии для нового пользователя ещё нужен. Cron оставить секретом. landing-track-event: Turnstile или отбрасывать на edge; не бесконечный insert. Список функций с verify_jwt=false — комментарий «почему публичная» у каждой.
2. M9: signup через AuthProvider тоже должен требовать captcha/challenge, не только RegisterPage. Либо Dashboard GoTrue captcha (чеклист), либо тот же verify-self-service до signUp на всех путях.
3. M10: ErrorBoundary и parseAuthError не показывают сырой Postgres/PostgREST/GoTrue message пользователю; стабильные i18n коды. Лог полный — в reportClientError/Sentry.
4. M14: одинаковый ответ на signup / request-demo-key / demo already used (не «User already registered» / не «Demo already used for this email» отдельно). Rate limit уже S13.
5. M18: submit-subscription-waitlist пишет organization_id только если caller — активный member этой орг; иначе NULL.
6. Бамп 2.8.y, changelog.

DoD: неизвестный auth error не светит текст API. Waitlist с чужим org id не привязывается. Signup в обход RegisterPage не минует captcha, если включили серверный путь. tsc зелёный.

Стоп. Не переходи к S38.
```

#### S38 — L2 + L3 + L4 + L5 + L9 + L12 + L17 + L19 + L20: Edge и Auth гигиена

**Предшественник:** S37.  
**Закрывает:** L2, L3, L4, L5, L9, L12, L17, L19, L20.

```
Задача: S38 аудита безопасности CRM 2026-08-22. Низкие Edge/Auth из заголовка. Не чинить L1 email в git как секрет (S40).

Предшественник: S37.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md L2, L3, L4, L5, L9, L12, L17, L19, L20
- .env.example ACTIVATION_DEBUG
- index.html telegram-web-app.js
- google-calendar-webhook channel_id compare
- cors / verifyCronSecret
- ResetPasswordPage PASSWORD_RECOVERY
- ALLOWED_ORIGINS, extra_search_path, refresh_token_reuse_interval
- devAuth.ts platformRoleFromJwt atob

Делай строго по шагам:

1. L2: ACTIVATION_DEBUG в .env.example = false / выключен; в production не светить SQL debug.
2. L3: SRI или self-host Telegram script; CSP из S14 обновить.
3. L4: webhook сравнивает channel_token/resource_id, не channel_id с самим собой как единственную проверку.
4. L5: убрать x-cron-secret из CORS Allow-Headers если браузеру не нужен; сравнение секрета constant-time; не принимать секрет в Authorization рядом с Bearer JWT.
5. L9: ResetPasswordPage проверяет событие PASSWORD_RECOVERY; не полноценный CRM-shell со старым паролем. По возможности ограничить recovery-сессию сменой пароля.
6. L12: пустой ALLOWED_ORIGINS в production — явный отказ деплоя/health, не 500 на каждый вызов без понятного алерта. Требовать непустой список.
7. L17: убрать fallback JSON.parse JWT без verify; только user.app_metadata после getUser.
8. L19: refresh_token_reuse_interval не 10s в config, который копируют в prod; значение как в Dashboard чеклисте.
9. L20: extra_search_path = ["public"] без extensions; DEFINER с SET search_path как defense-in-depth.
10. Бамп 2.8.y, changelog.

DoD: пункты L2–L5, L9, L12, L17, L19, L20 закрыты по тексту аудита. tsc зелёный.

Стоп. Не переходи к S39.
```

#### S39 — L11 + L15 + L18 + L21 + L22 + L24 + L26 + L27 + L28: узкие SELECT и leftover v1

**Предшественник:** S38.  
**Закрывает:** L11, L15, L18, L21, L22, L24, L26, L27, L28.

```
Задача: S39 аудита безопасности CRM 2026-08-22. Низкие SELECT/legacy/tabnabbing.

Предшественник: S38.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md L11, L15, L18, L21, L22, L24, L26, L27, L28
- google-calendar-freebusy
- prices_select teacher
- organization_settings_select_member
- GCal last_error политики / get_personal_lesson_google_sync_status
- platform_payment_methods SELECT
- allowed_users, is_allowed_teacher, auth_telegram_id
- RenterDetailPanel window.open
- get_venue_cost_rule_status vs list_venue_cost_rule_versions

Делай строго по шагам:

1. L11: freebusy не любому member; роли, которые ставят уроки (owner/director/teacher с schedule), не accountant «просто так».
2. L15: teacher не читает полный каталог prices всех дисциплин — либо scope, либо оставить как продуктовую необходимость и тогда явно задокументировать в ответе и не менять. Если сужаешь — не сломай продажу в своей дисциплине.
3. L18: не отрезать member SELECT полей, без которых падает SPA. OrganizationProvider сейчас `.select("*")` с organization_settings — **ЗАПРЕЩЕНО** снимать GRANT с отдельных колонок (`finance_period_closed_until` и т.д.), пока хук на звёздочке: PostgREST откажет весь запрос → белый экран орг у teacher. Либо в том же прогоне заменить на явный список колонок, либо не трогать column privileges. Если явный список — **все** поля `mapSettings`: locale, currency_code, currency_display, timezone, week_starts_on, org_preset, terminology, modules, freeze_max_count, freeze_min_lessons, freeze_enabled, low_balance_threshold, teachers_can_*, directors_can_mark_attendance, admin_can_*, pair_cycle_enabled, branding_name. Можно убрать у teacher: finance_period_closed_until, branding_logo_url — **только** если хук больше не делает select("*"). Полный JSON настроек — can_manage_settings. Если убрать teachers_can_* / directors_can_* у teacher — кнопки продажи/журнала разъедутся с SQL (director mark attendance молча станет true).
4. L21/L24: текст last_error GCal не светить teacher (RPC get_personal_lesson_google_sync_status / попапы LessonInfoPopup и EditLessonPopup). На bindings колонки last_error **нет** — не выдумывать column-REVOKE. Хуки bindings селектят last_error_code и last_error_at; IntegrationsSettingsPage / OrgEventsGoogleSyncSection показывают last_error_code — **не** column-REVOKE этих двух. Текст длинной ошибки — google_calendar_event_links.last_error (director REST, L21) и поле RPC урока (L24).
5. L22: SELECT config на platform_payment_methods **оставить** authenticated — App.tsx, LicenseSettingsPage, ManualPurchasePanel (usePlatformPaymentConfig). Не USING (false) и не REVOKE SELECT. UPDATE уже service_role после S04. Если сужаешь политику — узкий RPC, который SPA читает вместо таблицы, в том же прогоне.
6. L26: DROP TABLE allowed_users CASCADE; DROP FUNCTION is_allowed_teacher(), auth_telegram_id(); убрать копирование telegram_id из JWT hook, если Mini App login мёртв.
7. L27: window.open(url, "_blank", "noopener,noreferrer") в RenterDetailPanel.
8. L28: **не** сажать get_venue_cost_rule_status на can_read_financial() / ту же роль, что list_venue_cost_rule_versions. checkVenueRuleBeforePayment → fetchQuery(fetchVenueCostRuleStatus) **throw** из useRecordSubscriptionPayment, useRecordPersonalLessonPayment, useRecordSingleVisit — reception и teacher не принимают оплату. EXECUTE оставить ролям кассы (can_write_reception, teacher с продажей, admin, can_read_financial). Intel L28: DashboardShell / teacher не показывать VenueRuleExpiryNotice (не звать status query для teacher, либо игнорировать error без throw в кассе). list_venue_cost_rule_versions по-прежнему financial.
9. Бамп 2.8.y, changelog.

DoD: is_allowed_teacher нет или всегда false; нет политик USING (is_allowed_teacher()). Download документа — opener null. Teacher **дашборд** без VenueRuleExpiryNotice (intel). Reception/teacher record_subscription_payment / record_personal_lesson_payment / record_single_visit **не throw** на get_venue_cost_rule_status. list_venue_cost_rule_versions по-прежнему financial. Teacher/accountant по-прежнему грузят locale, modules, teachers_can_*, directors_can_mark_attendance, org_preset, terminology, branding_name (орг открывается, кнопки роли и бренд на месте). Страница лицензии / ManualPurchasePanel по-прежнему показывает реквизиты оплаты (SELECT config или RPC). Интеграции GCal открываются (bindings select last_error_code/at не падает). Teacher-попап урока после фикса не показывает сырой last_error коллеги (L24). tsc зелёный.

Стоп. Не переходи к S40.
```

#### S40 — L1 + L6 + L7 + L8 + L13 + L14 + L16 + L25: информационный остаток

**Предшественник:** S39.  
**Закрывает:** L1, L6, L7, L8, L13, L14, L16, L25.  
**Конец волны 4. Конец очереди S01–S40.**

```
Задача: S40 аудита безопасности CRM 2026-08-22. Последний промпт. Информационные низкие. Не открывать заново C1/H*.

Предшественник: S39.

Прочитай сначала:
- .cursor/docs/ai/crm_security_audit_2026-08-22.md L1, L6, L7, L8, L13, L14, L16, L25
- submit-purchase-request DEFAULT_DEVELOPER_EMAIL
- crm_product_versions SELECT
- isDeveloper email allowlist (не ломать Dev Console)
- landing-track-event 200 на rate limit
- audit_log leadership (если S35 уже урезал director — не дублировать)
- config.toml [realtime]

Делай строго по шагам:

1. L1: email разработчика из исходника функции — в секрет/env, не хардкод в репозитории.
2. L6: crm_product_versions не USING (true) всем authenticated, если это внутренние коды; SELECT узким ролям / публичный лендинг версий — как продукт. Не дать обратно write из H33.
3. L7: ничего не «шифровать» в SPA. В ответе агента коротко: клиент скачивается, это норма; секреты не в бандле. Без кода, если нечего чинить.
4. L8: не убирать allowlist Dev Console. Проверить, что temporary_password reset-owner не светится в CRM SPA (только Edge console). Если JSON пароля в console — не расширять; задокументировать риск платформы.
5. L13: landing-track-event при лимите — 429, не 200 ok:true (если не ломает аналитику; предпочтителен честный 429).
6. L14: не закрывать как баг (штат developer). Запись в ответе: «не чинить».
7. L16: если S35 закрыл — пропустить. Иначе не расширять audit SELECT.
8. L25: Realtime: если SPA не подписан — выключить в config или оставить с комментарием. Не включать publication лишних таблиц.
9. Бамп 2.8.y только при коде. changelog. Финальный ответ: таблица S01–S40 все закрыты / этот прогон закрыл S40.

DoD: хардкода omowdance@gmail.com в функции нет (env). Очередь промптов исчерпана. tsc зелёный если был код.

Стоп. Не начинай S01 заново и не выдумывай S41.
```



