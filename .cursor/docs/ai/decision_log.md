# Decision Log

Архитектурные решения и обоснование выбора.

## Формат записи

- **Дата:** YYYY-MM-DD
- **Решение:** что выбрали
- **Контекст:** какая была задача
- **Альтернативы:** что рассматривали
- **Почему так:** итоговое обоснование

## Записи

### HALL-RENT-17 — Первичка и фискальные реквизиты (2026-08-03)

- **Дата:** 2026-08-03
- **Решение:** Минимальный контур без заявления юридического compliance: `rental_billing_profile` (JSONB) с режимами `off | crm | export`. **CRM** — нумерация счетов, версии при перевыдаче, НДС (none/included/on_top), строки из `rental_invoice_lines`, просмотр и CSV-экспорт. **Export** — пакет через `export_rental_invoice_documents` с `export_batch_id`. Фискализация опциональна (`fiscal_tracking_enabled`): статус, номер внешнего чека, касса, терминал, acquiring ID, возвратный чек через `update_rental_payment_fiscal`. Чтение профиля — `finance.read` или кассовый gate; запись — owner/director/accountant (`member_can_manage_venue_cost_rules` + `finance.read`).
- **Контекст:** Этап 17 аудита (F24, F25): счёт без печатного/налогового контура; нет фиксации внешней ККТ.
- **Альтернативы:** (1) Полноценный PDF/УПД в CRM; (2) Интеграция с конкретной ККТ API.
- **Почему так:** Прослеживаемый документ или однозначный export-пакет при минимальном scope; фискальные поля — ручная фиксация внешней системы, не притворство онлайн-ОФД.

### HALL-RENT-14 — Fixed-period по локациям и архив тарифов (2026-08-03)

- **Дата:** 2026-08-03
- **Решение:** Fixed-period venue cost: опциональный массив `rules.locations[]` с `{ location_id, amount }`; без массива — прежняя org-wide семантика (`amount`). Начисления `fixed_period` пишутся с `venue_cost_accruals.location_id`. Тарифы арендаторов: UI статуса active/archived (только `canWriteTariffs`), фильтры и группировка в настройках; `CreateRentalDialog` / серии — только `status: active`.
- **Контекст:** Этап 14 аудита (F1, F8): сеть студий не могла задать разные суммы по залам; архивные тарифы смешивались с активными.
- **Альтернативы:** (1) Отдельная таблица fixed-period rates; (2) Hard-delete старых тарифов вместо архива.
- **Почему так:** JSONB `locations` обратно совместим; `location_id` на accrual даёт отчётность; архив через существующий `status` без ломки исторических `tariff_id` на бронях.

### HALL-RENT-13 — Тариф → сумма при создании; hourly в разовой (2026-08-03)

- **Дата:** 2026-08-03
- **Решение:** **Вариант B** для почасового тарифа: в разовой брони (`CreateRentalDialog`) только fixed-тарифы + ручная сумма; подсказка «почасовой — только для серий». Автоподстановка суммы из fixed-тарифа; сумма/тариф/начальный платёж для ролей с `canSeeRentalTariffPrices` / `rentals.payments.write` (канонический кассовый gate, не голый `finance.read`). Backend: `create_rental` — ручной `fixed_amount` без `tariff_id` и `initial_payment > 0` через `member_can_record_rental_payment()`; override суммы при `tariff_id` с полем `amount_override_reason`; RPC `preview_rental_pricing` для сверки. Reception — без расширения (этап 12).
- **Контекст:** Этап 13 аудита hall-rent (F7, F14, F15): кассир бронировал с суммой 0; fixed-тариф не подставлял цену.
- **Альтернативы:** (A) Hourly в разовой с превью по длительности/льготам — больше UI и дублирование серверного `_calculate_rental_pricing`.
- **Почему так:** Серии уже покрывают hourly; меньше риска расхождения расчёта; разовая форма остаётся простой; кассовый gate единый с этапами 1/12.

### HALL-RENT-12 — Read-only прайс для admin и политика reception (2026-08-03)

- **Дата:** 2026-08-03
- **Решение:** Точка входа lookup — `/settings/hall-rent` (только блок тарифов, без venue cost). Цены в `list_rental_tariffs` через `member_can_see_rental_tariff_prices()` = `can_read_financial() OR member_can_record_rental_payment()` (тот же gate, что этап 1/13). UI: `canSeeRentalTariffPrices` на фронте; read-only баннер в `RentalTariffsSettingsPage`; ссылка из `CreateRentalDialog` / `RentalInfoPopup`. `canAccessPanel("settings")` и route guard для section-level доступа admin без `settings.manage`. **Reception (`restricted_admin`):** явный запрет — нет `schedule.write`, нет `rentals.payments.write`, нет lookup тарифов, нет settings; эскалация к admin/director (текст в i18n). Этап 13 расширит create/сумму по тому же price-gate.
- **Контекст:** Этап 12 аудита hall-rent: operational admin не видел прайс; reception не должен молча наследовать кассовые права этапа 1.
- **Альтернативы:** (1) Lookup только в модалке брони без settings; (2) Расширить reception до оплаты/прайса аренды.
- **Почему так:** Settings — естественный справочник; один SQL/UI gate с кассой; reception остаётся вне контура аренды до отдельного продуктового решения.

### HALL-RENT-9 — operation_date и закрытие кассового периода (2026-08-03)

- **Дата:** 2026-08-03
- **Решение:** Колонка `operation_date DATE NOT NULL` на rental money tables (backfill из `created_at` в org TZ через `_org_local_date`). `finance_period_closed_until` в `organization_settings` — inclusive последний закрытый календарный день; прямой `record_rental_payment` блокируется для дат ≤ closed_until; коррекции (сторно/замена) — с `operation_date = org today` и `member_can_correct_payments()`. Регистр и отчёты фильтруют по `operation_date`; `created_at` сохраняется для аудита ввода.
- **Контекст:** Этап 9 аудита F22: кассовый день ≠ момент записи в CRM.
- **Альтернативы:** (1) Отдельная ledger-таблица дат; (2) Закрытие периода только на UI без backend gate.
- **Почему так:** Минимальная миграция на существующий регистр этапа 5; единый helper TZ; closed period на write-path.

### HALL-RENT-7 — Read/manage настроек аренды для бухгалтера (2026-08-03)

- **Дата:** 2026-08-03
- **Решение:** Разведены read/write настроек аренды на UI и RPC. Бухгалтер: read тарифов с ценами (`list_rental_tariffs` + RLS: `manage_rentals OR can_read_financial`); manage venue cost (`member_can_manage_venue_cost_rules` = owner/director/accountant) без `schedule.write`. Write тарифов — по-прежнему `manage_rentals AND finance.read`. `canAccessSettingsSection("hall-rent")` = `finance.read OR schedule.write` (путь для admin lookup этапа 12 не сужен).
- **Контекст:** Этап 7 аудита hall-rent: accountant не видел тарифы и не мог принять venue cost draft.
- **Альтернативы:** (1) Отдельное permission `venue_costs.manage`; (2) Полный `schedule.write` для accountant.
- **Почему так:** Минимальный scope; write тарифов — отдельное продуктовое решение; admin lookup — этап 12.

### HALL-RENT-6 — Правка суммы брони с аудитом (2026-08-02)

- **Дата:** 2026-08-02
- **Решение:** UI правки суммы через `apply_rental_pricing_adjustment` (аудит в `rental_pricing_adjustments`), gate `member_can_adjust_rental_amount()` = `member_can_record_rental_payment()`. Accountant без `manage_rentals` — тот же узкий RPC (путь через `finance.read`). `update_rental.fixed_amount` — для прочих полей брони; gate суммы выровнен; восстановлена запись `fixed_amount` в UPDATE (регресс renters_crm).
- **Контекст:** Этап 6 аудита F29: бронь с суммой 0, кассир не проходил `can_read_financial()`; хук `useApplyRentalPricingAdjustment` вызывал неверный параметр RPC.
- **Альтернативы:** (1) Только `update_rental` без reason/audit; (2) Эскалация accountant к admin в UI без RPC.
- **Почему так:** Существующая таблица аудита + единый кассовый gate; hard block `new < paid` до сторно (этап 8).

### HALL-RENT-5 — Единый read-model регистра денег аренды (2026-08-02)

- **Дата:** 2026-08-02
- **Решение:** SQL view `rental_money_register_v` (UNION cash movements) + RPC `list_rental_money_register` с gate `can_read_financial()`. Уникальный ключ `register_key` = `source_table:source_id`. Типы: `direct_booking_payment`, `invoice_payment`, `advance_received`, `deposit_receive`, `deposit_return`. Исключены `rental_advance_allocations` и `deposit apply_to_invoice` / `hold` — внутренние переводы, не касса. Provisional `operation_date` = дата `created_at` в TZ организации; редактируемое поле — этап 9.
- **Контекст:** Этап 5 аудита: три параллельных контура (`rental_payments`, invoice/advance/deposit) не сведены; агрегаты этапа 4 читали только прямые платежи.
- **Альтернативы:** (1) Отдельная ledger-таблица с триггерами на INSERT — дублирование и миграция истории; (2) Прямой SELECT нескольких таблиц на клиенте — двойные формулы и RLS-дыры.
- **Почему так:** View не переписывает историю, один канонический read-path для журнала и отчётов; gross inflow для выручки, signed sum для net; сторно/коррекции (этап 8) добавят строки в те же source-таблицы.

### HALL-RENT-1 — Кассовый gate оплаты аренды (2026-08-02)

- **Дата:** 2026-08-02
- **Решение:** Ввести permission `rentals.payments.write` и SQL-helper `member_can_record_rental_payment()` = `can_read_financial()` **или** (`member_can_manage_rentals()` ∧ `admin_can_accept_payments` для full admin). UI (`RentalInfoPopup`, сумма/rose-ring на сетке) и RPC `record_rental_payment` / история в `get_rental_detail` используют этот gate. RLS `rental_payments` SELECT не расширяли — кассир читает историю через SECURITY DEFINER detail RPC.
- **Контекст:** Этап 1 аудита «Аренда зала»: operational admin бронирует зал, но не принимает оплату (`finance.read` vs `payments.write`); `restricted_admin` уже имеет голый `payments.write`.
- **Альтернативы:** (1) Заменить gate на `payments.write` — открыло бы reception; (2) Выдать admin полный `can_read_financial()` — лишняя аналитика/venue cost; (3) Переиспользовать `member_can_accept_payments()` — teacher/reception могут пройти.
- **Почему так:** Единый канонический gate на UI и backend без ослабления tenant isolation и без контура reception до этапа 12. Accountant/owner/director сохраняют путь через finance.

### VENUE-COST-GAP-1 — Standalone gap acknowledgement without client payment (2026-08-03)

- **Дата:** 2026-08-03
- **Решение:** Отдельная таблица `venue_rule_gap_acknowledgements` и RPC `confirm_venue_cost_rule_gap` для owner/director/accountant (`member_can_manage_venue_cost_rules`). `venue_cost_status_for_org` снимает `acknowledgement_required`, если дата попадает в подтверждённый gap. Payment ack (`venue_rule_payment_acknowledgements`) остаётся для кассовых операций; gap ack — для настроек без платежа. Прошлые начисления не пересчитываются; preview показывает closed pending/priced в периоде.
- **Контекст:** Этап 16 аудита F30 — бухгалтер видел баннер, но не мог закрыть gap без директора или оплаты урока.
- **Альтернативы:** Только accept draft; автоматический disabled-bridge rule; переиспользовать payment ack с фиктивным payment.
- **Почему так:** Явный аудит (причина, период, автор) без обхода payment RPC и без молчаливого пересчёта истории.

### VENUE-COST-2 — Frontend payment gates and finance unification (2026-07-31)

- **Дата:** 2026-07-31
- **Решение:** Settings `/settings/venue-costs` для owner/director (manage) и accountant (finance.read); expiry notice на Dashboard; канонические payment flows требуют `VenueRulePaymentConfirmDialog` + `p_venue_rule_acknowledged`; закрытие урока через RPC из журнала/popup/списка, сумма только если RPC её вернул; расходы через `get_finance_costs`; прямые INSERT в payments через `useRecordPayment` отклоняются.
- **Контекст:** Backend ledger уже существует; фронт должен не обходить expiry gate и показывать venue accruals в прибыли/расходах без смешения с внешней арендой.
- **Альтернативы:** Тихий skip платежей при expired rule; считать venue cost только в настройках; оставить manual expenses как единственный expense source.
- **Почему так:** Явное подтверждение сохраняет операционную непрерывность кассы при gap, а единый costs RPC не дублирует ledger на клиенте.

### VENUE-COST-1 — Immutable policy snapshots and append-oriented accruals (2026-07-31)

- **Дата:** 2026-07-31
- **Решение:** Внутреннюю стоимость зала хранить как принятые неизменяемые версии с включительными периодами; факт урока закрывать явно, а финансовый эффект записывать отдельными начислениями. Исправление закрытия создаёт компенсирующую строку, не переписывает исходную сумму. Разрывы покрытия сохраняются как `pending_unpriced`. JSON items адресуют discipline/location с tenant-validation; удаляемый personal lesson отсоединяется nullable FK, но closure сохраняет стабильный source id и snapshot.
- **Контекст:** Правила стоимости меняются во времени, а исторические отчёты и подтверждения при истечении должны воспроизводиться без зависимости от текущих настроек. Внешние аренды — отдельный контур.
- **Альтернативы:** Пересчитывать расходы на лету из текущего JSON; обновлять/удалять исходное начисление при reopen; автоматически считать любой урок проведённым по расписанию.
- **Почему так:** Accepted snapshot и append-oriented ledger дают стабильную историю и аудит. Явное закрытие не начисляет расходы за отменённые/непроведённые уроки. `pending_unpriced` не теряет факты в периоде без правила, а явный `disabled` сохраняет безопасное отключение без блокировки существующих организаций.

### OFFLINE-1 — IndexedDB-снимок и очередь вместо offline-first CRM (2026-07-30)

- **Дата:** 2026-07-30
- **Решение:** Персистентный снимок расписания/абонементов и очередь только групповой посещаемости в IndexedDB; финансы офлайн — лишь черновики-напоминания; синхронизация через явную сверку и idempotent RPC; изоляция namespace по user+org.
- **Контекст:** CRM сценарий 11 — вечерняя смена при обрыве интернета/Supabase.
- **Альтернативы:** Service Worker + Cache API для всего приложения; localStorage; автоматическая отправка очереди без подтверждения.
- **Почему так:** Минимальный PII на диске, контролируемая сверка, переиспользование idempotency из сценария 10, без ослабления RLS.

### REFUND-1 — Возвраты абонементов отдельной сущностью (2026-07-30)

- **Дата:** 2026-07-30
- **Решение:** Таблица `subscription_refunds` (immutable, status pending/completed); RPC `finish_subscription_with_refund` атомарно завершает абонемент и создаёт возврат; формула рекомендуемой суммы: `ROUND(sale_price × lessons_left / lessons_total, 2)` где `sale_price` = сумма платежей по абонементу (fallback — цена тарифа); cap = получено − прежние возвраты; чистая выручка = поступления − completed refunds; зарплатная корректировка — negative `adjustment` line в settlement месяца операции.
- **Контекст:** CRM сценарий 9 — досрочный возврат за неиспользованные уроки без искажения операционных расходов.
- **Альтернативы:** Отрицательный `payments.amount`; запись в `expenses.other`; удаление исходного платежа.
- **Почему так:** Сохраняет аудит продажи, явно типизирует возврат, не смешивает с расходами студии, позволяет pending-статус и идемпотентность.

### EVENT-1 — Мероприятия отдельно от уроков и аренды (2026-07-29)

- **Дата:** 2026-07-29
- **Решение:** `calendar_events` + `calendar_event_sessions` для мастер-классов/открытых уроков; доход через `other_income` (FK на event), не через `payments.client_id`; атомарное создание RPC `create_calendar_event_with_cancellations`; персональные уроки отменяются soft-delete (`cancelled_at`), групповые — через существующие helpers split серии.
- **Контекст:** CRM сценарий 3 — мастер-класс на несколько дат с массовой отменой конфликтов и учётом дохода без фиктивного клиента.
- **Альтернативы:** Расширить `payments` nullable `client_id` + `event_id`; маскировать мероприятие под `personal_lesson`; объединить с будущим `rental`.
- **Почему так:** Отдельная сущность не загрязняет абонементы/зарплату; `other_income` проще RLS; аренда (сценарий 12) остаётся отдельным контуром.

### SCHED-MOVE-1 — Атомарный перенос occurrence группового занятия (2026-07-28)

- **Дата:** 2026-07-28
- **Решение:** Перенос одного occurrence регулярной серии — одна RPC `move_group_lesson_occurrence` (split исходного слота + insert one-off) с полями `moved_from_slot_id/date/time` на новом слоте; клиент только preview конфликтов через `findScheduleConflict`.
- **Контекст:** CRM сценарий 1 — перенос среды на субботу без поломки серии; клиентская связка «отменить + добавить» неатомарна.
- **Альтернативы:** Два клиентских вызова `cancelGroupLessonOccurrence` + `useAddGroupSchedule`; отдельная таблица исключений/связей.
- **Почему так:** Транзакция на сервере устраняет частичный сбой; минимальные nullable-колонки на `schedule_slots` дают типобезопасную связь без новой таблицы.

### PAY-INBOX-1 — Ручная оплата через platform inbox (2026-06-28)

- **Дата:** 2026-06-28
- **Решение:** Самостоятельные оплаты из CRM оформлять как `platform_purchase_requests`: пользователь отправляет проверочный комментарий из CRM, Edge Function сохраняет заявку и отправляет email разработчику, Dev Console показывает её в `/inbox`. После ручной проверки developer нажимает активацию, которая сразу переводит организацию в `licensed`, создаёт consumed lifetime key и показывает plaintext key в текущем ответе Dev Console.
- **Контекст:** Нужно поддержать два сценария покупки: приоритетный личный контакт с разработчиком и самостоятельную оплату с заявкой из CRM, дублированием в Dev Console и последующей активацией полного доступа.
- **Альтернативы:** Только генерировать pending key и просить пользователя активировать его вручную — хуже для сценария “разработчик активирует полный доступ выбранному пользователю”; хранить plaintext key постоянно — отклонено, текущая модель ключей показывает секрет один раз.
- **Почему так:** Платформенная таблица не ослабляет tenant RLS, заявка не теряется при сбое email, а Dev Console остаётся единственным местом ручной проверки платежа и выдачи lifetime-доступа.

### PAY-QR-1 — QR оплаты в JSON-конфиге платформы (2026-06-28)

- **Дата:** 2026-06-28
- **Решение:** Загруженные QR для способов оплаты хранить как небольшие `data:image/...` строки в существующем `platform_payment_methods.config`, без отдельного storage bucket и без GitHub-upload из браузера.
- **Контекст:** Dev Console должна управлять QR для криптовалют, банковских способов и перевода на вьетнамский счёт, а CRM должна показывать эти QR в разделе лицензии.
- **Альтернативы:** Supabase Storage — требует отдельного bucket/RLS или upload Edge Function; GitHub/raw assets — требует токен/серверный upload и усложняет поддержку; генерация QR на клиенте — не подходит, потому что пользователь хочет загружать собственные QR.
- **Почему так:** QR-изображения малы, текущий JSON-конфиг уже публично читается CRM и обновляется только developer-доступом через Dev Console. Это минимальный бесплатный вариант без новых политик хранения и без риска утечки upload-токенов.

### SV-1 — Разовые групповые посещения как отдельная сущность (2026-06-27)

- **Дата:** 2026-06-27
- **Решение:** Разовое посещение группового урока хранится в `single_visits`, а финансовое поступление — в `payments.single_visit_id`; тарифы выделены в `prices.category = 'single_visit'`. Создание выполняется через RPC `record_single_visit`, который сразу фиксирует `present` и оплату, проверяет дату, слот расписания, клиента, тариф и права.
- **Контекст:** Нужно добавить оплату разовых посещений из popup журнала посещений, отображать поступления в overview/финансах и считать зарплату преподавателя отдельно.
- **Альтернативы:** Абонемент на 1 занятие — отклонён, потому что загрязняет список абонементов и баланс занятий; payment-only — отклонён, потому что теряется посещаемость и атрибуция к группе/преподавателю.
- **Почему так:** Отдельная сущность сохраняет операционную историю посещения без абонемента, даёт точную связку платежа с группой/датой/слотом и позволяет payroll-разбивку через `single_visit_rate_percent` без смешивания с групповыми абонементами.

### F6.1 — Team payroll вместо teacher-only payroll (2026-06-27)

- **Дата:** 2026-06-27
- **Решение:** Не переименовывать существующие `teacher_*` таблицы в новой задаче, а расширить их до team payroll: ставки доступны для любого активного `organization_members` (`owner`, `director`, `admin`, `teacher`, `accountant`), начисления считаются по `pay_mode` (`percent`, `fixed`, `fixed_plus_percent`), проценты разделены на group/personal, выплаты могут превышать начисленное как аванс.
- **Контекст:** В payroll не отображались owner/director/admin и не было фиксированных/гибридных ставок; зарплатные выплаты ошибочно могли попадать в общий расход без связи с членом команды.
- **Альтернативы:** Полный rename таблиц/хуков в `team_*` — отложено, слишком большой риск для RLS и уже подключённых экранов; отдельная таблица авансов — отложено до полноценного payroll ledger.
- **Почему так:** Минимальный безопасный diff: сохраняются RLS, RPC names и существующие хуки, но бизнес-модель становится корректной для всей команды. Аванс как `amount_paid > amount_accrued` достаточно прозрачен для MVP и виден в отрицательном остатке.

### F6 — Payroll implementation details (2026-06-26, Промт 20)

- **Дата:** 2026-06-26
- **Решение:** Recalculate on-demand при открытии payroll UI financial-ролями (RPC `recalculate_teacher_settlement`). Guard деактивации teacher — RPC helper `teacher_member_has_future_lessons` (future `personal_lessons.date` OR active `schedule_slots` with `valid_to IS NULL OR valid_to >= today`) в `update_team_member`, не отдельный trigger на DELETE member. Subscription attribution в SQL дублирует F3: первый teacher из `schedule_slots` по `subscription_groups.schedule_group_id`. При recalculate `amount_accrued` не опускается ниже уже выплаченного `amount_paid`.
- **Контекст:** Промт 20 — реализация F6 после F5.
- **Альтернативы:** nightly cron recalculate; trigger на payments INSERT — отложено; отдельный `/my-payroll` route — отклонено в плане.
- **Почему так:** On-demand + invalidation проще для MVP; guard в существующем `update_team_member` без нового RPC для UI; защита CHECK `amount_paid <= amount_accrued` при изменении payments задним числом.

### F5/F6 — Payroll rates MVP: % от атрибутированной выручки (2026-06-26, план)

- **Дата:** 2026-06-26
- **Решение:** План F5/F6 зафиксирован в `tangodb_expenses_payroll_plan.md`. Для F6 MVP — **вариант A**: ставка `rate_percent` на teacher, начисление = атрибутированная выручка × rate; переиспользовать логику `resolvePaymentTeacherId` из `financeReports.ts`. Частичные выплаты — таблица `teacher_settlement_payments` + `amount_paid` на `teacher_settlements`. Teacher — read-only доступ к `/finance/payroll` (route exception), без полного finance panel.
- **Контекст:** Промт 7 — план expenses/payroll перед кодом; миграции не начинать до согласования.
- **Альтернативы:** фикс за занятие (B); гибрид % + фикс (C); отдельный route `/my-payroll` для teacher — отложено.
- **Почему так:** Минимальная схема, согласована с F3 top-teachers attribution; не требует ledger/cash-balance; accountant CRUD expenses + payroll write; salary category в expenses — для non-teacher costs, не дублирует F6 автоматически.

### F3 — Client-side dashboard analytics без RPC (2026-06-26)

- **Дата:** 2026-06-26
- **Решение:** F3 KPI (новые клиенты, топ-5 клиентов/преподавателей, заполняемость) — чистые функции в `financeReports.ts` + существующие TanStack Query hooks; без view/RPC.
- **Контекст:** Промт 4 (F3) — расширенная аналитика owner dashboard после F2.
- **Альтернативы:** SQL view/RPC для rank/occupancy — отложено до org с очень большим объёмом данных.
- **Почему так:** Один batch запросов (clients, payments trend, attendance, personal lessons, schedule, subscription_groups, team) с client-side O(n) агрегацией; без N+1. Выручка преподавателя: personal payment → `teacher_member_id` урока; subscription payment → первый teacher из `schedule_slots` по `subscription_groups.schedule_group_id`. Заполняемость = present / (present + absent) по group attendance + personal lessons (freeze/excused не в знаменателе).

### S10 — Lightweight typed i18n без react-i18next (2026-06-26)

- **Дата:** 2026-06-26
- **Решение:** Собственный модуль `lib/i18n` с typed `I18nKey`, словарями `ru`/`en`/`vi`, функцией `t()` и хуками `useI18n` / `useGuestI18n`. Nav/settings helpers в `navHelpers.ts`. Locale из `organization_settings.locale`; guest fallback через `localStorage`.
- **Контекст:** Промт 17 (S10) — полная `en-US` локализация CRM после заморозки русских SaaS-текстов.
- **Альтернативы:** react-i18next / i18next — отклонено (тяжёлая зависимость для ~500 ключей); runtime JSON bundles — отклонено (хуже type-safety).
- **Почему так:** TypeScript проверяет полноту словарей; минимальный runtime; согласовано с точечным i18n team/auth из S8.

### S9 — Owner emergency recovery flow (2026-06-26)

- **Дата:** 2026-06-26
- **Решение:** Manual owner email transfer только через Dev Console EF `dev-console-transfer-owner-email`: минимум 2 фактора (recovery code bcrypt + payment ref / lifetime / telegram / purchase contact / org data); режим `update_email` (Admin API) или `reassign_user` (RPC `dev_console_reassign_org_owner` если новый email уже зарегистрирован); audit с SHA-256 email hashes; anti-abuse block для demo→email с purged retention. Публичный self-service смены owner email — запрещён; CRM UI — инструкции на LicenseSettingsPage + существующий `/auth/forgot-password`.
- **Контекст:** Промт 16 (S9) — §8.8, §8.11.3.
- **Альтернативы:** Публичный endpoint с recovery code only — отклонено (§8.8); автоматический transfer по Telegram ID — отклонено.
- **Почему так:** Согласовано с DC1 restore password; service role только в EF; RLS не ослаблен; recovery code — дополнительный фактор, не единственный.

### S7 — PostgREST search sanitization (2026-06-26)

- **Дата:** 2026-06-26
- **Решение:** Общий модуль `_shared/postgrestSearch.ts` для Dev Console Edge Functions: strip `%`, `_`, `\`, `,`, `(`, `)`, limit 100 chars; email search — RPC `dev_console_user_ids_by_email` (уже есть). `ACTIVATION_DEBUG` default `false`; activation audit без raw RPC message unless debug on.
- **Контекст:** Промт 14 (S7) — §8.7 anti-abuse / injection.
- **Альтернативы:** Новая SQL RPC `dev_console_search_orgs(p_query)` — отложено; sanitize достаточен для MVP developer-only search.
- **Почему так:** Минимальный diff; согласовано с частичным sanitize в DC1 tenants EF; не меняет RLS.

### DC1 — estimate_org_storage heuristic (2026-06-26)

- **Дата:** 2026-06-26
- **Решение:** RPC `estimate_org_storage(p_org_id)` возвращает `total_rows`, `estimated_bytes = total_rows * 2048`, `breakdown` по tenant-таблицам (clients, subscriptions, payments, attendance, personal_lessons, schedule_slots, prices, disciplines, locations, classes, members). UI показывает KB/MB из heuristic bytes. Ручной purge — `purge_single_organization` → `_purge_demo_organization_core` (DELETE org + retention; S5).
- **Контекст:** Промт 18 (DC1) — Dev Console tenant admin.
- **Альтернативы:** `pg_total_relation_size` per org — отклонено для MVP: нет per-org tablespaces; `sum(pg_column_size)` sample — дороже на Edge Function cold start.
- **Почему так:** Достаточно для support triage «пустая vs наполненная demo»; согласовано с §8.11.5 ТЗ.

### S1 — Self-service demo onboarding (2026-06-26)

- **Дата:** 2026-06-26
- **Решение:** Вариант **A** для onboarding после self-service demo: RPC `create_self_service_demo_org` создаёт org с placeholder `Demo Organization` → пользователь проходит существующий `OnboardingWizardPage`. Turnstile проверяется на backend в Edge Functions; challenge хранится 24 ч по `owner_email_hash`. Emergency Recovery Code генерируется в Edge Function, хэш bcrypt в `user_recovery_codes`, plaintext показывается один раз на `VerifyEmailPage`. `data_purge_at = demo_expires_at` (strict 30 дней) для self-service demo.
- **Контекст:** Промт 8 (S1) — email registration без demo-key.
- **Альтернативы:** Вариант B — auto-complete onboarding в RPC с defaults → сразу dashboard; отклонено: теряется выбор пресета/модулей на первом входе.
- **Почему так:** Переиспользует готовый wizard и `needsOnboarding`; полный функционал CRM после wizard; согласовано с §8.2 ТЗ.

### S5 — Strict 30-day demo purge (2026-06-26)

- **Дата:** 2026-06-26
- **Решение:** Политика purge по умолчанию — `data_purge_at = demo_expires_at` (30 календарных дней), **без** обязательной фазы `demo_retention` 31–60. По `data_purge_at`: RPC `_purge_demo_organization_core` пишет `demo_owner_retention` (email/telegram hash), затем `DELETE FROM organizations` (ON DELETE CASCADE на business-таблицы). Licensed org и org с active/past_due subscription не purge'ятся. `run_demo_lifecycle()` — только stub-уведомления за 7 и 1 день; cron `purge-expired-demo-orgs` удаляет просроченные demo. Expired `demo_active` — read-only в UI и `organization_allows_writes` до purge.
- **Контекст:** Промт 12 (S5) — заказчик: удаление через 30 дней без read-only retention.
- **Альтернативы:** Вариант B+ (read-only +7 дней) — не выбран; tombstone `status = purged` — заменён на полное DELETE org row.
- **Почему так:** Согласовано с §8.2 ТЗ; anti-abuse через retention registry; минимальный diff к Dev Console manual purge (та же core RPC).

### PL-4 — Раздел `/personal` (2026-06-24)

- **Дата:** 2026-06-24
- **Решение:** Реализован канонический раздел `/personal` по `PERSONAL_LESSONS_TZ.md` §4–6, Этап 4. Откат `SCHEDULE_TZ` Промпт 7 для маршрутов персональных: `/schedule` — недельная сетка; `/personal` — список/фильтры/продажа. Удалены deprecated `PersonalLessonsPanel.tsx`, `PersonalPage.tsx`, `personalFilter` из Zustand.
- **Контекст:** Промпт 4 — UI раздела после Этапов 1–3 (RPC, хуки, `PersonalLessonSaleForm`).
- **Почему так:** Разделение операционных сценариев: полный список с фильтрами не дублирует недельную сетку; переиспользуются `EditLessonPopup`, `PayPersonalLessonModal`, единый hook attendance.

### PL-0 — Архитектурные решения раздела «Персональные уроки» (2026-06-24)

- **Дата:** 2026-06-24
- **Решение:** Принята целевая архитектура из `PERSONAL_LESSONS_TZ.md` §9 Этап 0. Ключевые пункты:
  1. **Маршруты:** `/personal` (список + фильтры), `/personal/sell` (продажа урока и пакета); `/personal/book` → redirect `/personal/sell`. Осознанный откат `SCHEDULE_TZ` §11.10: CRUD персональных возвращается в отдельный раздел; `/schedule` — только недельная сетка + popup из ячейки.
  2. **4-й клиент в MVP:** `client_id4`, type `quad`, тариф `personal_quad`; без module gating (`quad_lessons` — после `tangodb_modular_dance_crm_TZ.md`).
  3. **Вкладка «История» — не создаётся:** один список с фильтром периода (неделя / месяц / диапазон).
  4. **Delete/edit guard — вариант A для `isPastDate`:** глобальную `isPastDate()` (`date < today`) **не менять** — она используется в `canManageGroupLesson`. Для персональных: явная проверка `date <= today` в `canWritePersonalLesson`, RPC `delete_personal_lesson` / `update_personal_lesson` (`date > current_date` строго). Групповые уроки без изменений.
  5. **Посещаемость и пакеты:** единый RPC `mark_personal_lesson_attendance` для разовых и пакетных; списание `lessons_left` при `present`/`absent`; `excused` не списывает; **не** дублировать в `mark_attendance`.
  6. **Teacher финансы:** `price` скрыт (`personal_lessons_teacher_v`), `paid` виден — сохранить.
  7. **Повторения MVP:** отдельные строки `personal_lessons`; UI — «одна дата», «несколько дат», «еженедельно» (до даты окончания **или** N недель); `personal_lesson_series` — не в MVP.
  8. **Ручной тариф при продаже:** да, как в `AddPersonalLessonForm`.
  9. **Delete с оплатой:** MVP — запрет (сначала отменить оплату). Delete с пакетом и `attendance_status IN ('present','absent')` — запрет (сначала сменить отметку).
  10. **Edit урока с пакетом:** при `present`/`absent` запрет смены клиентов/пакета без сброса отметки.
  11. **Пакет — дисциплина и локация (§7.2):** пакет привязан к `subscriptions.discipline_id` — урок только в той же дисциплине (UI-фильтр + расширение trigger на Этапе 1). Локация — через `prices.location_id` тарифа пакета: глобальный тариф → любая локация; локальный → урок только в этой локации (UI + trigger через JOIN `subscriptions.price_id → prices.location_id`).
  12. **Module gate:** пункт nav «Персональные уроки» при `modules.personal_lessons === true`.
  13. **Должники:** не дублировать `ScheduleDebtorsBlock`; фильтр «Долг» на списке `/personal`.
  14. **Zustand `personalTab`:** переиспользовать в новом контейнере; `personalFilter` — удалить на Этапе 4.
  15. **Приоритет Этапа 1:** починить RPC attendance для пакетных **до** UI раздела (критический дефект §2.3).
- **Контекст:** Этап 0 `PERSONAL_LESSONS_TZ.md` — согласование решений перед кодом (аналог SCH-0 для расписания).
- **Альтернативы:**
  1. Оставить `/personal` → redirect `/schedule` (SCHEDULE_TZ) — отклонено: нужен отдельный операционный раздел с фильтрами и продажей.
  2. Вкладки «Будущие» / «Прошедшие» — отклонено для MVP: один список + фильтр периода.
  3. Вариант B — изменить `isPastDate` глобально на `date <= today` — отклонено: заблокирует edit сегодняшних групповых уроков без отдельного бизнес-решения.
  4. Списание пакета через `mark_attendance` — отклонено: private-пакет не имеет `schedule_group_id`; два источника истины.
  5. MVP без 4-го клиента — отклонено: требование зафиксировано в §12.
  6. `personal_lesson_series` в MVP — отклонено: усложняет первый релиз; отдельные строки достаточны.
- **Почему так:** Решения согласованы с аудитом кода (§2.3–2.4), существующими паттернами тарифов (`filterTariffsForSale`, `prices.discipline_id`/`location_id`) и RBAC (`tangodb_roles_rbac_TZ.md`). Минимальный diff к групповому расписанию; критический баг attendance блокирует корректную работу пакетов и должен быть исправлен первым.
- **Следующие шаги:** Этап 1 (БД и типы: RPC attendance, delete/update, quad) → Этап 2 (хуки + AttendancePanel) → Этапы 3–4 (форма + раздел `/personal`).

### PL-1 — БД и типы персональных уроков (2026-06-24)

- **Дата:** 2026-06-24
- **Решение:** Миграция `20260718000001_personal_lessons_stage1.sql`:
  - `client_id4`, type `quad`, `personal_quad`; constraint `excused` на `attendance_status`;
  - `mark_personal_lesson_attendance` — единый RPC для разовых и пакетных (`present`/`absent` списывают, `excused` нет, компенсация при смене);
  - `delete_personal_lesson` / `update_personal_lesson` с guard `date > current_date` (вариант A, PL-0);
  - `validate_personal_lesson_subscription` — quad, `discipline_id`, `location_id` через `prices`;
  - views `personal_lessons_teacher_v`, `subscriptions_teacher_v` — `client_id4`.
- **Контекст:** Промпт 1 `PERSONAL_LESSONS_TZ.md` — подготовка модели до UI раздела.
- **Почему так:** Критический дефект §2.3 (пакетные уроки не отмечались) блокировал AttendancePanel и будущий `/personal`; backend guard обязателен по §3.10.
- **Следующие шаги:** Этап 2 — хуки на RPC delete/update, AttendancePanel personal+пакет, invalidation subscriptions.

### Schedule groups on `classes.id` + monthly unlimited billing

- **Дата:** 2026-06-23
- **Решение:** Каноническая сущность группового урока — таблица `classes` (UUID). `schedule_slots.class_id` и `subscription_groups.schedule_group_id` ссылаются на неё. Посещаемость уникальна по `(date, subscription_id, schedule_group_id)`. Месячный безлимит — `billing_model = monthly_unlimited'`, `expires_at = activation + 1 month`, без списания уроков и без freeze/excused.
- **Контекст:** Дублирование `group_name` vs `classes`/`class_id`; одна отметка на абонемент в день не покрывала посещение нескольких групп; нужен новый тип абонемента.
- **Альтернативы:**
  1. Оставить составной ключ `location::groupName::discipline` — отклонено: нет стабильного id, сложно для attendance FK.
  2. Новая таблица `schedule_groups` параллельно `classes` — отклонено: дублирование; `classes` уже в v2-схеме.
  3. Отдельный `subscription.type = monthly_unlimited` без `billing_model` — отклонено: смешивает формат участия (solo/pair) и модель оплаты.
- **Почему так:** Один источник правды для групп; независимые отметки в журналах; расширяемость (лимиты, teacher scope по class_id уже в RLS).

### R0 — Согласование целевой RBAC-модели (фаза R0)

- **Дата:** 2026-06-20
- **Решение:** Принята целевая матрица доступа из `tangodb_roles_rbac_TZ.md` §4–§5 как основа для фаз R1–R6. Базовое ТЗ `tangodb_saas_platform_TZ.md` §5.2 и §6.1 подлежат синхронизации после R0.
- **Контекст:** Внешний аудит RBAC выявил расхождение между операционной логикой танцевальной CRM и текущей реализацией (admin и accountant слишком широкие; teacher продаёт групповые абонементы). Фаза R0 — согласование до написания кода.
- **Альтернативы:**
  1. Оставить текущую модель из `tangodb_saas_platform_TZ.md` §5 — отклонено: admin получает стратегические права (настройки, команда, экспорт), accountant видит весь CRM.
  2. Схлопнуть `director` в `owner` — отклонено: типичный сценарий школы — управляющий без доступа к лицензии и lifecycle org.
  3. Полная анонимизация PII для accountant в дебиторском отчёте — отклонено: имя и контакт обязательны для бухгалтерских документов (ФНС).
  4. Убрать `personal_lessons.sell` у teacher — отклонено: преподаватель должен фиксировать свои инд. уроки в scope.
- **Почему так:**
  - **Admin** сужается до операционки: CRM write, расписание, посещаемость, фиксация оплат, операционные отчёты; без settings/team/prices.write/export/audit/financial analytics. `prices.read` сохраняется для продажи абонементов.
  - **Accountant** изолируется в финансовый контур: `/finance/*`, финансовый dashboard, экспорт фин. отчётов; CRM-панели (клиенты, расписание, посещаемость, абонементы) закрыты. PII — только в финансовом контексте (журнал платежей, дебиторка): имя + телефон; полный CRM-профиль закрыт.
  - **Teacher** теряет продажу **групповых** абонементов по умолчанию (`teachers_can_sell_subscriptions=false` в §9); сохраняет `personal_lessons.sell` и оплату своих инд. уроков через RPC.
  - **Director** сохраняется между owner и admin: стратегия, команда, настройки, фин. аналитика; без `license.activate`, смены owner и удаления org.
  - **Миграция данных (R2):** все существующие `organization_members` с `role = 'admin'` повышаются до `owner` до ужесточения RLS — иначе текущие операторы школы потеряют settings/team/тарифы; нового узкого `admin` owner назначает вручную при необходимости.
  - Принцип без изменений: **UI — удобство, RLS — источник истины**; R2 обязательна перед prod с accountant.
- **Следующие шаги:** R1 (permissions + UI guards) → R2 (RLS migration) → синхронизация `tangodb_saas_platform_TZ.md` §5.

### R6 — Роль «Кассир» (reception) через restricted_admin

- **Дата:** 2026-06-20
- **Решение:** Вариант B из `tangodb_roles_rbac_TZ.md` §R6 — без нового CHECK constraint. Шаблон «Кассир» = `role: admin` + `organization_members.meta.restricted_admin: true`.
- **Контекст:** Школам нужен узкий оператор на стойке: оплата, посещаемость, проверка статуса абонемента — без CRM, расписания и отчётов.
- **Альтернативы:**
  1. Отдельный код роли `reception` в CHECK — отложено: усложняет audit/SQL без явной потребности.
  2. Только UI guards без RLS — отклонено: `is_restricted_admin()` в SQL, reception SELECT только subscriptions/attendance, payments write через `can_write_reception()`.
- **Почему так:** Один код роли `admin` в JWT и invite RPC; различие только в JSONB meta. Permissions.ts и RLS синхронизированы: кассир не открывает `/clients`, `/schedule`; сохраняет `payments.write`, `attendance.write`, masked `subscriptions.read`.

### SCH-0 — Архитектурные решения раздела «Расписание» (2026-06-22)

- **Дата:** 2026-06-22
- **Решение:** Принята целевая архитектура недельной сетки расписания из `SCHEDULE_TZ.md` §11. Ключевые пункты:
  1. **Версионирование `schedule_slots`:** поля `valid_from DATE` и `valid_to DATE` на той же таблице (без отдельной `schedule_slot_versions`). Backfill существующих строк: `valid_from = '2000-01-01'`. Partial UNIQUE-индексы только для активных версий (`WHERE valid_to IS NULL`).
  2. **Канон дат (B3, §5.1):** пусть **E** — день действия (edit/delete). **Создание:** `valid_from = today`, `valid_to = NULL`. **Редактирование в день E:** старая запись `valid_to = E` (слот виден включительно E), новая `valid_from = E + 1 day`, `valid_to = NULL`. **Удаление в день E:** `valid_to = E` (без INSERT). Фильтр недели `[W_start, W_end]`: `valid_from <= W_end AND (valid_to IS NULL OR valid_to >= W_start)`. Если `lessonDate < today` — edit/delete групповых скрыты (read-only).
  3. **Структура сетки по локациям:** вертикальные секции (`LocationScheduleSection` × N) — все залы на одном экране, без табов.
  4. **Операционный vs финансовый блок долгов:** под расписанием — только **операционный** `ScheduleDebtorsBlock`: персональные с `paid = 'no'`, без `financial_debtors_v`, без сумм для teacher/admin. Полный дебиторский отчёт с PII и суммами — только на `/finance` через `useFinancialDebtors()`. Красная ячейка в сетке = только `personal_lessons.paid = 'no'` (групповые не красим).
  5. **Accountant и reception вне MVP расписания:** `accountant` не видит panel `schedule` (как в `tangodb_roles_rbac_TZ.md` §4; `canReadScopedCrm → false`). `reception` (restricted_admin) не имеет доступа к `/schedule` (RLS R2). Расширение доступа reception — отдельная задача R7, не блокирует MVP.
  6. **RLS teacher write на `schedule_slots` — отложено (R4):** в MVP UI teacher не видит групповой CRUD; RLS по-прежнему разрешает teacher INSERT/UPDATE групповые слоты. Ужесточение RLS — отдельная миграция после MVP, не в scope Промпта 1.
  7. **Admin и групповой CRUD (R3):** RLS позволяет admin писать `schedule_slots`; в MVP UI групповые действия скрыты — только owner/director.
  8. **Время:** хранение TEXT `HH:MM`, сравнение через `timeToMinutes()` / `normalizeTime()`; legacy `9:00` нормализуется в `09:00`. Snap к 15 мин при edit; отображение как есть.
  9. **Timezone:** единый локальный TZ школы, без конвертации между локациями.
  10. **Deep link:** канон `/schedule?action=sell`; `/personal/sell` и `/personal/book` → redirect для обратной совместимости.
  11. **Зависимости UI:** без `react-day-picker` и `date-fns` — `WeekPickerPopover` и неделя через нативные `Date`/`Intl` + `lib/scheduleWeek.ts`.
  12. **DB overlap triggers (§7.1.1):** нужны для production-ready (race при параллельной записи); реализуются в Промпте 1 или фиксируются как accepted risk.
  13. **Продажа пакета:** `SellPackageModal` — кнопка в попапе персонального урока; CRUD персональных переносится из `/personal` в `/schedule`.
- **Контекст:** Аудит и ТЗ на переход от карточного списка к недельной CRM-сетке. Промпт 0 — фиксация решений §11 перед миграцией и UI (Промпты 1–9).
- **Альтернативы:**
  1. Отдельная таблица `schedule_slot_versions` — отклонено: усложняет запросы и RLS без выигрыша.
  2. Горизонтальные табы по локациям — отклонено: референс CRM и overview всех залов.
  3. `financial_debtors_v` под расписанием для всех ролей — отклонено: утечка PII и сумм (S1, S2); teacher/admin не должны видеть финансовые агрегаты вне `/finance`.
  4. Дать accountant/reception доступ к расписанию в MVP — отклонено: противоречит текущей RBAC-матрице и RLS; reception — отдельный эпик R7.
  5. Ужесточить RLS teacher на `schedule_slots` в той же миграции — отклонено: риск регрессии attendance/legacy flows; MVP = UI gates, RLS — отдельный эпик.
  6. Hard DELETE групповых слотов — отклонено: только soft через `valid_to` для истории.
- **Почему так:** Минимальный diff к схеме v2; темпоральные поля на месте — стандарт PostgreSQL. Канон B3 (`valid_to = E`, не «вчера») сохраняет сегодняшний день при edit «сегодня». Разделение долгов защищает финконтур. RBAC MVP согласован с кодом (`permissions.ts`, RLS R1–R6). UI-first ограничения для teacher/admin быстрее и безопаснее для rollout, чем одновременная смена RLS.
- **Следующие шаги:** Промпт 1 (миграция §7.1 + хуки) → Промпт 2 (read-only сетка) → CRUD/долги/навигация (Промпты 3–8) → регрессия (Промпт 9).

### Этап 0 — NAV-1, NAV-2, RBAC-6 (2026-06-20)

- **Дата:** 2026-06-20
- **Решение:**
  - **NAV-1 (B):** Скрыть пункт «Тарифы» в nav для accountant; `prices.read` сохранён для finance JOIN.
  - **NAV-2 (C):** Teacher home через `dashboard.scoped_summary` + `TeacherScopedDashboard` (расписание на сегодня, ближайшие персональные, быстрые ссылки) — без CRM-агрегатов.
  - **RBAC-6:** Убрать `disciplines.write` у admin; направления — только owner/director через `/settings/disciplines` (§4).
- **Контекст:** Regression QA CODE_REVIEW_ROLES.md — согласование nav и permissions до P1 bundle.
- **Альтернативы:** NAV-1 A (оставить /prices) — отклонено: лишний CRM-adjacent UI; NAV-2 A (скрыть Обзор) — отклонено: teacher нужен home; RBAC-6 оставить write — отклонено: противоречит «admin без стратегии».
- **Почему так:** Согласовано с tangodb_roles_rbac_TZ.md §4, §5.4, §5.5; минимальный diff в permissions.ts + новый компонент home.
