2026-09-06 — fix(crm): микропатч **2.10.2** — расписание преподавателя: блок неоплаченных уроков больше не тянет occupancy-строки всей студии (`teacherMemberId` + `excludeCancelled`); компактный спиннер вместо полноэкранной «Загрузка…».
2026-09-06 — fix(crm): микропатч **2.10.1** — загрузка расписания: подмены читаются без PostgREST-embed в `schedule_slots` (составной FK не в schema cache).
2026-09-06 — feat(crm): подверсия **2.10.0** — замена преподавателя на одно занятие: `lesson_occurrence_substitutes`, RPC `assign_lesson_substitute` / `clear_lesson_substitute`, журнал и зарплата у заменяющего (ставки заменяющего), постоянный педагог слота не меняется. Миграции `20261102000001`–`20261102000003`.
2026-09-06 — fix(crm): микропатч **2.9.96** — блок «Записи без преподавателя» скрыт для преподавателя: не грузит все слоты/персональные уроки (таймаут RLS).
2026-09-06 — feat(crm): микропатч **2.9.95** — право «Преподаватели могут создавать групповые занятия в расписании»: `schedule.write` для teacher привязан к `teachers_can_add_group_lessons`, редактирование своих групповых уроков, RLS INSERT/UPDATE schedule_slots; миграция `20261101000001`.
2026-09-06 — feat(crm): микропатч **2.9.94** — расписание преподавателя: занятые ячейки чужих дисциплин/групп видны как «Занято» без деталей и без редактирования; из меню скрыты Настройка CRM, Арендаторы и Финансы; в настройках организации — флаги «принять оплату», «групповое занятие в расписании», «добавлять клиента»; миграция RLS occupancy + `clients.create`.
2026-09-06 — fix(crm): микропатч **2.9.93** — accept-invite: если email уже в auth, `complete-invite` сохраняет введённый пароль и принимает инвайт; lookup аккаунта через SQL RPC вместо `listUsers`; подсказка «аккаунт уже есть» вместо тихого переключения на login.
2026-09-05 — fix(ops): микропатч **2.9.92** — production Supabase Auth `site_url` исправлен с `http://127.0.0.1:3000` на `https://tangodb.vercel.app`; allowlist дополнили `/auth/reset-password`, `/auth/verify-email`, `/accept-invite`; `supabase/config.toml` больше не хранит localhost как базовый Auth URL.
2026-09-05 — fix(crm): микропатч **2.9.91** — восстановление пароля: явный success-экран (зелёный баннер + подсказка про инвайт), технические ошибки (сеть, rate limit, SITE_URL) не маскируются; `AuthDeveloperContact` на forgot/reset/accept-invite; dev `console.info` при запросе сброса.
2026-09-05 — fix(crm): микропатч **2.9.90** — accept-invite: URL `#token=` важнее `__TDB_INVITE_TOKEN__` (старый stash не блокирует новую ссылку); hashchange сбрасывает preview.
2026-09-05 — fix(crm): микропатч **2.9.89** — приём инвайта преподавателя: токен с `#token=` сохраняется до `telegram-web-app.js`, hash парсится через `URLSearchParams`, `preview-invite` без embed `organizations()`, mismatch email не маскируется под «истекло».
2026-09-05 — fix(hall-rent): микропатч **2.9.88** — список арендаторов: наименование и тип контрагента на двух строках (тип — мельче).
2026-09-05 — fix(crm): микропатч **2.9.87** — toast-ошибки поверх всех модалей: portal в `document.body`, `z-[250]` (раньше `z-[60]` уходил под `ModalShell` `z-[65]`).
2026-09-05 — feat(hall-rent): микропатч **2.9.86** — возврат неиспользованного Mini App-баланса с карточки арендатора: RPC `preview_renter_wallet_payout` / `staff_renter_wallet_payout`, ledger `wallet_payout`. К выдаче только свободный остаток кошелька после долга, полной оплаты холдов и remainder живых броней (не `spendable − 100% холда`, иначе reserved 50% считается дважды). Документы: основание, способ (наличные/карта/перевод), галочка «заявление получено и деньги выданы», опциональный скан, номер РКО/чека возврата. Роли как у пополнения (`rentals.payments.write`). Telegram-уведомление арендатору. Миграции `20261089000001`, `20261089000002`.
2026-09-05 — fix(crm): микропатч **2.9.85** — «Скачать PNG» в обычном браузере больше не идёт в Telegram `downloadFile` (скрипт WebApp есть и в Chrome); HTTP-скачивание через `/api/export-file`. Mini App — по-прежнему native download.
2026-09-05 — fix(crm): микропатч **2.9.84** — PNG расписания в Telegram Mini App: same-origin `/api/export-file` (как QR), `image/png` в bucket `exports` (`20261088000001`); success только на `downloadFile` `success`.
2026-09-05 — fix(crm): микропатч **2.9.83** — экспорт PNG расписания в Telegram Mini App (Android): нативное сохранение через `WebApp.downloadFile` вместо share sheet без «Сохранить в галерею».
2026-09-05 — fix(hall-rent): Mini App **0.1.2** — сетка «Моя бронь» снова `indigo-600` (брендовый синий Studio Controller).
2026-09-05 — feat(hall-rent): Mini App **0.1.1** — палитра Studio Controller: `@theme` в `index.css`, `crmUi.ts`; success `green-*`, кредит кошелька `green-700` (вместо emerald); Entry spinner fallback `#5663D6`.
2026-09-05 — docs(crm): `crm_color_migration.md` переписан — актуальные цветовые правила Studio Controller вместо плана миграции; структура выручки в `design_system.md`.
2026-09-05 — fix(crm): микропатч **2.9.82** — финансовый обзор «Структура выручки»: цвет «Сдача зала (доход)» `violet-500` → `slate-600` (палитра Studio Controller).
2026-09-05 — feat(crm): микропатч **2.9.81** — миграция палитры Studio Controller: тёплый indigo/rose/amber в `@theme` (`index.css`), green для успеха/подтверждения, мягкие блоки расписания с акцентной полоской (`scheduleColors.ts`, `LessonBlock`), обновлены `design_system.md`, PNG-палитра, toast success → green.
2026-09-05 — fix(hall-rent): микропатч **2.9.80** — Mini App: в карточке постоянной аренды (пакет) кнопка «Отменить бронь» на каждое занятие; отмена одной даты через `renter_cancel_occurrence` без отмены всего пакета (возврат на баланс >24 ч до начала — на сервере). `PackSeriesCard`, i18n `cancelOccurrenceHint`, тест `MineTab`.
2026-09-05 — fix(hall-rent): микропатч **2.9.78** — Mini App: отмена брони персоналом CRM возвращает удержанную предоплату на кошелёк (`_renter_cancel_one_slot` → `miniapp_staff_cancel_refund`); pack cancel для charged awaiting-слотов. UI: вкладка «Мой профиль»; карточки «Пакет ожидает оплаты» — мягкие полоски (`slot-hold-soft`). Миграция `20261086000001`.

2026-09-05 — fix(crm): микропатч **2.9.77** — экспорт PNG расписания рисуется на canvas по данным недели (без `html-to-image` / Tailwind `oklch`, из‑за которых файл был белым).

2026-09-05 — fix(crm): микропатч **2.9.76** — экспорт PNG расписания: убран `opacity-0` у off-screen контейнера (белый файл), сетка рендерится сразу в режиме `forExport`.

2026-09-05 — feat(crm): микропатч **2.9.75** — экспорт PNG расписания: выбор одной локации в диалоге, в файл попадает только её недельная сетка.

2026-09-05 — feat(crm): микропатч **2.9.74** — расписание: кнопка «Скачать PNG» (ручной экспорт недельной сетки всех локаций, `html-to-image`).

2026-09-05 — fix(hall-rent): Mini App — единый вертикальный скролл вкладки «Расписание» на iOS (шапка, выбор зала и сетка в одном контейнере); при брони ячейки переключатель «Разовая» / «Постоянная (4 нед.)» с quote/create пакета в `BookingSheet`.

2026-09-05 — fix(hall-rent): Mini App — отступ названия зала в «Расписании»; выбор зала кнопками (все `miniapp_enabled` локации, RPC `bookable`); история кошелька свёрнута по умолчанию; автообновление сетки после отмены брони и при возврате на вкладку «Расписание» (`scheduleRefreshKey`, `onRefreshAll` после cancel). Миграция `20261085000001`.

2026-09-05 — fix(mini-app): при смене Telegram-аккаунта на том же origin сессия больше не переиспользуется без проверки — сверяем `telegram_id` из `initData` с JWT перед bootstrap; иначе signOut и новый mint (создаётся профиль нового арендатора). Тесты `initData.test.ts`.

2026-09-05 — fix(crm): микропатч **2.9.73** — финансы «Расходы»: итоговый блок в 4 строки; дебиторы: `_rental_paid_total` SECURITY DEFINER (permission denied rental_payments после S27); дашборд: «Входящие», заголовок «Аренда зала» / «(Mini App)» на мобильном; расписание: календарь недели не выходит за экран; попап «Отпуск преподавателя»: кнопки h-8 на всю ширину. Миграция `20261084000001`.

2026-09-05 — feat(crm): микропатч **2.9.72** — расписание «Бронь Mini App»: кнопка «Новый арендатор» с именем и Telegram ID прямо в попапе (разовая и пакет).

2026-09-04 — fix(crm): микропатч **2.9.71** — дашборд «Аренда зала (Mini App)»: подсказка конверсии заявок с `{{confirmed}}/{{rejected}}/{{submitted}}` (i18n); скрывается при отсутствии заявок за месяц; SLA badge — `{{count}}`.

2026-09-04 — fix(crm): микропатч **2.9.70** — расписание: отменённые аренды скрыты (`get_rentals_for_schedule_week` + клиентский фильтр); sticky-шапка дней поверх слотов на мобильном (`z-30`). Mini App: убран select с UUID над QR пополнения. Аренда: возврат предоплаты при отмене по сумме `prepay_charge` в ledger (`_renter_refund_prepay`). CRM: русские подписи движений кошелька; вкладки арендаторов — pill как в Финансах; история версий «Аренда зала» — кнопки сверху; продажа абонемента/персонального урока — i18n `{{var}}`, скрытие пустых прогнозов. Миграция `20261083000001`.

2026-09-04 — fix(crm): микропатч **2.9.69** — карточка арендатора: вкладки «Обзор / Аренды / …» в стиле раздела «Финансы» (pill-кнопки, `flex-wrap`); контент — отдельная `rounded-xl` панель. Компонент `SectionPillNav`.

2026-09-04 — fix(hall-rent): микропатч **2.9.68** — CRM: пустая подпись QR больше не дублирует текст поля «Подпись (банк, кошелёк)» — показываем дату загрузки и статус «Не действует»; удаление QR снова работает при старых заявках пополнения (detach `qr_asset_id` на confirmed/rejected). Миграция `20261082000001`. i18n `renter.qr.deleteFailed`.

2026-09-04 — fix(hall-rent): микропатч **2.9.67** — Mini App больше не показывает «сгенерированный» QR из SQL `_renter_qr_signed_url` / base64 Edge: только `storage_path` → `createSignedUrl` (как CRM) или Edge `signed_url`; RPC `signed_url` игнорируется; preview всегда перезапрашивает URL.

2026-09-04 — fix(hall-rent): микропатч **2.9.66** — `/api/qr-file` self-contained Node handler (Edge + import из `src/` давали 500 и TXT ~96 B вместо PNG); превью QR сначала через Storage `createSignedUrl` как в CRM; «Сохранить QR» — HEAD-проверка прокси и success только из callback `downloadFile`.

2026-09-04 — fix(hall-rent): микропатч **2.9.65** — Mini App показывает тот же Storage signed URL QR, что и CRM (не перекодированный base64); «Сохранить QR» качает через same-origin `/api/qr-file` + `Telegram.WebApp.downloadFile` (data: URL Telegram не сохраняет). Тесты `qrProxy` / `MineTab` / `qrUrl`.

2026-09-04 — fix(hall-rent): микропатч **2.9.64** — QR студии в Mini App: Edge `renter-qr-upload` CORS для origin кабинета (`RENTER_MINIAPP_ORIGIN`) плюс CRM; `action=sign` отдаёт `content_base64` для `<img data:>`; preview больше не крутит «Загрузка…» бесконечно. Тесты `MineTab` / `qrUrl` / Deno `renterMiniappHttp_test`.

2026-09-04 — fix(hall-rent): Mini App top-up QR preview больше не пропадает после замены/переактивации QR в студии: выбранный `topupQrId` синхронизируется с текущим списком active QR, stale id сбрасывается на первый доступный asset. Unit-тест `MineTab` покрывает смену active QR.

2026-09-04 — fix(crm): микропатч **2.9.63** — раздел «Финансы»: навигация переносится на следующую строку (`flex-wrap`); журналы платежей/должников/расходов переключаются на табличный вид с `lg` (не `sm`), чтобы не раздувать страницу при боковой панели; `main`/`section` с `min-w-0` и `overflow-x-hidden`.

2026-09-04 — feat(hall-rent): микропатч **2.9.62** — FZ (хвост аудита Mini App): сверка §9; исправлена регрессия FA1 в `_renter_early_close_pack` (FDB2 снова `debt_amount = delta`, не `+=`); убраны ambiguous overload `_renter_mark_terminal` (4-arg) и `_renter_credit_wallet_topup` (6-arg). Миграции `20261080000001`, `20261081000001`. Починены SQL-фикстуры FC1/FB3/FB6/FC5/FE5. Скрипт `scripts/fz-audit-check.mjs`. `db push` миграций FB–FE на linked DB.

2026-09-04 — feat(hall-rent): микропатч **2.9.61** — FE5 / P2-09, P2-24, P1-25: initData с `chat`/`receiver` не ломает вход (identity только `user.id`; group launch → `renter.auth.groupLaunchForbidden`); webhook secret до JSON + private-only classifier; mint replay перепроверяет suspension; bind не затирает winner; QR topup gate `renter.topup.chatRequired`; BotBanner blocked при `botStarted && !allowsWrite`; CRM handoff — server 302 (Vercel redirect + Vite dev middleware), client redirect убран. Миграция `20261079000001`. Тесты `renter_miniapp_fe5_auth_webhook_test.sql`, Deno `telegramInitData_test` / `renterTelegramWebhook_test`, vitest `BotBanner` / `renterMiniappHandoff`.

2026-09-04 — feat(hall-rent): микропатч **2.9.60** — FE4 / P2-23: `run_renter_booking_maintenance` изолирует ошибки по арендатору (`EXCEPTION` + subtransaction), пишет retryable failure в `renter_booking_maintenance_failures`, возвращает частичный итог `{processed, failed, failures}`; worker логирует partial failure. Миграция `20261078000001`. Тест `renter_miniapp_fe4_maintenance_isolation_test.sql`.

2026-09-04 — feat(hall-rent): микропатч **2.9.59** — FE3 / P2-07, P2-22: `gate_wait` retention (`gate_wait_count` + 7d) → `skipped` вместо вечного pending; `claim_token` fencing в `complete_renter_telegram_outbox`; drain Bot API fetch timeout 90s (< lease 120s); `renter_bootstrap.undelivered_notifications` + баннер Mine + `renter_ack_outbox_skipped`. Миграция `20261077000001`. Тест `renter_miniapp_fe3_outbox_retention_fencing_test.sql`.

2026-09-04 — feat(hall-rent): микропатч **2.9.58** — FE2 / P1-24: `_org_rental_qr_storage_readable` — renter Storage SELECT только для `is_active` QR (inactive/replaced недоступны); signed URL TTL 300 с (Edge `renter-qr-upload`, CRM/Mini App `createSignedUrl`). Миграция `20261076000001`. Тест `renter_miniapp_fe2_qr_storage_active_test.sql`.

2026-09-04 — feat(hall-rent): микропатч **2.9.57** — FE1 / P1-22, P1-23, P2-08: `renter_telegram_outbox_prepare_send` резолвит получателя по `renter_id` на момент drain (rebind enqueue→drain → переадресация, не старый `telegram_id`); `bot_started_bot_id` на dialog + gate/bootstrap; `bot_url` в `renter_bootstrap`; BotBanner CTA «Открыть бота»; redact outbox text после `sent`. Миграция `20261075000001`. Тест `renter_miniapp_fe1_outbox_rebind_test.sql`, vitest `BotBanner`.

2026-09-04 — feat(hall-rent): микропатч **2.9.56** — FDB3: один `on_time`/`untimely` и одно outbox-сообщение на pack-серию (`_renter_apply_series_reliability`, series enqueue helpers, suppress per-slot `auto_deleted`); Mini App checkout пакета (12 дат, cost/prepay/shortage/hold, result + CTA); timeline пакета в Mine (`PackSeriesCard`, `groupMineBookings`). Миграция `20261074000001`. Тесты `renter_miniapp_fdb3_series_reliability_test.sql`, vitest `packSeriesTimeline` + PackSheet result.

2026-09-04 — feat(hall-rent): микропатч **2.9.55** — FDB2: атомарная активация серии при topup (`_renter_activate_series_holds` — все 12 дат active/prepaid_charged или ни одной); `renter_cancel_pack` и `_renter_early_close_pack` для `awaiting_payment` серии; один FIFO в конце batch cancel. Миграция `20261073000001`. Тест `renter_miniapp_fdb2_series_activation_test.sql`.

2026-09-04 — feat(hall-rent): микропатч **2.9.54** — FDB1 / P1-01 variant B: series-level hold для пакета Mini App — `rental_series.hold_expires_at` + status `awaiting_payment`; `renter_create_recurring_pack` больше не ROLLBACK при нехватке баланса (12 слотов на сетке, один таймер `min(created+24h, earliest start)`); FIFO/worker пропускают per-slot expiry/reliability для серии on hold (один `untimely` на expiry). Миграция `20261072000001`. Тест `renter_miniapp_fdb1_series_hold_test.sql`; r1c pack test обновлён.

2026-09-04 — docs(hall-rent): **FDA** — skip: неприменим (F0b=B, §1.1). Вариант A (честный UX без series-level hold) закрыт решением F0b; этап D — **FDB1**–FDB4. Переходный UX пакета без обещания 24 ч уже в FB1/FB2; проверка vitest PackSheet+QuoteSummary 7/7.

2026-09-04 — docs(hall-rent): **FC6** — skip: §1.9 не меняли (владелец не подтвердил смену спеки пополнения). P1-03 слой 2 (`draft → chat → pending`, auto-expire draft) и P1-04 renter-cancel/auto-expire pending не реализованы; `renter_topup_requests.status` остаётся `pending|confirmed|rejected`. Предшественник FC5 проверен (`test:renter-miniapp-fc5` OK, vitest 65/65). Этап C закрыт; следующий — **FDB1** (решение пакета B).

2026-09-04 — feat(hall-rent): микропатч **2.9.53** — FC5 / P1-12: read-only RPC `get_renter_miniapp_dashboard_stats` (owner/director) — доход кошелька Mini App, occupancy канала, pending SLA, долг miniapp, expiring holds, конверсия заявок; блок «Аренда зала (Mini App)» на дашборде (`HallRentalDashboardBlock`); касса не смешивается. Миграция `20261071000001`. Тест `renter_miniapp_fc5_director_dashboard_test.sql`.

2026-09-04 — feat(hall-rent): микропатч **2.9.52** — FC4 / P1-21, P3-01, §3: `rentals.payments.write` для full admin не требует `admin_can_edit_schedule`; backend `member_can_record_rental_payment()` — finance или admin с payment-accept (не occupancy); сверка Mini App через inbox + `TopupEffectPreview` (FC2), без `renters.finance.read` на карточке; Telegram ID — pre-onboarding через first-login (decision_log). Миграция `20261070000001`. Тест `renter_miniapp_fc4_payment_scope_test.sql`.

2026-09-04 — feat(hall-rent): микропатч **2.9.51** — FC3 / P1-19, P1-20, P2-25: клик списка арендаторов при `renters.finance.read` открывает Finance-карточку (finance-only без контактов); `list_renters` возвращает `cashier_debt` и `miniapp_debt` отдельно; фильтры `cashier` / `miniapp` / `any`; Overview — два indicator долга. Миграция `20261069000001`. Тест `renter_miniapp_fc3_separate_debts_test.sql`.

2026-09-04 — feat(hall-rent): микропатч **2.9.50** — FC2 / P1-11, P2-26, P2-27: глобальный badge «Пополнения N» в основном nav; inbox confirm с preview эффекта (баланс, долг, холды); SLA >4 ч — баннер и сортировка для owner/director; сброс надёжности только через confirm с причиной и audit (`renter_reliability_reset_audit`); единый мастер «Создать аренду» с выбором канала cashier vs Mini App (`CreateRentalChannelDialog`). Миграция `20261068000001`. Тест `renter_miniapp_fc2_reliability_reset_test.sql`.

2026-09-03 — feat(hall-rent): микропатч **2.9.49** — FC1 / P1-03 слой 1, P2-01/02/06/18/28, P3-02: correlation code `TDB-XXXX` при создании pending; код в тексте чата, inbox и поиске; убран QR preview из строк inbox; default метод QR при активном макете; cash без «чек во вложении»; убрана недоказуемая галочка «чек отправлен»; чат не открывается повторно с тем же текстом. Миграция `20261067000001`. Тест `renter_miniapp_fc1_correlation_code_test.sql` + unit `studioChat`.

2026-09-05 — fix(hall-rent): микропатч **2.9.79** — Mini App пополнение: лимит для VND/KRW/JPY до 100 000 000 (мажорные единицы), RUB/USD — 1 000 000; `renter_bootstrap.topup_max_amount`; клиент валидирует сумму до RPC (2 400 000 ₫ для пакета). Миграция `20261087000001`.

2026-09-05 — fix(hall-rent): Mini App — QR-пополнение: не сбрасывать выбранный QR при фоновом refresh; автовыбор QR при переключении метода; ошибки валидации у кнопки «Отправить заявку в CRM».

2026-09-04 — fix(hall-rent): Mini App — пополнение: подсказка при пустой сумме; после «Отправить заявку в CRM» popup с чатом администратора (вместо автооткрытия до отправки); QR — fallback на inline base64 при недоступном signed URL.

2026-09-03 — test(hall-rent): FB8 / P2-12 — component/integration тесты UX этапа B в `tangodb-renter`: `QuoteSummary` (shortage/CTA), `BookingSheet` (result + top-up), `PackSheet` (weekday sync), `MineTab` (pending, prefill, profile, cancellation), `useVisibilityRefetch`. Vitest + happy-dom + Testing Library; 63 теста зелёные. Этап B закрыт.

2026-09-03 — fix(hall-rent): микропатч **2.9.48** — FB7 / P2-05, P2-11, P2-13, P2-15…17, P2-19…21: Mini App — навигация недели только chips+заголовок; read-only баннер ban/debt на расписании с CTA погашения; клик своего слота → scroll/highlight карточки в «Мои записи»; прошлые и <1 ч слоты disabled на клиенте; `mine_debt` на сетке + легенда; empty state без залов; org header со `studioName`; dead code (`EntryScreen` ready, `parseTelegramLanguage`, `bookingSuccess`/`packSuccess`); `packScope` без мутации weekdays. `renter_bootstrap.booking_banned`. Миграция `20261066000001`. Unit-тесты `idempotency`, `orgTime`, `occupancyMerge`.

2026-09-03 — feat(hall-rent): микропатч **2.9.47** — FB6 / P1-13, P1-14, P2-03/04/10, P3-04: `renter_bootstrap` возвращает `display_name`, `contact_phone`, `server_now`; `renter_get_wallet` — `direction` и `balance_after` для entries; Mini App — предзаполненный профиль (compact `<details>`), история кошелька с +/- и балансом после операции, человеческие lifecycle-статусы, countdown холда от server offset с tick и refetch, refresh списка броней не теряет загруженные страницы. Миграция `20261065000001`. Тесты `renter_miniapp_fb6_profile_wallet_test.sql` + unit в `tangodb-renter`.

2026-09-03 — fix(hall-rent): микропатч **2.9.46** — FB5 / P1-08, P1-10: смена `valid_from` автоматически включает соответствующий weekday в пакете (Mini App `PackSheet`, CRM `CreateMiniAppBookingDialog`); submit блокируется при расхождении; при пустом каталоге Mini App-залов CRM показывает setup CTA вместо fallback на все `locations`. Утилиты `packWeekdays.ts`, unit-тесты.

2026-09-03 — fix(hall-rent): микропатч **2.9.45** — FB4 / P1-06, P1-07: `_renter_inherited_hold_expires_at` наследует cooldown только на той же календарной дате и в том же зале; `renter_cancel_pack` отказывает для completed/cancelled и пустого batch; read model `can_delete_hold`, `can_cancel_occurrence`, `can_cancel_pack`; Mini App `MineTab` и CRM `MiniAppRentalInfoPopup` используют серверные флаги. Миграция `20261064000001`. Тест `renter_miniapp_fb4_hold_date_cancel_test.sql`.

2026-09-03 — feat(hall-rent): микропатч **2.9.44** — FB3 / P1-04 (показ), P1-05, P3-03: `renter_get_wallet` возвращает `pending_topup` и `has_awaiting_payment`; Mini App — карточка pending-заявки, ручное «Обновить», единый visibility refetch + polling 15 с в `CabinetScreen` (без Realtime). Миграция `20261063000001`. Тест `renter_miniapp_fb3_pending_wallet_test.sql`.

2026-09-03 — feat(hall-rent): микропатч **2.9.43** — FB2 / P1-09: единый серверный validator quote/create (`can_create`, `reasons`, cost/prepay/remainder/balance/shortage, fingerprint); pack quote с суммами 50%; CRM `CreateMiniAppBookingDialog` — auto-quote с debounce, Save только при актуальном quote, стабильный `idempotency_key` на диалог.

2026-09-03 — feat(hall-rent): микропатч **2.9.42** — FB1 / P1-02, P2-14: Mini App — полный auto-quote (cost, prepay, remainder, available, shortage), экран результата разовой брони с таймером холда и CTA «Пополнить N»; переход на форму пополнения с предзаполненной суммой (учёт долга §1.6); пакет — те же суммы в quote без обещания 24-часового холда.

2026-09-03 — fix(hall-rent): микропатч **2.9.41** — FA6 follow-up: `_renter_credit_wallet_topup` / `reverse_renter_wallet_topup` не трогают несуществующий `rental_advances.notes` (как `20261042000003`). Миграции `20261060000001`, `20261061000001`.

2026-09-03 — fix(hall-rent): микропатч **2.9.40** — FA6 / P0-01 operational: `preview_staff_renter_wallet_topup` (эффект до confirm), staff-topup с `external_reference`, append-only `topup_reversal` (`reverse_renter_wallet_topup`); CRM — review-диалог и отмена в карточке арендатора. Миграция `20261059000001`. Тест `renter_miniapp_fa6_topup_review_reversal_test.sql`.

2026-09-03 — fix(hall-rent): микропатч **2.9.39** — FA5 / P1-17: `renter_create_recurring_pack` хранит `rental_series.payload_fingerprint` и сравнивает canonical hash (location, dates, weekdays, time, renter); тот же key с другим payload → `idempotencyMismatch`, не тихий success; unique-handler тоже сверяет fingerprint. Миграция `20261058000001`. Тест `renter_miniapp_fa5_pack_fingerprint_test.sql`.

2026-09-03 — fix(hall-rent): микропатч **2.9.38** — FA4 / P1-16, P1-18: `_renter_debt_settle` переводит слот в `settled` при полном погашении (включая remainder-долг); CHECK `rentals_miniapp_debt_zero_chk`; `renter_cancel_pack` и `_renter_cancel_future_miniapp_for_ban` откладывают FIFO до конца batch (`p_defer_wallet`). Миграция `20261057000001`. Тест `renter_miniapp_fa4_debt_settled_cancel_fifo_test.sql`.

2026-09-03 — fix(hall-rent): микропатч **2.9.37** — FA3 / P1-15: `renter_create_booking` и `renter_create_recurring_pack` повторяют `_renter_create_gates` после `_renter_acquire_miniapp_locks` (debt/ban/inactive/add-on). Миграция `20261056000001`. Тесты `renter_miniapp_fa3_create_gates_test.sql` + concurrent `fa3-concurrent-race.mjs`.

2026-09-03 — fix(hall-rent): микропатч **2.9.36** — FA2 / P0-01: staff-topup — `claim_operation_idempotency` после wallet lock до credit (не SELECT до lock); `store_operation_idempotency` завершает pending-claim; обязательный `idempotency_key`; CRM держит стабильный ключ до success (не UUID в `mutateFn`). Миграция `20261055000001`. Тест `renter_miniapp_p0_fa2_reproduction_test.sql` зелёный.

2026-09-03 — fix(hall-rent): микропатч **2.9.35** — FA1: early-close surcharge присваивает `debt_amount` (не `+=` к remainder-долгу); `debt_charge_seq` + фаза `debt_settle:<seq>` для каждого обязательства; `unique_violation` на ledger без совпадения суммы — ошибка. Миграция `20261054000001`. Тесты P0-02/P0-03 + FA1 extras; P0-01 вынесен в `renter_miniapp_p0_fa2_reproduction_test.sql` (FA2).

2026-09-03 — docs(hall-rent): F0b — зафиксирован вариант **B** lifecycle пакета (series-level hold, этап D / FDB*); уточнены §1.5 и §1.9 спеки, независимые scope (§3 аудита), ветки QR/transfer vs cash; `decision_log` HALL-RENT-SELF-3. Код денежных RPC не менялся.

2026-09-03 — test(hall-rent): F0a — SQL-воспроизведение P0-01…03 (`renter_miniapp_p0_reproduction_test.sql`): lost-response staff-topup, same-key race, early-close surcharge с remainder-долгом, повторный debt_settle; asserts на ожидаемые инварианты для FA1/FA2.

2026-09-03 — fix(hall-rent): микропатч **2.9.34** — Mini App арендатора заново получает signed URL QR через Edge при показе/скачивании, поэтому макет снова открывается и сохраняется на устройство даже после протухшего URL. CRM больше не пишет и не читает несуществующий `rental_advances.notes` при приёме аванса; в карточке арендатора движения кошелька и способы аванса локализованы. Миграция `20261053000001`.

2026-09-02 — feat(hall-rent): микропатч **2.9.33** — Mini App: картинка QR студии через Storage signed URL + кнопка «Сохранить QR»; заявка на пополнение требует открыть чат студии, вставить текст о переводе и отправить чек (это оповещение владельцу). CRM: бейдж pending на «Пополнения Mini App» и зачисление одним нажатием после сверки чека. Миграция `20261052000001`.


2026-09-02 — feat(hall-rent): микропатч **2.9.31** — Mini App «Расписание»: палитра и UI-паттерны CRM (slate/indigo, светлая сетка, кнопки и поля как в кабинете студии).

2026-09-02 — feat(hall-rent): микропатч **2.9.30** — расписание Mini App: недельная таблица ячеек (пн–вс, шаг 30 мин) как CRM-сетка, плюс выбор недели внутри окна из трёх календарных недель (TZ студии).

2026-09-02 — fix(hall-rent): микропатч **2.9.29** — Mini App аренды больше не открывает логин CRM: `tangodb-renter` должен деплоиться со своего Root Directory (не корневой `vercel.json` CRM); CRM с Telegram `startapp` (UUID студии) сразу передаёт в кабинет арендатора; вход по Telegram ID через `renter-telegram-auth`. Кабинет не зовёт `requestWriteAccess` до `initData` и не зависает на «Загрузка» вне Telegram.

2026-09-02 — fix(hall-rent): микропатч **2.9.28** — блок «Бот, чат и QR»: пошаговое руководство разделяет /newapp (короткое имя, фото 640×360, /empty только для GIF) и Configure Mini App / Menu Button (кнопка Open); подсказка поля короткого имени — не @username бота.

2026-09-02 — feat(gcal): микропатч **2.9.27** — аренда зала выгружается в отдельный Google Calendar (`purpose=rentals`): другой аккаунт или другой календарь на том же аккаунте, не календарь уроков/мероприятий. Миграция `20261051000001`. Worker `source_type=rental`. UI в Интеграциях.

2026-09-02 — fix(hall-rent): микропатч **2.9.26** — блок «Бот, чат и QR»: пошаговая настройка под спойлером; чат = группа или личный аккаунт для чеков; явно, что Mini App писать не нужно.

2026-09-02 — fix(personal): микропатч **2.9.25** — фронт 2.9.21–2.9.24 не попал на production: Vercel build падал на недостающем экспорте `filterNewPersonalSeriesSlots`. Продовая CRM оставалась на **2.9.20** и сравнивала правило зала с **сегодняшней** датой. Экспорт добавлен, деплой разблокирован.

2026-09-02 — fix(personal): микропатч **2.9.24** — восстановлен льготный период оплаты после `valid_to` (до конца следующего месяца): миграция `20261050000004`, клиентский gate синхронизирован с SQL; диалог подтверждения скрывается, если дата урока ещё покрыта правилом.

2026-09-02 — fix(personal): микропатч **2.9.23** — правило зала для оплаты оценивается на **дате урока**, а не на сегодня: урок 28.08 при `valid_to` 31.08 больше не требует подтверждения. Клиент не показывает диалог, если дата услуги ≤ `latest_valid_to`. HTML без кэша (Telegram WebView).

2026-09-02 — fix(personal): микропатч **2.9.22** — оплата персонального урока не требует подтверждения истёкшего правила зала, если дата урока попадает в период `[valid_from, valid_to]` принятого правила; клиентская pre-check убрана, источник истины — RPC по `lesson_id`.

2026-09-02 — fix(personal): микропатч **2.9.21** — оплата персонального урока проверяет правило аренды зала по дате урока (с продлением на следующий календарный месяц после `valid_to`), а не по сегодняшней дате; архивный тариф урока подгружается по `price_id` и снова отображается в оплате и редактировании.

2026-09-02 — fix(personal): микропатч **2.9.20** — модалка оплаты персонального урока больше не сбрасывает выбранный способ оплаты при загрузке балансов начислений (эффект инициализации срабатывает только при смене урока, а не при каждом изменении `remainingDebt`).

2026-09-02 — fix(personal): микропатч **2.9.19** — диалог подтверждения оплаты при истёкшем правиле аренды зала (`VenueRulePaymentConfirmDialog`) рендерится поверх модалки оплаты персонального урока (`z-[70]` вместо `z-50`).

2026-09-02 — fix(gcal): микропатч **2.9.18** — в Google Calendar уходят все клиенты парного урока (заголовок `Вероника и Аня · …`, блок «Клиенты:» в описании). Раньше имена склеивались через запятую (недельный вид Google оставлял только первое) и не дублировались в описании; `&` в HTML-описании обрезал хвост. Миграция `20261049000001` ставит upsert будущих пар/троек/`&` в именах. Worker + kick.

2026-09-02 — fix(schedule/gcal): микропатч **2.9.16** — toast больше не показывает сырые ключи `hooks.error.personalOverlap` / `integrations.googleCalendar.errorEdgeFunctionUnreachable` (`isI18nKey` допускает camelCase). Отмена группового слота не DELETE-ит строку `schedule_slots`, если на неё ссылаются разовые посещения. CORS Edge Function: `Allow-Methods` и заголовки supabase-js. Миграция `20261048000001`.

2026-09-02 — feat(hall-rent): микропатч **2.9.15** — отдельная оплата Mini App временно снята. Модуль входит в купленный доступ к CRM (lifetime или активная ежемесячная подписка CRM) и выключен на демо 30 дней. Гейт `renter_miniapp_addon_is_active` больше не читает `organization_addons`; заявка `renter_miniapp_addon` отклоняется. Миграция `20261047000001`.

2026-08-31 — fix(hall-rent): микропатч **2.9.14** — понятные подписи блока «Бот, чат и QR»: имя Mini App в боте, пошаговая подсказка BotFather, ссылка для арендаторов без жаргона startapp/short name.

2026-08-31 — fix(hall-rent): микропатч **2.9.13** — минимум комментария заявки на оплату 10 символов (было 20; «Оплатил 500000 донг» = 19); подсказка «минимум N символов» под полем в CRM и на лицензии.

2026-08-31 — feat(hall-rent): микропатч **2.9.12** — ежемесячная цена Mini App add-on в `platform_payment_methods.config.renterMiniappAddon`; Dev Console `/payment-methods` задаёт сумму; CRM hall-rent показывает стоимость, «/ месяц», реквизиты платформы (сумма модуля, не lifetime CRM) и продление. Гейт без оплаты без изменений: `paused` или `period_end` < сегодня → выкл.

2026-08-31 — ops(hall-rent): production smoke — CRM **2.9.11** на Vercel; миграция R6 на `gizfpiujqjwbjtqfstbj`; cron `renter-booking-worker` `*/2 * * * *` (скрипт `supabase/scripts/schedule_renter_booking_worker_cron.sql`); `RENTER_MINIAPP_ORIGIN=https://tangodb-renter.vercel.app`; worker HTTP 200; **Mini App** задеплоен на `https://tangodb-renter.vercel.app` (Vercel project `tangodb-renter`); npm `test:db:renter-miniapp-r6`; фикс дубля `organization_members` в R6 SQL-тесте.

2026-08-30 — feat(hall-rent): R6 2.9.11 — `platform_purchase_requests.request_kind` (trigger: kind только service_role); `submit-purchase-request` / Dev Console inbox ветвятся по kind; activate add-on пишет только `organization_addons` (без lifetime CRM); CRM hall-rent: статус add-on + «оплатить модуль». Миграция `20261046000001`.

2026-08-30 — feat(hall-rent): R5 2.9.10 — надёжность 50/75: `_renter_apply_reliability` (идемпотентный `renter_reliability_events`, on_time++/untimely++), пороги штрафника/бана, bounce snapshot до charge, отмена будущего через R1c helpers, `reset_renter_reliability` + enqueue R4; CRM-баннеры penalty gap (settings + карточка). Миграции `20261045000001`–`20261045000002`.

2026-08-30 — feat(hall-rent): R4 2.9.9 — `renter_telegram_outbox` + enqueue в SQL-хелперах смены фазы (create/FIFO/expiry/T−24/topup/cancel/debt); drain `sendMessage` в том же `renter-booking-worker` (gate: add-on + `bot_started`, не mint/`allows_write`); кнопка Mini App из `_renter_miniapp_direct_link`; stubs enqueue для R5 (бан/штрафник). Миграция `20261044000001`.

2026-08-30 — feat(hall-rent): R3c 2.9.8 — кабинет `tangodb-renter/`: два раздела (сетка 3 недель + «Мои записи»), quote/create/pack/cancel/delete_hold через RPC R1c/R2, occupancy refetch на focus/visibility (без setInterval), idempotency в sessionStorage, wallet/topup/QR/profile, баннер бота по `bot_started`, locale из bootstrap (vi→ru), vitest на occupied/free merge.

2026-08-30 — feat(hall-rent): R3b 2.9.7 — отдельное Vite-приложение `tangodb-renter/` (порт 3002): mint через `renter-telegram-auth`, namespaced `auth.storageKey` по org, guard `actor=renter`, CSP `frame-ancestors` для Telegram Web, первый экран с `renter_bootstrap`, без сетки брони и без импорта `tangodb/src`.

2026-08-30 — feat(hall-rent): R2 2.9.5 — QR Storage `org-rental-qr`, allowlist чата, AES токена бота в `_shared/telegramToken.ts` + setWebhook (`verify_jwt=false`), persist Start/write в `renter_telegram_dialog`, отдельный inbox пополнений и staff-topup (`operation_idempotency`, `amount_fact`), кошелёк на карточке через патч `get_renter_detail` (не `renter_get_wallet`). Миграции `20261042000001`–`20261042000004` (00003: аванс без `notes`; 00004: QR delete без `storage.objects`).

2026-08-30 — feat(hall-rent): R1d 2.9.4 — worker `renter-booking-worker` (claim FOR UPDATE SKIP LOCKED + `run_renter_booking_maintenance` зовёт helpers R1c, drain Telegram no-op); RPC ставок часа / `miniapp_enabled`; `telegram_id` строкой в upsert/detail/list; сетка: `channel`/`lifecycle`, Mini App `paid_amount`/`payment_status` NULL; LessonBlock холд = slate + диагональ без rose; отдельная бронь канала и попап отмены (касса 2.5 не тронута). Миграции `20261041000001`–`20261041000002`.

2026-08-30 — feat(hall-rent): R1c 2.9.3 — RPC слота Mini App: `renter_create_booking` / `renter_create_recurring_pack` / `renter_cancel_*` / `renter_delete_hold` / `renter_quote_booking` / occupancy / bootstrap / `list_mine` / wallet; FIFO+debt_settle, lock = awaiting ∪ новый слот, пакет через `rental_series`+patterns, early-close helper. Миграции `20261040000001`–`20261040000002`.

2026-08-30 — feat(hall-rent): R1b 2.9.2 — ledger кошелька `renter_wallet_ledger`, SQL-хелперы `wallet_balance`/`reserved_prepay`/`spendable`/`available`, lock `_renter_wallet_lock_key`, одноразовый backfill нераспределённых авансов (перевод, не копия), currency-guard на ненулевой кошелёк, allocate 2.5 не ест leftover из кошелька; `rental_money_register_v` без UNION ledger. Миграция `20261039000001`.

2026-08-30 — feat(hall-rent): R1a 2.9.1 — `create_rental_series` берёт `_rental_location_lock_key` по `(location_id, date)`; кассовые write-RPC и unpaid-inbox/`financial_debtors_v`/`_renter_debt_total` не трогают `channel=miniapp`; `list_renter_rentals` оставляет холды видимыми с `channel`/`lifecycle` и `paid_amount`/`payment_status` = NULL. Миграции `20261038000001`–`20261038000002`.

2026-08-30 — feat(hall-rent): R0 каркас Mini App 2.9.0 — `rentals.channel`/`lifecycle`, `renters.telegram_id` (partial unique) + revoke сессий, `location_rental_hour_rates`, `organization_addons` fail-closed, хук JWT `actor=renter` без org-claims, запрет INSERT `organization_members` для renter. Миграции `20261037000001`–`20261037000004`.

2026-08-30 — docs(hall-rent): четвёртая сверка промптов R0–R6 в `renter_telegram_miniapp.md` — send только при Start (`bot_started`); lock create = новый слот ∪ awaiting renter; патч worker без потери enqueue; нет table CHECK на инвариант кошелька; catch-up п.3 ограничен `time_end`; пакет через `rental_series_patterns`; одно имя `renter_quote_booking`; `paid_amount` NULL на холде; `operation_idempotency` на topup; `organization_addons.status` active|paused. Код продукта не менялся.

2026-08-29 — docs(hall-rent): вторая сверка промптов R0–R6 в `renter_telegram_miniapp.md` — ловушки нарезки (`rentals.channel` vs `organization_renter_channel`, Edge `activate-access-key`, persist Start/write-access, staff `renter_id`/quote, патч той же worker RPC). Код продукта не менялся.

2026-08-29 — docs(hall-rent): сверка промптов R0–R6 в `renter_telegram_miniapp.md` — дыры нарезки (list_mine/wallet, request_kind в R0, enqueue до outbox, revoke telegram_id), ветка JWT staff vs renter, видимость слотов на карточке, TTL хеша ≠ auth_date. Код продукта не менялся.

2026-08-29 — docs(hall-rent): промпты реализации R0–R6 (§8) в `renter_telegram_miniapp.md` — нарезка этапа 0–6 из §5.8, короткие блоки для нового чата + длинные DoD. Код продукта не менялся.



2026-08-29 — docs(hall-rent): одиннадцатая сверка `renter_telegram_miniapp.md` — mint vs pooler/orphan user; кассовый `update_rental` на Mini App; idempotency пакета; `untimely++` при закрытой кассе; bounce штрафника; currency/TZ; HMAC ordinal; add-on fail-closed. Код продукта не менялся.

2026-08-29 — docs(hall-rent): десятая сверка `renter_telegram_miniapp.md` — два лимита слотов (не «8»); FIFO не после `time_start`; mint lock пары org+telegram; surcharge по слотам; pack preview 4 недель; AES бота ≠ Google; кнопка Mini App не из формы. Код продукта не менялся.


2026-08-29 — docs(hall-rent): девятая сверка `renter_telegram_miniapp.md` — SQL-gate ≠ UI `rentals.write`; lock = `_rental_location_lock_key` (не `time_start`); CORS Mini App не в `ALLOWED_ORIGINS`; SRI/telegram-web-app.js; `t.me/share`; `request_kind` только Edge; UNIQUE bot; mint при archive; `NUMERIC(12,2)`. Код продукта не менялся.



2026-08-29 — docs(hall-rent): восьмая сверка `renter_telegram_miniapp.md` — граница T−24 cancel vs charge; пакет без полной FIFO-активации = ROLLBACK (не бан с 4 холдов); cooldown на overlap; `untimely++` при выкл. add-on; renter JWT → demo-org; storageKey по org; CORS webhook; parse_mode; CHECK cancelled_reason. Код продукта не менялся.

2026-08-29 — docs(hall-rent): седьмая сверка `renter_telegram_miniapp.md` — дыры: renter-cancel после старта обходил remainder; mint при выкл. add-on блокировал отмену холда; повтор initData hash ломал вход; `untimely++` при suspended org; rate-limit до HMAC; глобальный jwt_expiry. HMAC: Bot API 8.0 (`signature` в HMAC). Код продукта не менялся.

2026-08-29 — docs(hall-rent): шестая сверка `renter_telegram_miniapp.md` — HMAC: `signature` **входит** в data-check-string (пятая сверка ошибочно исключала его); activate add-on не лицензирует CRM; renter-email не угадываемый; роль `authenticated` общая; Direct Link не стартует бота; FIFO charge в окне 24 ч; griefing refund-cancel; `miniapp_enabled`. Код продукта не менялся.



2026-08-29 — docs(hall-rent): пятая сверка `renter_telegram_miniapp.md` — ошибки (S39 хук без copy `telegram_id`), дыры денег (remainder vs `reserved_prepay`, backfill=копия аванса), уязвимости (HMAC replay 24ч, JWT `authenticated`, кассовый inbox на холдах Mini App, webhook `bot_id`, общий origin). Код продукта не менялся.

2026-08-29 — docs(hall-rent): четвёртая сверка `renter_telegram_miniapp.md` — раннее закрытие пакета vs `completed`, `spendable` vs `debt_settle`, кассовая отмена vs Mini App, catch-up и знаменатель надёжности, snapshot ставок / 3 kind, backfill кошелька, add-on без lifetime key. Код продукта не менялся.

2026-08-29 — docs(hall-rent): третья сверка `renter_telegram_miniapp.md` — HMAC Telegram (key=`WebAppData`), JWT арендатора vs `auth_organization_id()`, касса vs ledger 50/50, catch-up после `time_end`, штрафник vs пересчёт пакета, нет автоmerge карточек, HALL-RENT-9 на topup. Код продукта не менялся.

2026-08-29 — docs(hall-rent): вторая сверка `renter_telegram_miniapp.md` — закрыты внутренние противоречия (2.9 vs откат Atelier, «кассир» vs отмена слота, `settled` vs occupancy, долг vs FIFO, Vault vs GCAL-1, add-on vs lifetime) и дыры (наследование холда, последняя дата пакета, HMAC `start_param`, catch-up worker). Код продукта не менялся.

2026-08-29 — docs(hall-rent): сверка `renter_telegram_miniapp.md` с CRM 2.8.119 — фактические несостыковки (S39/L26 vs leftover `telegram.ts`, роль «кассир», `booking_status` vs `lifecycle`, HALL-RENT-23) и дыры логики (таймер холда vs `time_start`, FIFO как вычисляемый резерв, округление 50/50, auth на пару org+telegram). Код продукта не менялся.

2026-08-28 — docs(security): результаты **хвоста** восьмой сверки в `crm_security_audit_2026-08-22.md` (GRANT/EXECUTE/Realtime без регрессии, GraphQL без ключа 401, смоук owner 2.8.119). C1 / JWT teacher·reception·accountant / Dashboard Auth — осталось оператору. Код продукта не менялся.

2026-08-28 — docs(security): промпт **«Хвост»** по восьмой сверке (живой C1 / JWT ролей / Dashboard Auth / GraphQL; не S41, не код) в `crm_security_audit_2026-08-22.md`.

2026-08-28 — docs(security): после S40 — сверка production GRANT/EXECUTE + смоук owner SPA 2.8.119; в аудите секция «Проверка production после S40», старый `\dp` помечен историческим. Новых H\*/S41 нет.

2026-08-28 — fix(security): микропатч **2.8.119** — S40 / L1+L6+L13+L25: `submit-purchase-request` без хардкода email (секрет `DEVELOPER_NOTIFY_EMAIL` / `platform_payment_methods.config.contacts.email`); `crm_product_versions` без JWT SELECT; `landing-track-event` при лимите отвечает 429; локальный Realtime выключен (SPA не подписан). L7 без кода (SPA скачивается — норма). L8 allowlist Dev Console не снимали; `temporary_password` только в console. L14 не чинили (штат developer). L16 пропущен — закрыт S35.

2026-08-28 — fix(security): микропатч **2.8.118** — S39 / L11+L15+L18+L21+L22+L24+L26+L27+L28: freebusy только ролям с записью сетки (не accountant); `organization_settings` явный SELECT без `rental_billing_profile` (без column-REVOKE); GCal `last_error` урока не teacher; leftover `allowed_users`/`is_allowed_teacher`/`auth_telegram_id` сняты; `window.open` документов с `noopener`; дашборд teacher без `VenueRuleExpiryNotice`, `get_venue_cost_rule_status` для кассы (reception/admin/teacher с продажей + financial), не `can_read_financial`-only. L15 каталог `prices` и L22 SELECT `platform_payment_methods.config` оставлены — нужны продаже и странице лицензии.


2026-08-28 — fix(security): микропатч **2.8.116** — S37 / M4+M9+M10+M14+M18: комментарии «почему публичная» на Edge с `verify_jwt=false`; landing-track-event drop на durable IP/visitor limit; GoTrue captcha Turnstile + `captchaToken` в signUp/signIn/reset; ErrorBoundary/`parseAuthError` без сырого текста API; одинаковый ответ signup/request-demo-key/verify-self-service (без enumeration); waitlist `organization_id` только для активного member. Чеклист Dashboard Captcha — `lessons.md` § S37.

2026-08-28 — docs(security): S36 / M1 — инвентаризация «UI ≠ API»: JSONB-модули (`finance_basic` и др.) остаются UI-gate; роль/RLS — API. Storage `exports` уже `can_export_data()` (S25). Без бампа `2.8.y`. Волна 3 (S32–S36) закрыта.

2026-08-28 — fix(security): микропатч **2.8.115** — S35 / M12+M23+M29: офлайн IndexedDB без phone/telegram/email; `expenses` write — `NOT _is_finance_period_closed` (GRANT insert/delete сохранён); `audit_log_leadership_v` без снимков для director, полный trail только owner; `REVOKE` SELECT на базовую `audit_log` у JWT.


2026-08-28 — fix(security): микропатч **2.8.113** — S33 / M21: `can_manage_team()` читает `admin_can_manage_team` (+ `NOT is_restricted_admin`); `teachers_can_view_full_schedule` в `teacher_can_access_lesson` / `teacher_can_access_schedule_slot` (выкл. = только свои), occupancy RPC (`preview_*`, `get_rentals_for_schedule_week`) и teacher calendar sessions. Продажа персоналок уже S09 — не дублировали.

2026-08-28 — fix: микропатч **2.8.112** — S32 follow-up: карточка клиента у teacher грузит телефон/telegram/email/опекунов через RPC `get_client_card` (один UUID). Массовый `GET /clients` по-прежнему без teacher SELECT.

2026-08-28 — fix(security): микропатч **2.8.111** — S32 / H7: view `clients_teacher_v` (ФИО/id без телефона, telegram, email, опекунов); `useClients` / `useClientDirectory` для teacher читают view; `DROP` teacher SELECT на базовую `clients`. Журнал и абонементы по-прежнему показывают имена.

2026-08-27 — fix(security): микропатч **2.8.110** — S31 / M17: recovery-код владельца не пишется в `history.state` / `sessionStorage`; показ один раз из ответа `create-self-service-demo-org` (handoff в памяти модуля); копия письмом; повторный вызов API без plaintext; Dev Console transfer-owner по коду без изменений.

2026-08-27 — feat: микропатч **2.8.109** — ссылка инвайта хранится в `organization_invites.invite_url` и видна owner/director в списке ожидающих до accept/revoke; после accept/revoke колонка очищается триггером; `token_hash` в REST по-прежнему скрыт.

2026-08-27 — feat: микропатч **2.8.108** — карточка инвайт-ссылки показывает ФИО и email; несколько ссылок не затирают друг друга; форма приглашения открыта по умолчанию.

2026-08-27 — feat: микропатч **2.8.107** — инвайт в команду без письма: `invite-member` отдаёт `invite_url` один раз; UI копирует ссылку; Resend для инвайтов не используется. Список ожидающих ссылку не хранит.

2026-08-27 — fix(security): микропатч **2.8.106** — S30 / M15+M39+M58: `requireSiteUrl()` только из `VITE_SITE_URL` (без `window.location.origin`) для auth redirect; Edge `invite-member` / `create-subscription-checkout` — 500 без `SITE_URL`, без fallback `tangodb.vercel.app`; инвайт-ссылка `#token=` + scrub query/hash; токен только в памяти компонента, не `sessionStorage`.

2026-08-27 — fix(security): микропатч **2.8.105** — S29 / H8+M11: `auth_organization_id` / `auth_member_id` / `auth_member_role` требуют активное членство; при deactivate — `user_active_organizations` + `revoke_auth_sessions_for_user` (если орг была активной); `OrganizationProvider` — `claimsMismatch` при JWT org без активного membership → `refreshSession`.

2026-08-27 — fix(security): микропатч **2.8.103** — S27 / M31+M32+L10: `auto_expose_new_tables = false`; ковровый `REVOKE ALL` у `anon`; явные `GRANT SELECT` (именованный список таблиц + masking views) и точечный write для SPA; `ALTER DEFAULT PRIVILEGES REVOKE ALL`; без write на RPC-only таблицы (attendance, payments, rental money, payroll settlements, …).

2026-08-27 — fix(security): микропатч **2.8.102** — S26 / M59: `close_group_lesson_occurrence` считает present из `attendance` (+ single visits, pair=2); клиентский `p_confirmed_attendee_count` должен совпадать (`attendee_count_mismatch`); верхняя граница `classes.max_capacity`; venue-cost ledger не от фейкового count.

2026-08-27 — fix(security): микропатч **2.8.101** — S25 / M48+M51+M52: `renter_document_upload_intents` + Storage policies (upload/delete только path из `prepare_renter_document_upload`; SELECT только finalized/intent); `exports` insert = `can_export_data()`, без `application/octet-stream`; RPC `save_teacher_pay_rate`, `REVOKE` write на `teacher_pay_rates`.

2026-08-27 — fix(security): микропатч **2.8.100** — S24 / M41+M43+M45+M46+M53: `subscription_member_changes` / `subscription_freeze_periods` — SELECT только `can_read_operational()` / `can_read_financial()` / teacher scope; column-GRANT bundle на `organization_licenses` и `organization_subscriptions` (без `access_key_id` / Stripe provider ids); `organization_version_migrations` — только owner.

2026-08-27 — fix(security): микропатч **2.8.99** — S23 / M38+M42+M47+M50: `preview_rental_conflicts` / `preview_calendar_event_conflicts` — accountant и teacher вне своих уроков без `client_display`; `get_rentals_for_schedule_week` — teacher только локации scope или при `teachers_can_view_full_schedule`; `get_schedule_calendar_sync_labels` — teacher только свои персоналки/группы, не `calendar_name` коллег.

2026-08-27 — fix(security): микропатч **2.8.98** — S22 / M34+M56+M49: tenant guard в DEFINER (`is_active_member`, `member_role/scope`, `organization_allows_*`, subscription display/ids, `apply_scheduled`, `count_group_occupied_seats`, `venue_cost_gap_is_acknowledged`); `REVOKE EXECUTE` у `organization_has_*` / `is_platform_developer` / `teacher_member_has_future_lessons` от клиента; массовый `REVOKE EXECUTE … FROM PUBLIC, anon` (не от `authenticated`).

2026-08-27 — fix(security): микропатч **2.8.97** — S21 / M33: `escapeCsvCell` — префикс `'` и кавычки для ячеек начинающихся с `= + - @ \t \r` (CSV formula injection); один хелпер для dashboard/finance/conducted lessons/rental invoice экспортов.

2026-08-27 — fix(security): микропатч **2.8.96** — S20 / M26+M35+M36+M40: waitlist teacher SELECT по `teacher_can_access_class`; `REVOKE` write waitlist/spot_notifications (только RPC); `REVOKE INSERT`/`UPDATE(max_capacity)` на `classes`; `locations` write = `can_manage_settings()`; `schedule_slots_write_admin` через `member_can_write_schedule_as_leadership()` (`admin_can_edit_schedule`).

2026-08-27 — fix(security): микропатч **2.8.95** — S19 / M13+M24+M28+M25: view `organization_members_roster_v` (ФИО без phone/telegram/`user_id`/`scope`); полный SELECT членов только `can_manage_team()` / своя строка; `useTeamMembers` → roster, `useTeamMembersFull` → TeamSettings; `client_notes` operational только свои заметки; view `organization_invites_team_v` без `token_hash`, `REVOKE SELECT` на базовую таблицу.

2026-08-27 — fix(security): микропатч **2.8.94** — S18 / H30+M54+M55+M57: `DROP` teacher SELECT на `personal_lesson_charges` (RPC `get_personal_lesson_charge_balances` для оплаты); `useScheduleDebtors` у teacher без сумм; `get_teacher_settlement_detail` маскирует `monetary_base`/ФИО/ставки; `teacher_pay_rules` SELECT только `can_read_financial()`; `list_archived_prices` без `sales_count` для teacher.

2026-08-27 — fix(security): микропатч **2.8.93** — S17 / H24+H25+H28: view `calendar_events_teacher_v` без финансовых колонок, `DROP` teacher SELECT на `calendar_events`; `useCalendarEventsForWeek` для teacher через view; `REVOKE` write на `rental_series*` и `renters`/`renter_*` (только RPC); write `price_disciplines` / `price_teacher_members` = `can_manage_prices()`.

2026-08-27 — fix(security): микропатч **2.8.92** — S16 / H19+M30+H20+H32: `subscription_groups` teacher INSERT/DELETE только при `teacher_can_write_subscriptions()`; `REVOKE` write на `single_visits` (только `record_single_visit`); view `single_visits_teacher_v` без `amount`/`method`/`price_id`; `useSingleVisits` для teacher через view; журнал AttendancePanel без сумм.

2026-08-27 — fix(security): микропатч **2.8.91** — S15 / H11: `teachers_can_edit_clients` в RLS (`teacher_can_write_clients` + `teacher_has_client_write_scope`); teacher DELETE на `clients` запрещён; `subscriptions_update_teacher` WITH CHECK на `client_id1..4` через `subscription_teacher_update_client_ids_valid` (GRANT UPDATE не возвращали — S08).

2026-08-27 — fix(security): микропатч **2.8.90** — S14 / H4: security headers на Vercel (CRM + dev-console + корневой `vercel.json`) — CSP с `frame-ancestors 'self'`, Supabase/Turnstile/Telegram hosts, `X-Content-Type-Options`, `Referrer-Policy`, HSTS; `style-src 'unsafe-inline'` только для inline boot-стилей в `index.html` (SRI Telegram — S38).

2026-08-27 — fix(security): микропатч **2.8.89** — S13 / H2+H6+M20: `request-demo-key` не возвращает plaintext `TDB-DEMO-*` в JSON (ключ только в email); durable rate limit через таблицу `edge_rate_limit_buckets` + RPC `check_edge_rate_limit` (вместо in-memory Map); IP только `cf-connecting-ip`; Turnstile fail-closed без `TURNSTILE_SECRET_KEY` на production/staging.

2026-08-27 — fix(security): микропатч **2.8.88** — S12 / H5: `config.toml` Auth — min password 8 + `letters_digits`, confirm email ON, `secure_password_change`, session timebox 24h, email `max_frequency` 60s, redirect allowlist с prod `https://tangodb.vercel.app` (без wildcard preview). GoTrue captcha **не** включать до S37. Чеклист Dashboard — `lessons.md` § H5.

2026-08-27 — fix(security): микропатч **2.8.87** — S11 / H29+M44+M37: `_is_finance_period_closed` на основную кассу (`record_*_payment`, `finish_subscription_with_refund`, `update_payment_in_place`, `restate_personal_lesson_charge`, `write_off_personal_lesson_debt`); storno/correct без изменений; UI продаж и дебиторов — `finance.error.periodClosed`.

2026-08-27 — fix(security): микропатч **2.8.86** — S10 / H17+H18: `REVOKE` write на rental billing (`rental_invoices*`, advances, deposits, pricing_adjustments) и payroll (`teacher_settlements`, `teacher_settlement_payments`); SELECT у financial ролей сохранён; write только DEFINER RPC (`create_rental_*`, `record_rental_*`, `recalculate_teacher_settlement`, `record_teacher_settlement_payment`).

2026-08-27 — fix(security): микропатч **2.8.85** — S09 / H21+H22+H26+H16+M19: `REVOKE` write на `payments` (SELECT у `authenticated` сохранён; RLS SELECT `can_read_operational OR can_read_financial`); `personal_lessons_teacher_v` + `cancelled_at`/`price_id`; teacher-сетка всегда через view; `REVOKE UPDATE/DELETE` на `personal_lessons` (INSERT продажи + `teacher_can_write_personal_lessons`).

2026-08-27 — fix(security): микропатч **2.8.84** — S08 / H14+H15+H27+M27: `REVOKE` write на `attendance` (журнал только `mark_attendance`/`correct_attendance`/offline sync); `REVOKE UPDATE/DELETE` на `subscriptions` (INSERT private/package сохранён); `finish_subscription` и freeze helper — teacher только при `teachers_can_sell_subscriptions`; `directors_can_mark_attendance` в RPC без изменений.

2026-08-27 — fix(security): микропатч **2.8.83** — S07 / H12: `can_manage_team` / `can_manage_settings` + политика `organization_settings_update_admin` с `NOT is_restricted_admin()`; reception не PATCH настроек (`finance_period_closed_until`, `modules`, `teachers_can_*`) и не RPC инвайта/команды; owner/director без restricted — без изменений.

2026-08-27 — fix(security): микропатч **2.8.82** — S06 / H10: `REVOKE UPDATE` на `organizations` у `authenticated`/`anon`; продление демо и смена `owner_user_id`/`status` только через `service_role`/license RPC; SELECT своей орг и `branding_name` в настройках без изменений.

2026-08-27 — fix(security): микропатч **2.8.81** — S05 / H9 + H13: `REVOKE INSERT/UPDATE/DELETE` на `organization_members` у `authenticated`; триггер блокирует прямой REST (не `auth.uid()`); whitelist `scope`/`meta` в `create_organization_invite` / `update_team_member`; Edge `invite-member` санитизирует body.

2026-08-27 — fix(security): микропатч **2.8.80** — S04 / H33: `custom_access_token_hook` больше не копирует `platform_role` в JWT CRM; RLS `USING (false)` на platform-таблицы для `authenticated`; `REVOKE` write на `platform_audit_log`, `crm_product_versions`, UPDATE на `platform_payment_methods`; SELECT `config` кошельков для страницы лицензии сохранён.

2026-08-27 — fix(security): микропатч **2.8.79** — S03 / H31: `migrate_organization_version` игнорирует клиентский `p_actor_user_id` (всегда `auth.uid()`); `REVOKE EXECUTE` у `authenticated`/`anon`/`PUBLIC`; Dev Console / `service_role` по-прежнему мигрирует с `p_actor_user_id`.

2026-08-26 — fix(security): микропатч **2.8.78** — S02 / H23: `REVOKE EXECUTE` на `expire_monthly_subscriptions` у `authenticated`/`anon`/`PUBLIC`; кросс-тенантный RPC через PostgREST закрыт; внутренний `PERFORM` из журнала/freeze/замены партнёра без изменений.

2026-08-26 — fix(auth): микропатч **2.8.77** — S01 / C1: инвайт существующего email больше не меняет пароль и не выдаёт JWT; учётка нового invitee создаётся только в момент accept; `invite_url` не возвращается пригласившему; токен ≥128 бит (старые короткие инвайты отозваны — нужно отправить заново).

2026-08-26 — fix(gcal): микропатч **2.8.76** — Google Calendar: кэш access token (не refresh на каждый job), повторное использование календаря `TangoDB / …` вместо создания нового при 404, drain очереди в одном тике + kick после мутаций расписания. Сообщение «срок истёк» уточнено (Testing OAuth = 7 дней).





2026-08-26 — fix(finance): на production применены RPC списания дебиторки (`write_off_personal_lesson_debt` / `get_personal_lesson_debt_trace`); «Удалить» больше не падает на schema cache. Полная реализация — **2.8.73 / 2.8.74**.

2026-08-23 — fix(finance): микропатч **2.8.74** — кнопка **«Удалить»** в раскрытой строке дебитора (рядом с суммой долга и с «Скорректировать сумму»), rose outline как соседние действия — на мобильном больше не прячется за длинным UPPERCASE.

2026-08-23 — fix(finance): микропатч **2.8.73** — назначенная сумма персонального урока фиксируется при коррекции платежа (`correct_payment` синхронизирует `personal_lesson_charges.billed_amount`); списание ошибочной дебиторки (`write_off_personal_lesson_debt`) и журнал «как сложился долг» (`get_personal_lesson_debt_trace`) в Финансы → Дебиторы и карточке урока.

2026-08-22 — fix(finance): микропатч **2.8.72** — корзина снова на **каждой** строке возврата; RPC `remove_orphan_payment_storno` при сторно+замене удаляет возврат и строку «Заменён», оставляет актуальный платёж (нет удвоения суммы).

2026-08-22 — fix(finance): микропатч **2.8.71** — ошибки confirm-popup и toast через `createPortal` на `document.body` (не обрезаются `overflow-y-auto`); заметный alert-блок в диалоге; без дублирующего toast при ошибке удаления возврата.

2026-08-22 — fix(finance): микропатч **2.8.70** — удаление ошибочного возврата: RPC `remove_orphan_payment_storno` больше не пишет в `audit_log` недопустимое `DELETE_ORPHAN_STORNO` (ломало транзакцию); то же для `update_payment_method` / `update_payment_in_place`; ошибка показывается в confirm-popup, toast поверх модалки.

2026-08-21 — fix(finance): микропатч **2.8.69** — в журнале платежей кнопка удаления ошибочного возврата — иконка корзины (как карандаш); колонки журнала с фиксированными треками, «Источник» больше не съезжает из‑за разной ширины действия.

2026-08-21 — fix(finance): микропатч **2.8.68** — исправление платежа без сторно (`update_payment_in_place`): сумма/способ в той же строке; назначенная сумма персонального урока синхронизируется с платежом (причина «неверная сумма» убирает долг 950−800); видимая кнопка «Удалить ошибочный возврат» на каждой строке возврата; confirm-popup поверх модалки (`z-[90]`).

2026-08-21 — fix(finance): микропатч **2.8.67** — кнопка «Удалить ошибочный возврат» на строке возврата (развёрнутые детали + иконка); `isOrphanPaymentStorno` для сторно без `reverses_payment_id`; RPC удаления без связи с платежом.

2026-08-21 — fix(finance): микропатч **2.8.66** — смена только способа оплаты: RPC `update_payment_method` (без строки возврата); удаление ошибочного void-сторно `remove_orphan_payment_storno` (иконка в журнале); popup подтверждения с перечислением строк перед применением коррекции.

2026-08-21 — fix(finance): микропатч **2.8.65** — коррекция платежа в журнале: диалог по умолчанию «Исправить сумму / способ» (не сторно); при открытии — сумма и способ из платежа, причина «неверный способ»; валидация «ничего не изменилось»; новый idempotency key на каждое открытие.

2026-08-21 — fix(schedule): микропатч **2.8.64** — `LessonInfoPopup` не влазил в экран (долг + история платежей + GCal + переоткрытие): `max-h-[90vh] overflow-y-auto`, как у остальных модалей расписания.

2026-08-21 — fix(schedule): микропатч **2.8.63** — оплата персонального урока в расписании: красная рамка по остатку (`price − paid_amount`), а не только по флагу `paid`; `useScheduleForWeek.refetch` обновляет персональные уроки, не только групповые слоты; после платежа — optimistic cache + invalidate; в popup оплаты и карточке урока — расшифровка долга (начисление − платежи = остаток) и история платежей.

2026-08-21 — fix(payments): микропатч **2.8.62** — `PayPersonalLessonModal` «Оплатить за всех»: idempotency key — UUID на charge (ref/map), не `${uuid}:${uuid}`; PostgreSQL `p_idempotency_key uuid` больше не падает.

2026-08-21 — fix(integrations): микропатч **2.8.61** — GCal sync badge: `pending` только при `has_pending_job`; orphaned link `sync_status=pending` без job → `stale`; poll interval только при активной outbox-задаче; invalidate `entry-sync-status` после мутаций персональных уроков.

2026-08-20 — fix(data): микропатч **2.8.60** — автообновление UI после мутаций: общий `orgScopedQueryFilter` (org id — последний сегмент query key); исправлены оптимистичный кэш групповой посещаемости (`useMarkAttendance`), invalidate после офлайн-синка, payroll, teacher pay rules, Google Calendar binding/sync-status; `usePersonalLessons` переведён на общий хелпер.

2026-08-20 — fix(attendance): микропатч **2.8.59** — подсветка кнопки «Пришёл»/«Не пришёл»/«Уважит.» в журнале персональных уроков: оптимистичное обновление и invalidate снова попадают в кэш `usePersonalLessons` (org id — последний сегмент query key, не второй).

2026-08-20 — fix(i18n): микропатч **2.8.58** — P38 / L7: module `t(locale, key)` в `personalLessonClients` и `scheduleLessonAccess` — `t(null, key)` вместо одноаргументного `t(key)`. TS2554 п.29, 31–33 ушли; `tsc --noEmit` — 0 ошибок (P33 follow-up закрыт).

2026-08-20 — fix(types): микропатч **2.8.57** — P37 / L7: `usePrices` insert/update `prices` через `Tables.prices.Insert` / `Update`, не `Record<string, unknown>`; `discipline_id` из `disciplineIds` (один id или null). TS2345 п.9–10 ушли (6→4 ошибок tsc, остались TS2554 P38).

2026-08-20 — fix(types): микропатч **2.8.56** — P36 / L7: RPC `p_payload` (`Record` → `Json` через `asJson`) в personal lessons, rental billing/series/tariffs, renter CRM, teacher pay rules, venue costs, renter document upload; хелперы `*ToPayload` возвращают `Json`. TS2322 п.8, 11–21, 24, 28, 30 ушли (21→6 ошибок tsc).

2026-08-20 — fix(types): микропатч **2.8.55** — P35 / L7: хелпер `asJson` (`src/lib/json.ts`); доменные jsonb (`OrgModules`, `TeacherScope`, `MemberMeta`) в onboarding, `SettingsProvider`, `useTeamInvites`; чтение scope через `normalizeTeacherScope`. TS2322/TS2345/TS2352 п.1, 25–27, 34 ушли (26→21 ошибка tsc).

2026-08-20 — fix(types): микропатч **2.8.54** — P34 / L7: union `.from(table|view)` в `usePersonalLessons` и `useSubscriptions` заменён на два отдельных `fetchAllPostgrestRows` внутри queryFn; `.is("cancelled_at")` только на `personal_lessons`. TS2769/TS2589 и каскадные `.eq(..., never)` ушли (34→26 ошибок tsc).

2026-08-20 — feat(types): микропатч **2.8.53** — P33 / L7: сгенерирован `src/types/database.ts`, `createClient<Database>`, скрипт `npm run db:gen-types`. Поймана опечатка колонки `attendance.status` → `attendance_status` в офлайн-сверке. Остальные ~34 ошибки tsc — Json/`Record` и union table|view; массово не чистились (порог шага 4).

2026-08-20 — docs(schedule): микропатч **2.8.52** — P31 / L5: `SchedulePanel.tsx` оставлен как legacy (импортов в роутере нет); шапка файла + `architecture.md`: маршрут `/schedule` = `SchedulePage` → `SchedulePageContainer`, не подключать.

2026-08-20 — chore(payments): микропатч **2.8.51** — P30 / L4: удалены мёртвые `useUpdatePersonalPaid` (прямой `.update({ paid })` без ledger RPC) и заглушка `useRecordPayment`. `useAddPersonalLessons` с `paid:true` для пакета не трогали; канонические RPC оплаты на месте.

2026-08-20 — fix(notes): микропатч **2.8.50** — P29 / L3: queryKey заметок клиента — сортированные `member.id` команды, не `teamMembers.length`; замена сотрудника при той же длине списка обновляет подписи авторов. Fallback `common.employee` не трогали.

2026-08-20 — fix(schedule): микропатч **2.8.49** — P28 / L2: при miss deep link расписания (`focusNotFound`) обнуляются `focusLessonId` / `focusRentalId`; toast и чистка query params как раньше, успешный focus не трогали.

2026-08-20 — refactor(license): микропатч **2.8.48** — P27 / L1: waitlist (`submit-subscription-waitlist`), активация ключа (`activate-access-key`) и onboarding RPC (`complete_organization_onboarding`) вынесены из UI в хуки; `SubscriptionWaitlistCard`, `LicenseSettingsPage`, `OnboardingWizardPage` больше не зовут supabase напрямую.

2026-08-20 — fix(i18n): микропатч **2.8.47** — P26 / M17: `LocaleDocumentSync` ставит `html lang` по префиксу локали (`en*` → `en`, `vi*` → `vi`, иначе `ru`); `vi-VN` больше не получает `lang="ru"`.

2026-08-20 — fix(sql): микропатч **2.8.46** — P25 / M11: миграция `20260928000001` DROP 11-arg `_record_personal_lesson_payment_impl` (хвост после `CREATE OR REPLACE` с `p_charge_id`); публичный `record_personal_lesson_payment` не трогали. В комментарии: `20260925000002` обязателен после `000001` (GET DIAGNOSTICS). На прод не apply.

2026-08-20 — chore: CodeGraph MCP — абсолютный `--path` и `codegraph.cmd` в `.cursor/mcp.json`; индекс синхронизирован (`codegraph sync`).

2026-08-20 — fix(i18n): микропатч **2.8.45** — P24 / M10: маска клиента в `scheduleLessonAccess` / `personalLessonClients` через `t()` (`schedule.lessonInfo.clientNotSpecified`, `common.client`); сравнение с sentinel-ключом, не с русским литералом.

2026-08-20 — fix(i18n): микропатч **2.8.44** — P23 / M9: подпись dual debtors — операционные долги сетки (`useScheduleDebtors`) явно не равны «Финансы → Дебиторы» (`financial_debtors_v`); ключи `schedule.debtors.scopeHint` / `finance.debtors.scopeHint` (ru/en).

2026-08-20 — fix(renters): микропатч **2.8.43** — P22 / M8: загрузка документа арендатора — идемпотентный finalize (повтор RPC + существующая строка по `storage_path`); cleanup Storage при сбое upload/finalize; при неясном результате lookup файл не удаляется (не оставляем CRM-документ без объекта).

2026-08-20 — fix(renters): микропатч **2.8.42** — P21 / M7: мутации contact/contract/document/communication в `useRenterCrm` инвалидируют кэш только при `success: true`; soft-fail больше не выглядит как сохранённые данные.

2026-08-20 — fix(offline): микропатч **2.8.41** — P20 / M6: ошибка SELECT `attendance` в офлайн-сверке больше не трактуется как «нет записи» (`serverOldStatus=null`); операция помечается `failed` и не уходит в ложный sync.

2026-08-20 — fix(finance): микропатч **2.8.40** — P19 / M4: границы дня/месяца для payments, corrections, other income и KPI в TZ организации (`orgCreatedAtUtcRange`); без браузерной полуночи и без naive `T00:00:00` / UTC `toISOString` для «сегодня».

2026-08-20 — fix(personal): микропатч **2.8.39** — P18 / M3: `useRecordPersonalLessonPayment` больше не принимает `markPaid` (в RPC не уходил); call sites в `PersonalLessonSaleForm` убраны. Статус `paid` по-прежнему через `sync_personal_lesson_paid_status`.

2026-08-20 — fix(payments): микропатч **2.8.38** — P17 / M2: журнал платежей (`usePayments` / `usePaymentCorrections`) SELECT + map `personal_lesson_charge_id` → `personalLessonChargeId`; расчёт балансов charges не менялся.

2026-08-20 — fix(attendance): микропатч **2.8.37** — P16 / M15: `useMarkAttendance` — те же гарды, что early-return `onMutate` (`evaluateMarkAttendanceGuard`), проверяются в `mutationFn` до RPC; `oldStatus===status` / freeze / `lessonsLeft` / нет sub не вызывают `mark_attendance` / `correct_attendance`. Soft-fail `{success:false}` и откат кэша (C1) сохранены.

2026-08-20 — fix(subscriptions): микропатч **2.8.36** — P15 / M5: `apply_scheduled_subscription_member_changes` убран из `queryFn` `useSubscriptions`; один вызов при входе в org (`useApplyScheduledSubscriptionMemberChanges`); ошибка RPC через `reportClientError`, не маскируется успешным fetch.

2026-08-20 — fix(schedule): микропатч **2.8.35** — P14 / M14: оплата «за всех» в `PayPersonalLessonModal` — при обрыве цикла toast «оплачено X из Y», refetch charges, модалка не закрывается как полный успех; идемпотентность по charge id.

2026-08-20 — fix(nav): микропатч **2.8.34** — P13 / M1: payroll-only teacher видит «Финансы» в сайдбаре (`canAccessFinanceNav`); `/finance` пропускает `PanelAccessRoute` → `FinanceIndexRedirect` на payroll; прочие finance-маршруты без `finance.read` по-прежнему закрыты.

2026-08-20 — fix(attendance): микропатч **2.8.33** — P12 / H5: журнал посещений — цена разового персонального урока скрыта для teacher (`showPrice`, как на `/personal`); статус оплаты без суммы.

2026-08-20 — fix(data): микропатч **2.8.32** — P11 / H4+M13+M16: org-scoped query keys для Google Calendar (binding, team/org metrics, entry-sync-status) и optimistic attendance персональных уроков (`withOrgId`); глобальные `["google-calendar"]` / `["personalLessons"]` без org убраны из этих хуков.

2026-08-20 — fix(schedule): микропатч **2.8.31** — P10 / H6: `PayPersonalLessonModal` — `try/finally` вокруг cash-оплаты после `paymentSubmit.begin()` (сброс `saving` при throw/`success:false`); `handlePayPackage` — явный `catch` и `void` onClick.

2026-08-20 — fix(schedule): микропатч **2.8.30** — P09 / H3: `useEditGroupSchedule` — при ошибке update successor после close восстанавливает `valid_to = null` у исходного слота (как на ветке insert).

2026-08-20 — fix(prices): микропатч **2.8.29** — P08 / H2+L8: `syncPriceTeacherMembers` и `syncPriceDisciplines` — snapshot перед DELETE и rollback при ошибке INSERT; `useCreatePrice` удаляет тариф при сбое sync связей.

2026-08-20 — fix(schedule): микропатч **2.8.28** — P07 / H9+M18+M19+M20: ISO-guard и max-iterations в expand/while; cap 52 слотов (повтор) и 200 дат (preview); DatePicker/native `max` +12 мес; conflict-query только в cap; `useAddPersonalLessons` отказ >52; freebusy AbortSignal+timeout, cap вызовов; i18n ru/en.

2026-08-20 — fix(integrations): микропатч **2.8.27** — H8+M12: `resolveLessonGoogleSyncUiStatus` — `detached`/`unknown` без вечного `pending`; poll только при реальном job; cap 20×15s → badge `stale`; i18n ru/en.

2026-08-20 — fix(data): микропатч **2.8.26** — H12: `fetchAllPostgrestRows` (`lib/postgrestRange.ts`) — пагинация `.range()` для clients, subscriptions, attendance, personal_lessons, payments; без тихой обрезки на `max_rows = 1000`.

2026-08-20 — fix(types): микропатч **2.8.25** — H1: `netPaidForCharge` принимает узкий slice платежа; `TeacherRevenueContext.personalLessonById` включает `timeStart`/`timeEnd`; `resolvePersonalPaymentLessonMinutes` не бросает при пустых временах.

2026-08-20 — fix(offline): микропатч **2.8.24** — H11: reconnect-импульс обрабатывается один раз (rising edge + ref); стабильные `withOrgId` и `openReconciliation`/`closeReconciliation` (`useCallback`).

2026-08-20 — fix(auth): микропатч **2.8.23** — H7+H10: UI role/memberId из membership (JWT — fallback); `claimsMismatch` + баннер; refresh JWT без цикла (fingerprint, in-flight, лимит попыток, scoped invalidate); finance/settings скрыты при mismatch.

2026-08-20 — fix(attendance): микропатч **2.8.22** — C1: откат оптимистичного кэша посещаемости при soft-fail RPC (`success: false`) в `useMarkAttendance` и `useMarkPersonalLessonAttendance` (`onSettled` + общий `rollback`).

2026-08-18 — fix(personal): микропатч **2.8.21** — поиск клиента: иконка лупы слева по центру поля; сортировка списка «От начала месяца» / «От конца месяца» (по умолчанию от конца).
2026-08-18 — chore: gitignore для `.codegraph/`, `.wrangler/`, import JSON и one-off scripts; коммит calendar import tooling, миграций `archived_at`/prices, CodeGraph MCP rule, проектной документации.
2026-08-18 — feat: микропатч **2.8.20** — редактирование персонального урока: выбор тарифа (без оплаты/абонемента), пересчёт суммы начисления, предупреждение по длительности.

2026-08-18 — fix: микропатч **2.8.19** — Google Calendar group sync: `removeStaleRecipientLinks` больше не удаляет события других occurrence одного слота (из‑за этого в календаре оставался только один понедельник, среда/пятница не повторялись); `refresh_member` перед reconcile очищает все managed-события и links; скрипт `calendar-full-resync.mjs`.

2026-08-18 — fix: микропатч **2.8.18** — Google Calendar в popup урока (персональный и групповой): название календаря + статус синхронизации; убрано из сетки расписания. RPC `get_group_occurrence_google_sync_status`, `calendar_name` в personal RPC.

2026-08-18 — feat: микропатч **2.8.17** — расписание: в каждой записи (группа, персональный, мероприятие) показывается название Google-календаря синхронизации; RPC `get_schedule_calendar_sync_labels`, хук `useScheduleCalendarSyncLabels`.

2026-08-18 — fix: микропатч **2.8.16** — Google Calendar: массовый retry dead-letter (`token_revoked` после reconnect); OAuth callback автоматически requeue dead + `refresh_member`; кнопка «Повторить failed» в блоке синхронизации команды.

2026-08-17 — fix: микропатч **2.8.15** — Google Calendar: заголовок события начинается с имени клиента (`Богдан · Бальные танцы`); локация в описании (без поля `location` — меньше иллюстраций Google); дедупликация orphan/пересекающихся групповых событий; «Синхронизировать будущие уроки» — полный refresh (`refresh_member`); повторное создание календаря с тем же именем возвращает существующий.

2026-08-17 — fix: микропатч **2.8.14** — Google Calendar reconnect: OAuth callback требует новый refresh token при `revoked`/`error`, не помечает аккаунт active со старым токеном; после reconnect — reconcile outbox и сброс binding errors; worker снова пробует refresh вместо мгновенного `token_revoked`; Integrations auto-sync после OAuth success.

2026-08-17 — fix: микропатч **2.8.13** — оплата персонального урока после добавления второго клиента: `update_personal_lesson` переключает `billing_split_mode=equal` и пересинхронизирует charges; `PayPersonalLessonModal` не сбрасывает тариф записи на первый из прайса при загрузке. Миграция `20260923000001`.

2026-08-17 — feat: микропатч **2.8.12** — редактирование персонального урока: еженедельное повторение (как при создании из расписания); общий хелпер `expandPersonalLessonWeeklySlots`.

2026-08-17 — fix: микропатч **2.8.11** — удаление будущих персональных уроков: автоматическая очистка начислений (`personal_lesson_charges`) и платежей вместо блокировки «Сначала отмените оплату урока»; прошедшие уроки — прежняя защита (сторно). Миграция `20260922000001`.

2026-08-17 — fix: микропатч **2.8.10** — бронирование с расписания: проверка пересечений по всему диапазону дат серии (не только текущая неделя); понятное сообщение до отправки в БД.

2026-08-17 — fix: микропатч **2.8.9** — персональные уроки: toast с `hooks.error.*` (в т.ч. `personalOverlap`) переводится через `resolveMutationError` вместо сырого i18n-ключа.

2026-08-17 — revert: откат Design System v2 Atelier (`2.9.0` → `2.8.8`) — продуктовое решение; восстановлена legacy-палитра `slate`/`indigo` в CRM, dev-console, landing. Коммит `9806320` (revert `a14b252`).

2026-08-17 — fix/ui: микропатч **2.8.8** — мобильная вёрстка Финансы (платежи: квадратная «Редактировать» справа; дебиторы: кнопки оплаты справа; аренды к оплате: «Новая аренда» справа); действующие абонементы — кнопки действий в колонку на мобильном; i18n: убраны «нетто», перевод effective amount, фикс «На {{date}}».

2026-08-16 — fix: микропатч **2.8.7** — оплата персонального урока: автоподстановка тарифа записи (`price_id`) в `PayPersonalLessonModal` — тариф урока всегда в списке (в т.ч. вне фильтра продажи / архивный), без fallback на первый тариф прайса при загрузке.

2026-08-16 — fix: микропатч **2.8.6** — прайс: поле «Длительность тарифа» в «Редактировать тариф» (после описания, как при создании); `isPrivateTariffWithDuration`; длительность в селектах тарифа (касса, продажа урока, пакет) и в архиве.

2026-08-16 — fix: микропатч **2.8.5** — дебиторка: восстановлен импорт `sumDebtorAmounts` (runtime crash).

2026-08-16 — fix: микропатч **2.8.4** — дебиторка: строки одного парного/группового урока объединены в одну запись («Иван & Мария», суммарный долг); в деталях — разбивка по участникам. `groupPersonalLessonDebtors` в `financeReports.ts`.

2026-08-16 — fix: микропатч **2.8.3** — оплата персонального урока с несколькими участниками: `sync_personal_lesson_charges` upsert (сохраняет UUID charge, устраняет «Начисление не найдено»), backfill `billing_split_mode=equal` для неоплаченных duo+, fallback lookup charge по `client_id` в RPC; `PayPersonalLessonModal` — долг по каждому участнику, оплата одного или всех сразу. Миграция `20260921000001`.

2026-08-16 — release: микропатч **2.8.2** — этап 3 персонального тарифа: блок «Персональные: по тарифам» на Финансы → Выручка (`personalTariffSales.ts` / re-export из `financeReports`, ключ `price_id` ?? снимок, нетто count/sum), скрипт `test:personal-tariff-sales`. Промпт 11.

2026-08-16 — release: микропатч **2.8.1** — этап 2 персонального тарифа: `personal_lesson_charges`, режим «поровну» (`billing_split_mode`), дебиторка по charge, оплата с `p_charge_id`, restate только при одном charge, backfill legacy платежей. Миграция `20260920000001`. Промпт 10.

2026-08-16 — release: подверсия **2.8.0** — персональный тариф с длительностью, автосумма billed (multiply-first), два режима кассы (`tariff` / `outstanding`), плательщик на уроке и в дебиторке, снимок тарифа на платеже, журнал и edit-popup. SQL-тесты `personal_tariff_payment_test.sql`, JS `test:personal-tariff-pricing`. Этап 1 закрыт (Промпт 9). Критерии §9 п.1–9: ✅.

2026-08-16 — feat: персональный тариф — дебиторка по плательщику: `financial_debtors_v` + `price_id` / `other_participants`, строка и детали с длительностью слота (i18n), участники «с …»; `openPersonalPayment` — `priceId`, billed + `paidAmount`, payer без требования `client_id1`; `ScheduleDebtorsBlock` — payer в строке, длительность, `hidePackage`. Этап 1, Промпт 7; версия без bump (2.8.0 — Промпт 9).

2026-08-16 — feat: персональный тариф — касса: режимы `tariff` / `outstanding` / `package` (пакет скрыт из дебиторки); `PayPersonalLessonTarget` — `priceId`, `payerClientId`, `clientId4`, `teacherMemberId`, `paymentMode`, billed + `paidAmount`; тариф по `price_id` (включая архивный), lock тарифа при платежах, сумма lock = остаток в режиме tariff, снимок на RPC, select плательщика, баннер длительности; callers: дебиторка, расписание, журнал, `/personal`. Этап 1, Промпт 6; версия без bump (2.8.0 — Промпт 9).

2026-08-16 — feat: персональный тариф — продажа/запись урока: `billedFromTariff` + `price_id` при создании, select плательщика при 2+ клиентах, баннер `durationWarning`, фильтр тарифов по педагогу (`filterPrivateLessonTariffsForSale` + `teacherMemberId`), `useAddPersonalLessons` пишет `price_id` / `payer_client_id`, пересчёт суммы при смене слота до сохранения. Этап 1, Промпт 5; версия без bump (2.8.0 — Промпт 9).

2026-08-16 — feat: персональный тариф — UI прайса: поле «Длительность тарифа» (пресеты 30/45/60/90 + своё) при создании/правке персонального и пакетного private-тарифа; `useCreatePrice` / `useUpdatePriceMeta` пишут `duration_minutes`; предупреждение о неоплаченных уроках при правке; длительность в списке тарифов через i18n. Этап 1, Промпт 4; версия без bump (2.8.0 — Промпт 9).

2026-08-16 — feat: персональный тариф — миграция `20260918000001`: единая `record_personal_lesson_payment` (venue ack + partial + снимок тарифа + плательщик + кап остатка), `restate_personal_lesson_amount` обнуляет `price_id`, `update_personal_lesson` — `price_id`/`payer_client_id` и пересчёт billed по §3.3, `_storno_payment_impl` / `correct_payment` копируют снимок; хук `useRecordPersonalLessonPayment` передаёт `p_client_id` и поля тарифа. Этап 1, Промпт 3; версия без bump (2.8.0 — Промпт 9).

2026-08-16 — feat: персональный тариф — миграция `20260917000001` (`prices.duration_minutes`, `personal_lessons.price_id` / `payer_client_id`, снимок тарифа на `payments`, `financial_debtors_v` по плательщику + `client_id4`), хуки `usePersonalLessons` / `usePayments` / `useFinancialDebtors`, `DebtorEntry`. Этап 1, Промпт 2; версия без bump (2.8.0 — Промпт 9).

2026-08-16 — feat: персональный тариф — слой расчёта `personalTariffPricing.ts` (multiply-first billed, warn-коды длительности, splitBilledEqually), типы `Price.durationMinutes` / `PersonalLesson.priceId` / `payerClientId` / снимок на `Payment`, `mapPrice`, i18n длительности, скрипт `test:personal-tariff-pricing`. Этап 1, Промпт 1; версия без bump (2.8.0 — Промпт 9).

2026-08-15 — feat: дебиторская задолженность — кнопка «Оплатить» переименована в «Оплата по тарифу»; добавлена «Оплата текущей суммы» (предзаполняет сумму задолженности записи). Версия `2.7.26`.

2026-08-15 — feat: платежи — кнопка «Открыть в расписании» у персонального урока и аренды; deep link раскрывает сетку зала и подсвечивает запись (`?date=&lesson=&location=` / `&rental=`). Дебиторка — корректировка суммы задолженности (пересчёт начисления = оплачено + новый остаток). Версия `2.7.25`.

2026-08-15 — feat: дебиторская задолженность — клик по строке раскрывает реквизиты документа (вид, дата, время начала/конца, зал, преподаватель, дисциплина, срок/просрочка); кнопка «Открыть в расписании» для персонального урока и аренды (`?date=&lesson=` / `&rental=`). Абонемент с низким остатком раскрывается как предупреждение, не как денежный долг. Версия `2.7.24`.

2026-08-15 — feat: расписание — при создании персонального урока в popup доступно еженедельное повторение (как у групповых): чекбокс, N недель или до даты; `PersonalLessonSaleForm` режим `schedule-cell`. Версия `2.7.23`.

2026-08-15 — fix: журнал посещений — абонемент с последним занятием остаётся в списке после отметки «Пришёл» и учитывается в числе пришедших (`computeSubsForDate`). Версия `2.7.22`.

2026-08-14 — fix/ui: мобильное расписание — ячейки уроков под колонкой времени (z-index); popup редактирования персонального урока — «Отменить оплату»; обзор/статистика — иконка пересчёта аренды без текста на мобильном, без подписей слева на графике выручки, тап по точке показывает значение. Версия `2.7.21`.

2026-08-13 — feat: прайс-лист — тарифы сортируются по названию (кириллица А–Я, затем латиница A–Z, затем цифры); `compareLabelsCyrillicFirst` / `sortPricesByLabel` в `utils.ts`, `PricesPanel`. Версия `2.7.20`.

2026-08-13 — feat: тарифы — в «Редактировать тариф» и форме создания можно привязать тариф к нескольким дисциплинам (`price_disciplines`, мультивыбор в UI). Версия `2.7.19`.

2026-08-13 — feat: popup персонального урока в расписании — клиенты на отдельных строках, клик открывает карточку клиента с просмотром и редактированием. Версия `2.7.18`.

2026-08-10 — feat: редактирование персонального урока — в popup «Редактирование» можно добавить, заменить и удалить клиентов (минимум один обязателен); обновлены подсказки в форме. Версия `2.7.17`.

2026-08-10 — fix: календарь `DatePickerField` рендерится через portal поверх карточек (не обрезается `overflow-hidden` на странице расходов). Версия `2.7.16`.

2026-08-10 — ui: страница «Расходы» — компактное пустое состояние; блоки «Затраты студии по правилам» и «Внешняя аренда (удержания)» свёрнуты по умолчанию, разворачиваются по клику со всеми записями периода. Версия `2.7.15`.

2026-08-10 — fix: групповые уроки с нулевой арендой пересчитываются при принятии правила и ретроактивно (миграция `20260900000002`); корректировки `correction_after_rule_accept` показывают понятную подпись вместо технического кода. Версия `2.7.14`.

2026-08-10 — fix: кнопка «Урок оплачен» в модалке оплаты персонального урока снова работает при повторном открытии — сброс `paymentSubmit` при смене урока/открытии модалки (раньше phase оставался `saved` и `handlePaySingle` выходил без действия). Версия `2.7.13`.

2026-08-08 — fix: запись персонального урока «Без оплаты» в расписании больше не создаёт строку в журнале платежей — `willRecordCashPayments` только для режима «разовый урок», ранний выход без RPC оплаты, защита от повторного submit и сброс venue-диалога; `useAddPersonalLessons` не инвалидирует кэш платежей при создании неоплаченного урока; `mapPersonalLesson` — `paid` по умолчанию `no`. Версия `2.7.12`.

2026-08-07 — Версионирование CRM: semver `2.7.11` (`tangodb/src/lib/appVersion.ts`, `package.json`); отображение `v2.7.11` в sidebar над копирайтом; правила bump в `.cursor/rules/core.mdc`; решение VER-1 в `decision_log.md`.

2026-08-07 — Google Calendar sync recovery: миграция `20260902000001` устраняет глобальную блокировку claim при просроченном `processing` lease и более новой `pending/retry` задаче с тем же `dedupe_key`; worker при 404 для недоступного календаря и scope `calendar.app.created` атомарно создаёт выделенный `TangoDB / <организация>`, обновляет member binding и повторяет запись события.

2026-08-07 — Расписание: блок «Записи без преподавателя» сворачивается по умолчанию (как должники).

2026-08-07 — Расписание: блок «Записи без преподавателя» (`ScheduleMissingTeachersBlock`) — список персональных и групповых записей без `teacher_member_id`, быстрое назначение преподавателя.

2026-08-07 — Fix calendar-sync-worker 403 for pg_cron: `jsonResponse` пропускает CORS-проверку для запросов с валидным `x-cron-secret` (pg_net без Origin больше не получает `origin_not_allowed` поверх успешного body).

2026-08-07 — Fix Integrations infinite calendar load loop (React #185): `useEffect` для picker больше не зависит от нестабильного mutation-объекта; загрузка календарей через `listGoogleCalendars` + ref-guard на account id.

2026-08-07 — Fix Integrations crash on Google Calendar Edge Function errors: `main.tsx` больше не показывает boot-overlay на любой `unhandledrejection`; `googleCalendarApi.invokeFunction` — проверка сессии + i18n-код `errorEdgeFunctionUnreachable` для сетевых сбоев; `GoogleCalendarFreebusySection` — загрузка календарей по кнопке (не при открытии страницы); redeploy Edge Functions `google-calendar-list-calendars`, `google-calendar-freebusy`, `google-calendar-set-freebusy-config`, `google-calendar-auth-start`.

2026-08-06 — Google Calendar интеграция, регрессия (Промпт 14): `npm run lint` + `npm run build` OK; миграция `20260901000001` — пересинхронизация будущих links при смене `organization_settings.timezone`; fix stale links для `event_session` (смена org/member binding, `removeStaleRecipientLinks`); SQL-тест `google_calendar_security_test.sql` (RLS/credential isolation); `test:db:google-calendar`.

2026-08-06 — Google Calendar интеграция, Этап 5 (Промпт 13): free/busy при записи урока — миграция `20260900000001` (`freebusy_calendar_ids` на member binding); Edge Functions `google-calendar-freebusy`, `google-calendar-set-freebusy-config`; incremental OAuth consent (`consent_purpose` в auth-start); UI `GoogleCalendarFreebusySection` + предупреждение в формах урока (`useGoogleCalendarFreebusy`); fix merge `granted_scopes` при incremental consent в auth-callback.

2026-08-06 — Google Calendar интеграция, Этап 5 (Промпт 12): webhook-наблюдение и incremental sync — миграция `20260899000001` (`google_calendar_watch_channels`, outbox `incremental_sync`, RPC `enqueue_binding_incremental_sync`); Edge Functions `google-calendar-webhook` (публичный, constant-time проверка channel headers), `google-calendar-renew-watches` (cron); модуль `_shared/googleCalendarWatch.ts` (events.watch, syncToken, detach `user_deleted`); расширен `googleCalendarClient.ts` (list/watch/stop); watch register/stop при set-binding/disconnect; env `GOOGLE_CALENDAR_WEBHOOK_URL`.

2026-08-06 — Google Calendar интеграция, Этап 4 (Промпт 11): sync `calendar_event_sessions` — миграция `20260898000001` (enqueue на sessions/events, reconcile org); worker `calendarSyncEventSession.ts` (org binding + опциональная копия создателю при `sync_events`); payload `buildEventSessionGoogleEvent`; расширен `calendarSyncCommon` (org bindings, org links); Edge Function `google-calendar-set-org-binding`; UI `OrgEventsGoogleSyncSection` + `useOrgGoogleCalendarIntegration`.

2026-08-06 — Google Calendar интеграция, Этап 3 (Промпт 10): worker `group_occurrence` — модули `_shared/calendarSyncCommon.ts`, `_shared/calendarSyncGroupOccurrence.ts`; payload `buildGroupOccurrenceGoogleEvent` с `occurrenceKey`; reconcile `execute_member_group_occurrences_reconcile` (миграция `20260897000001`); hourly reconcile включает `sync_group`; fix `sync_group: true` при set-binding + backfill существующих bindings.

2026-08-06 — Google Calendar интеграция, Этап 3 (Промпт 9): миграция `20260896000001_google_calendar_group_occurrence_enqueue.sql` — enqueue `group_occurrence` для `schedule_slots` (INSERT/UPDATE/DELETE, горизонт 7/90), `schedule_occurrence_cancellations` (delete), явный enqueue в `move_group_lesson_occurrence`; RPC `run_group_occurrence_horizon_extension`; Edge Function `calendar-extend-group-horizon` (ежедневное продление горизонта).

2026-08-06 — Google Calendar интеграция, Этап 2 (Промпт 8): UI статуса синхронизации — `GoogleCalendarSyncStatusBadge` в `LessonInfoPopup` / `EditLessonPopup` (personal); хуки `useGoogleCalendarSyncStatus`, `useTeamGoogleSyncStatus`; секция команды `TeamGoogleSyncSection` на Integrations (owner/director, метрики org/участников, «Напомнить подключить»); Edge Function `google-calendar-remind-connect`; миграция `20260895000001` (RPC `get_personal_lesson_google_sync_status` + `teacher_has_binding`, outbox SELECT для teacher).

2026-08-06 — Google Calendar интеграция, Этап 2 (Промпт 6): Edge Function `calendar-sync-worker` (claim через RPC `claim_calendar_sync_jobs`, upsert/delete `personal_lesson`, retry/backoff, desired_hash, deterministic `eventId`); миграция `20260893000001_claim_calendar_sync_jobs.sql`; модули `_shared/calendarSyncPayload.ts`, `_shared/calendarSyncPersonalLesson.ts`; расширен `_shared/googleCalendarClient.ts` (events insert/update/delete/get, `obtainAccessTokenForGoogleAccount`); fix `sync_personal: true` при set-binding.

2026-08-06 — Google Calendar интеграция, Этап 2 (Промпт 5): миграция `20260892000001_google_calendar_sync_outbox.sql` — `google_calendar_event_links`, `calendar_sync_outbox`, `enqueue_calendar_sync` (схлопывание pending/retry по `dedupe_key`), триггеры на `personal_lessons` (insert/update/delete, смена даты → delete old + upsert new), RLS и RPC `get_personal_lesson_google_sync_status`.

2026-08-06 — Google Calendar интеграция, Этап 1 (Промпт 4): UI «Настройки → Интеграции» (`/settings/integrations`) — `IntegrationsSettingsPage`, хук `useGoogleCalendarIntegration`, `lib/googleCalendarApi.ts`; OAuth connect (popup), выбор/создание календаря, статус binding, verify, disconnect (оставить/удалить будущие/revoke везде); пункт `integrations` в `SettingsSectionId` и навигации настроек.

2026-08-06 — Google Calendar интеграция, Этап 1 (Промпт 3): Edge Functions `google-calendar-list-calendars`, `google-calendar-create-calendar`, `google-calendar-set-binding`; модуль `_shared/googleCalendarClient.ts` (refresh access token, calendarList, calendars.insert, коды `token_revoked` / `calendar_access_denied`). Set-binding — disable старого enabled binding, partial UNIQUE, `privacy_mode: initials`, audit_log.

2026-08-06 — Google Calendar интеграция, Этап 2 (Промпт 2): Edge Functions `google-calendar-auth-start`, `google-calendar-auth-callback`, `google-calendar-disconnect`; общий модуль `_shared/googleOAuth.ts` (PKCE S256, OIDC id_token/JWKS, AES-GCM шифрование refresh token, offline scopes `calendar.app.created` + `calendar.calendarlist.readonly`). Callback — атомарный consume `google_oauth_states`, upsert `user_google_accounts`, redirect с `?gcal=success|error`. Disconnect — org/member binding (`cleanup_pending`), account-level revoke без отзыва при org-only disconnect; `audit_log` на disconnect.

2026-08-06 — Google Calendar интеграция, Этап 1 (Промпт 1): миграция `20260891000001_google_calendar_accounts.sql` — `user_google_accounts` (encrypted refresh token, backend-only), `google_oauth_states`, `member_google_calendar_bindings`, `organization_google_calendar_bindings`; RLS SELECT для участника/owner/director; RPC `list_my_google_accounts()`; guard-триггеры на соответствие Google-аккаунта участнику; GCAL-1 в `decision_log.md`.

2026-08-06 — Google Calendar интеграция, Этап 0: зафиксированы MVP-решения (GCAL-0 в `decision_log.md`) — CRM outbound-only, отдельный календарь TangoDB, personal + group occurrence в MVP, `privacy_mode: initials`, отмена `delete`, горизонт 7/90 дней, reuse `organization_settings.timezone`, без sync аренды.

2026-08-06 — «Расходы»: автоначисления зала показывают контекст урока (клиент/группа, дисциплина, время, локация) вместо сырого `lesson`; миграция `20260890000001` + `formatFinanceCostEntryTitle` (RU/EN).

2026-08-06 — «Дебиторская задолженность»: сортировка списка (дата, имя, сумма долга) с локализацией RU/EN; по умолчанию — от прошлой даты к будущей (`FinanceDebtorsPage`, `sortDebtors` в `financeReports`).

2026-08-06 — audit finance (обзор + финансы): формулы `financeReports` (rental net в netTotal, возвраты в subscription/MoM/trend, storno в топах, split + rental); `FinancialDashboard` — ошибки запросов, extended trend/MoM, profit при ошибке RPC, teacher_expense в разбивке, gate operational analytics, drill-down `?month=`, без auto payroll/refetch; платежи/корректировки — дефолтный месяц; расходы — payee/№ документа + миграция `20260889000001`; экспорт CSV на страницах выручки/расходов; nav finance по секциям; `test:finance-reports`.

2026-08-06 — audit fixes (финансы / возвраты): серверный расчёт «разовое посещение» в `preview_subscription_refund` / `finish_subscription_with_refund` с audit-полями (`calc_mode`, rate, tariff, retained, `amount_override`); фильтр категории расходов применяется к venue accruals и сумме; CSV расходов — колонка payee; дашборд — явная кнопка «Пересчитать аренду» вместо silent recalc; режим single-visit только для групповых абонементов с тарифами разового посещения; `venue_cost_rules_are_valid` требует `expense_category`. Миграция `20260888000001`.

2026-08-05 — возврат абонемента: в диалоге «Завершить с возвратом» добавлен способ расчёта «Вычесть разовые посещения по тарифу» (sale − used × single-visit rate), с выбором тарифа разового посещения или своей суммы.

2026-08-05 — затраты студии за зал (venue cost): статья расхода и получатель (арендодателю) в правиле; начисления в финансах классифицируются как «Аренда» (или выбранная статья) с payee; «Обзор и статистика» автоматически вызывает `recalculate_pending_venue_costs` за месяц (как payroll). Миграция `20260887000001` (backfill через `app.venue_cost_org_wide_migration`). Follow-up SQL для Omow dance: payee, массовое закрытие персональных уроков, коррекция нулевых начислений — `supabase/scripts/venue_cost_followup_apply.sql`.

2026-08-05 — настройки «Аренда зала»: одновременно могут действовать несколько принятых версий правил с пересекающимися датами, если охват (дисциплина / локация / тип урока) не пересекается; миграция `20260886000001` (scoped overlap, multi-version lesson pricing); понятное сообщение `accepted_rule_overlap` в UI.

2026-08-05 — настройки «Аренда зала» (затраты студии): удаление черновика правила (RPC `delete_venue_cost_rule_draft`, кнопка в истории версий); в списке принятых правил — сводка по дисциплинам, локациям и суммам без раскрытия; fix маппинга rules (snake_case и camelCase).

2026-08-05 — настройки «Команда»: блок «Пригласить» свёрнут по умолчанию, раскрывается по клику; при повторном приглашении и после отправки — автоматически разворачивается.

2026-08-05 — audit fixes гибких правил оплаты преподавателей: миграция `20260884000001` (dual accrual index, finance view `teacher_expense`, reopen всех accruals, historical revenue, payment fallback, rule overlap/precedence, RPC write gates); безопасная миграция `830` (session flag, single-tier group rules); UI: статусы правил, org-local dates, legacy % fallback, finance `teacherPayRuleId`; тест `teacher_pay_audit_test.sql`.

2026-08-05 — гибкие правила оплаты преподавателей: миграции `20260881000001` (досрочное завершение venue cost), `20260882000001` (`teacher_pay_rules`, `group_occurrence_revenue`, payroll по closures/single_visits, expense_category), `20260883000001` (миграция teacher-scoped venue cost → teacher_pay_rules, org-wide venue cost); UI `TeacherPayRulesPanel` в профиле команды, досрочное завершение правил venue cost; venue cost per-lesson без привязки к преподавателю; bulk copy только по локациям.

2026-08-04 — fix: настройки «Аренда зала» — в полях сумм venue cost отображается валюта организации (суффикс в инпуте и подсказка «Все суммы указаны в RUB (₽)»).

2026-08-04 — fix: после оплаты персонального урока в расписании — toast «Урок оплачен» вместо технического «Сохранено · операция {op}»; плейсхолдеры `{{op}}` в строках corrections. (`offline.snapshot.window` и др.) — плейсхолдеры `{start}`/`{end}` заменены на `{{start}}`/`{{end}}` в соответствии с `t()` в `core.ts`.

2026-08-04 — fix: парный групповой абонемент считается как 2 присутствующих при закрытии урока, в отчёте проведённых занятий и в заполняемости на дашборде (`groupSubscriptionParticipantCount`, `countPresentAttendeesFromSubs`, миграция `20260880000001_pair_subscription_attendance_count.sql`).

2026-08-04 — разовое посещение: тариф стал необязательным — можно указать только сумму (договорённая цена вне прайса); `record_single_visit` принимает `p_price_id = NULL` при `p_amount > 0`; миграция `20260879000001_single_visit_optional_tariff.sql`; UI `AttendancePanel`.

2026-08-04 — fix: переоткрытие урока без причины — понятное сообщение «Пожалуйста, укажите причину переоткрытия урока» вместо технического `reason_required` (`formatReopenLessonError`, `AttendancePanel`, `LessonInfoPopup`, `PersonalLessonRow`).

2026-08-04 — журнал посещений и персональные уроки: (1) разовое посещение — поле «Сумма» стало редактируемым (было read-only, показывало только цену тарифа); RPC `record_single_visit` принял опциональный `p_amount`. (2) частичная оплата персонального урока — `personal_lessons.paid_amount` копит чистую сумму оплат, `record_personal_lesson_payment` разрешает несколько платежей на один урок вместо блокировки после первого, `void_personal_lesson_payment` сторнирует все активные платежи урока; `PayPersonalLessonModal` показывает «Оплачено» / «Долг» и подставляет остаток долга по умолчанию; `AttendancePanel` и `PersonalLessonRow` показывают остаток долга; `financial_debtors_v`/`useScheduleDebtors` считают долг персонального урока как остаток, а не полную цену. Миграция `20260878000001_custom_amount_payments.sql`.

2026-08-03 — расписание: поле «Вместимость группы» в форме создания и редактирования группового урока (`AddGroupLessonForm`, `EditLessonPopup`, `SchedulePanel`); при создании лимит сохраняется через `update_class_max_capacity` после insert слотов.

2026-08-03 — fix: продажа абонемента — `idempotency_conflict` при повторной отправке: ключ оплаты привязан к `subscriptionId`, а не к сессии формы.

2026-08-03 — fix: продажа абонемента — RPC `create_group_subscription` ссылался на несуществующий `clients.deleted_at` вместо `archived_at`; то же в `add_group_waitlist_entry` и `replace_subscription_partner`.

2026-08-03 — fix: продажа абонемента — в «Групповые уроки» показываются только группы с занятиями в расписании ±30 дней от текущей даты (`filterGroupsScheduledInDateRange`).

2026-08-03 — fix: создание парного группового тарифа с произвольным числом уроков (например 12) — `resolveGroupPriceType` больше не ограничивает парные абонементы только 4/8 занятиями.

2026-08-03 — тарифы и прайс-лист: hard-delete заменён на soft archive (`prices.status`, `created_at`, `archived_at`); активные тарифы скрывают архивные во всех формах продажи; добавлена вкладка «Архив» со сроком действия, числом оформленных продаж и восстановлением тарифа; агрегат архива читается через tenant-scoped RPC `list_archived_prices`.

2026-08-03 — fix: в журнале посещений кнопка оплаты персонального урока — «Оплатить» вместо «Оплатил» (`common.pay` в `AttendancePanel`).

2026-08-03 — fix: запись персонального урока с оплатой — `PersonalLessonSaleForm` передавал в RPC `record_personal_lesson_payment` составной idempotency key `uuid:uuid` вместо одного UUID; PostgreSQL отклонял значение.

2026-08-03 — fix: белый экран при загрузке — `supabase.ts` читает `import.meta.env.VITE_SUPABASE_*` напрямую (Vite не инлайнит env при доступе через промежуточную переменную).

2026-08-03 — hall-rent финал: интеграционная проверка контура аренды — `test:hall-rent-integration` (RBAC, venue/rental node-checks, 13 SQL-тестов на linked DB); JWT helper `_hall_rent_test_set_jwt`; миграции 710–750: ambiguous `record_rental_payment` / `schedule_location_has_conflict` / `cancel_rental_series_occurrence`, `preview_rental_conflicts` client join, cancellation advance без `notes`, scoped rental payment idempotency, порядок `confirm_venue_cost_rule_gap`; правки SQL-тестов (license, динамические даты, cleanup).

2026-08-03 — hall-rent этап 23: бухгалтер создаёт/правит слот аренды — permission `rentals.write` (accountant + operational admin); SQL `member_can_create_rental()`; UI `EditRentalSlotModal`, create из inbox и карточки арендатора; `RentalInfoPopup` cancel/edit slot через `rentals.write`; RBAC-тесты.

2026-08-03 — hall-rent этап 22: кассовый inbox неоплаченных аренд — RPC `list_rental_payment_inbox` (бакеты today/overdue/partial/overpaid/queue, effective amount, пагинация); `useRentalPaymentInbox`, `FinanceRentalInboxPage` (`/finance/rental-inbox`); доступ `rentals.payments.write` / `canAccessRentalInboxRoute`; навигация для admin-кассира без полного finance; `test:rental-payment-inbox`, `test:db:rental-inbox`.

2026-08-03 — hall-rent этап 21: калькулятор ожидаемых затрат venue cost — `venueCostEstimate.ts` (matching как `venue_cost_amount_for_lesson`, fixed-period окна, breakdown); `useVenueCostEstimate` + `VenueCostEstimatePanel` в настройках; `expandSlotsToDateRange`; `findMatchingAttendanceTier` / `matchScopedRule` в `venueCostRules.ts`; тесты в `test:venue-cost-preview`.

2026-08-03 — hall-rent этап 20: UI / ошибки / язык контуров (F5, F9, F11, F12) — убраны карточки-в-карточке в embedded `VenueCostsSettingsPage`; список ошибок venue draft по кодам (`venueCostDraftErrors.ts`); role-aware empty states; разведены термины дохода «сдача зала» и расхода «затраты студии» в i18n (финансы, закрытие урока); `hallRent.emptyNoAccess`; расширен `test:venue-cost-preview`.

2026-08-03 — hall-rent этап 18: массовое копирование правил venue cost — `venueCostBulkCopy.ts` (plan/apply teachers + locations, duplicate/ambiguous detection); `VenueCostBulkCopyPanel` в per-lesson редакторе; валидация ambiguous/duplicate в `validateVenueCostDraft`; i18n RU/EN; расширен `test:venue-cost-preview`.

2026-08-03 — hall-rent этап 17: первичка и фискальные реквизиты (F24, F25) — `rental_billing_profile` в `organization_settings`; нумерация/версии/НДС на `rental_invoices`; фискальные поля на `rental_payments` / `rental_invoice_payments`; RPC issue/export/document + `update_rental_payment_fiscal`; UI настройки в `/settings/hall-rent`, документ счёта и фискальные поля в оплате; тесты `test:db:rental-fiscal-documents`, `test:rental-billing-profile`.

2026-08-03 — hall-rent этап 14: fixed-period venue cost по локациям + архив тарифов (F1, F8) — `VenueCostFixedRules.locations[]`, миграция `venue_cost_accruals.location_id`, UI scope в `VenueCostsSettingsPage`; `RentalTariffsSettingsPage`: статус active/archived, фильтры, группировка по локации; create dialogs по-прежнему `status: active`; тесты `test:venue-cost-preview`, `test:rental-tariff-archive`, `test:db:venue-cost`, `test:db:rental-tariff-lookup`.

2026-08-03 — hall-rent этап 13: тариф → сумма при создании (F7, F14, F15) — `CreateRentalDialog`: fixed-тариф автоподставляет цену; сумма/тариф/оплата для кассового gate (`canSeeRentalTariffPrices` / `rentals.payments.write`); подсказка hourly-only для серий (вариант B); override с причиной; SQL `preview_rental_pricing`, `create_rental` gates через `member_can_record_rental_payment()`; `lib/rentalTariffPricing.ts`; тест `test:db:rental-create-gate`.

2026-08-03 — hall-rent этап 12: read-only прайс для admin + политика reception — SQL `member_can_see_rental_tariff_prices()` (= кассовый gate); `list_rental_tariffs` отдаёт цены кассиру; UI lookup в `/settings/hall-rent`, ссылки из расписания; `canSeeRentalTariffPrices`; reception вне контура; тест `test:db:rental-tariff-lookup`.

2026-08-03 — hall-rent этап 11: финансовое действие при отмене аренды (F26) — RPC `cancel_rental` / `cancel_rental_series_occurrence` с `refund`, `transfer_to_advance`, штрафами; сторно через регистр + аванс; UI `CancelRentalModal` (разовая и серия); i18n RU/EN; тест `test:db:rental-cancellation`.

2026-08-03 — hall-rent этап 10: UI счетов и авансов, отчёт начислений (F20, F23) — RPC `list_renter_rental_advances`, `list_renter_rental_advance_allocations`, `get_rental_accrual_report`; `operation_date` на оплате счёта и авансе; модалки в карточке арендатора (счёт, оплата, аванс, allocate/отмена); страница `/finance/rental-accruals`; тест `test:db:rental-invoices-ui`.

2026-08-03 — hall-rent этап 9: operation_date и закрытие периода (F22) — колонка `operation_date` на rental money tables; `finance_period_closed_until`; helpers `_org_local_date`; `record_rental_payment(p_operation_date)`; регистр и отчёты по `operation_date`; UI даты в `RecordRentalPaymentModal`; аудит обеих дат; тест `test:db:rental-operation-date`.

2026-08-03 — hall-rent этап 8: должники аренды, сторно и автор платежа (F16, F18, F27) — `financial_debtors_v` + вкладки «Аренда зала»; RPC `storno_rental_payment` / `correct_rental_payment`; регистр с `direct_booking_storno`; `created_by` в popup/журнале/CSV; UI `RentalPaymentCorrectionDialog`; отчёт коррекций; тест `test:db:rental-corrections`.

2026-08-03 — hall-rent этап 15: прозрачная история версий venue cost (F10, F28) — `acceptedBy` в `mapVenueCostVersion`; раскрываемая read-only матрица правил; «Копировать в черновик» без изменения accepted; diff draft vs active (add/change/remove); i18n RU/EN; расширен `test:venue-cost-preview`.

2026-08-03 — hall-rent этап 7: права бухгалтера на venue cost и read тарифов — SQL `member_can_manage_venue_cost_rules()`, `list_rental_tariffs` для `manage_rentals OR finance.read`, RLS read тарифов; UI `canReadTariffs` / `canWriteTariffs` / `canManageVenue`; `canAccessSettingsSection("hall-rent")` не сужает путь admin (stage 12); RBAC tests.

2026-08-03 — hall-rent этап 3: корректное превью venue cost (F4) — scope-превью с выбором преподавателя/локации/дисциплины в `VenueCostGroupPreview`; хелперы `defaultGroupPreviewScope` / `computeGroupPreviewPair`; подсказка вместо ложного «0» без контекста; расширен `test:venue-cost-preview`.

2026-08-02 — hall-rent этап 6: правка суммы брони (F29) — UI `EditRentalAmountModal` в `RentalInfoPopup` (разовая и occurrence серии); RPC `apply_rental_pricing_adjustment` с gate `member_can_adjust_rental_amount()` (= кассовый gate этапа 1); accountant через узкий RPC без `manage_rentals`; hard block `new < paid` (включая 0); аудит в `rental_pricing_adjustments`; fix `update_rental` (восстановлен `fixed_amount`); тест `test:db:rental-amount-adjustment`.

2026-08-02 — hall-rent этап 5: единый регистр денег аренды (F20, F21) — SQL view `rental_money_register_v` + RPC `list_rental_money_register` (прямые платежи, счета, авансы, депозит receive/return; без allocate/apply_to_invoice); фронт `useRentalMoneyRegister`, агрегаты журнала/выручки на регистре; тесты `test:db:rental-register`, `test:finance-rental-aggregates`.

2026-08-02 — hall-rent этап 4: аренда в кассовых агрегатах (F17, F31) — `count`/`byMethod` включают `rental_payments` через `buildExtendedRevenueStats`; журнал платежей — секция аренды + фильтр источника; `RecordRentalPaymentModal` — поле комментария к методу и confirm переплаты (F19); assert `test:finance-rental-aggregates`.

2026-08-02 — hall-rent этап 2: единая effective amount (F32) — `record_rental_payment`, `list_renter_rentals`, `_renter_debt_total`, `get_renter_detail` считают по `_rental_effective_amount`; фронт `lib/rentalAmount.ts` + остаток в popup/модалке/сетке/карточке арендатора; assert `test:rental-effective-amount` и SQL `test:db:rental-effective-amount`.

2026-08-02 — hall-rent этап 1: кассир (full operational admin с приёмом платежей) видит сумму/остаток аренды и принимает оплату без `finance.read`; permission `rentals.payments.write` + SQL `member_can_record_rental_payment()`; rose-ring и сумма долга на блоке аренды; история платежей в `get_rental_detail` для кассы; reception/teacher вне контура.

2026-08-02 — venue costs: убрано поле валюты (берётся из настроек CRM); режим «Фиксированный период» → «Фиксированная оплата»; чекбоксы включения правил для групповых и персональных уроков.

2026-08-01 — sidebar: «Финансы» остаётся выделенным на всех подстраницах `/finance/*`; в «Истории абонементов» подсвечивается «Абонементы».

2026-08-01 — расписание: кнопки «Мероприятие» / «Аренда» / «Отпуск преподавателя» — sentence case (`btnOpenCls` без uppercase); блок «Неоплаченные персональные уроки» свёрнут по умолчанию.

2026-08-01 — Журнал платежей: группировка по месяцам (свёрнуто: месяц, кол-во/сумма платежей и возвратов); у сторно — форма возврата (дата, кто оформил, способ, причина).

2026-08-01 — header: кнопки Email/Telegram/WhatsApp — `btnHeaderContactCls` (h-8), как «Выйти».

2026-08-01 — design system: поля поиска унифицированы через `searchFieldCls` (h-8) — Платежи, Корректировки, Действующие абонементы, Клиенты, Арендаторы, персональные уроки.

2026-08-01 — design system: primary add/save/submit кнопки переведены на `btnAddCls` (sentence case, h-8) в ~40 компонентах; соседние cancel — `btnCancelCls`.

2026-08-01 — header: кнопка «Выйти» — h-8, как остальные контролы.

2026-08-01 — design system: компактные контролы h-8 (эталон — Telegram в header); add/save-кнопки без uppercase по всему CRM.

2026-08-01 — design system: типы кнопок в `buttonStyles.ts` (add/open/destructive/refresh); «Создать правило»; amber убран из UI-кнопок.

2026-08-01 — tangodb настройки: «Тарифы аренды» и «Затраты на зал» объединены в раздел «Аренда зала» (`/settings/hall-rent`); понятные подписи — сдача арендаторам vs затраты студии на занятия; в правилах затрат обязателен выбор преподавателя (UI + миграция матчинга).

2026-08-01 — tangodb FinanceExpensesPage: кнопка «Создать правила» / «Управление правилами» в секции «Аренда по правилам» (owner/director → `/settings/venue-costs`, `?new=1` открывает редактор); баннер expiry при просроченном правиле.

2026-07-31 — tangodb Finance «Корректировки»: исправлен счётчик записей (pluralize); «Платёж #N» на одной строке; после аннулирования показывается только сторно (исходный платёж скрыт); понятные подписи «Аннулирование» / «Новый платёж», перевод причин.

2026-07-31 — tangodb FinancialDashboard: при загрузке финансовых метрик показывается «Загрузка...» со спиннером вместо нулей (доход, абонементы, дебиторка, расходы, прибыль, occupancy и др.).

2026-07-31 — tangodb dashboard: «Платежи за сегодня» показывают сторно (отмену) красным с минусом и подписью «Сторно», счётчик — только реальные оплаты; `usePayments` возвращает `operation_kind`.

2026-07-31 — tangodb venue-cost polish: React Query cache для pre-payment ack; invalidate closures после close/reopen; FinanceExpensesPage не тянет venue costs без диапазона дат; dashboard показывает «—» для venue при ошибке RPC; LessonInfoPopup грузит personal lessons по месяцу.

2026-07-31 — tangodb venue-cost hardening: payment wrappers передают idempotency key во inner RPC; PersonalLessonSaleForm не пересоздаёт уроки при ack (pending payments); убран ungated close из PayPersonalLessonModal; batch closures в списке personal; gate close/settings; finance costs error state.

2026-07-31 — tangodb UI venue-cost: reopen закрытых уроков (журнал / personal row / LessonInfoPopup) через `useActive*LessonClosure` + RPC; CSV расходов уже включает auto-начисления.

2026-07-31 — tangodb finance venue-cost: CSV-экспорт расходов включает auto-начисления аренды; FinanceExpensesPage показывает единый total (manual + venue).

2026-07-31 — tangodb UI venue-cost: настройки `/settings/venue-costs`, dashboard-баннер expiry, confirmation при оплатах (абонемент/персональные/разовые), закрытие урока в журнале и popup оплаты, `useFinanceCosts` в dashboard/expenses, i18n RU/EN.

2026-07-31 — tangodb frontend venue-cost: i18n/settings/route/RBAC; Dashboard expiry notice; payment ack dialogs (subscriptions/single-visit/personal); close-lesson hooks+UI (AttendancePanel, LessonInfoPopup, PersonalLessonRow); `useFinanceCosts` + FinancialDashboard/FinanceExpensesPage venue totals; revenue includes rental/other_income; `useRecordPayment` soft-deprecated to RPC.

2026-07-31 — tangodb backend venue-cost follow-up: статус gap не скрывается будущей принятой версией и включает pending count; правила поддерживают location+discipline precedence с tenant-reference validation; закрывать урок может операционный admin/assigned teacher без выдачи суммы; удаление personal lesson сохраняет closure snapshot/source id; payment wrappers совместимы с legacy idempotency fingerprints и не создают ack для ранее существующего payment.

2026-07-31 — tangodb backend: добавлены версионируемые правила внутренних расходов на зал (`per_lesson` / `fixed_period` / `disabled`), явное закрытие и переоткрытие уроков с append-only начислениями, pending-unpriced/recalc, expiry acknowledgement для канонических payment RPC, единый отчёт расходов и SQL regression suite.

2026-07-31 — tangodb: Finance «Платежи» — разворачиваемые строки с полной информацией: преподаватель, зал, кто и когда принял оплату; в запрос добавлен `created_by`.

2026-07-31 — tangodb: Finance «Платежи» — кнопка исправления платежа: иконка редактирования вместо текста «Исправить», стиль icon-button как в расходах.

2026-07-31 — tangodb: fix Finance «Коррекции» — маппинг snake_case из RPC `get_corrections_report`; защита `formatCurrency` и `formatDateTimeLocale` от undefined.

2026-07-31 — tangodb: удалены 836 personal_lessons с 2026-09-01 (org Omow dance); script `delete-personal-lessons-from-date.mjs`.

2026-07-31 — tangodb: fix delete_personal_lesson — orphan journal payments before delete (invalid client_id / payments_source_check on FK SET NULL).

2026-07-31 — tangodb: fix delete_personal_lesson — после полного сторно можно удалять урок (проверка net payment, не наличие строк payments).

2026-07-31 — tangodb: fix `_storno_payment_impl` — `v_member_id` → `p_member_id` (ошибка при аннулировании платежа).

2026-07-31 — tangodb: popup удаления персонального урока — кнопка «Удалить все уроки в будущем» для weekly-серии (RPC `delete_personal_lesson_series_from_date`, ConfirmDialog alternate action).

2026-07-31 — tangodb: отменены payments за будущие calendar-уроки (961 урок с 2026-08-03, paid=no; цена тарифа сохранена).

2026-07-31 — tangodb: удалены 77 personal_lessons Екатерина/Танго пт 14:30–15:30 с 2026-07-03 и 119 связанных payments.

2026-07-31 — tangodb: fix ballroom trio tariff — 15 уроков переведены с «Индивидуальный Трио» на «Бальные Трио Дети» (600000).

2026-07-31 — tangodb: calendar import payments — 1624 personal_lessons привязаны к тарифам и отмечены оплаченными (payments + price); script link-calendar-lesson-payments.mjs.

2026-07-31 — tangodb: calendar import conflicts resolved — удалены слоты ср/чт «Группа» и ср «Танго» 20:00; импортированы 24 пропущенных индива; СФП Алиса 13/15.04 не дублировались; Ксения+Иван как pair.

2026-07-31 — tangodb: calendar import apply — 1600 personal_lessons в org Omow dance (Miami studio); 26 пропущено (конфликт с групповым расписанием 20:00 и 2 дубля); `--skip-db-conflicts`, сопоставление дисциплин по имени с существующей «Танго».

2026-07-31 — tangodb: calendar import — ручное разрешение 11 cross-client конфликтов (calendar_manual_resolutions.json), 0 нерешённых пересечений.

2026-07-31 — tangodb: calendar import — сальса индив с Лизой под дисциплиной «Биомеханика танца»; авто-разрешение 7 пересечений (дубли одного клиента), 11 cross-client в calendar_conflicts.json.

2026-07-31 — tangodb: calendar import — добавлены СФП, биомеханика, сальса; канонизация имён клиентов (Алиса Чакур/Кононова, Ева Петрова/Вильданова, Соломея, Соня, Настя→Анастасия).

2026-07-31 — tangodb: импорт индивидуальных занятий из Google Calendar ICS (`scripts/ics-to-personal-lessons.mjs`, `scripts/import-calendar-lessons.mjs`, `data/import/albertkoall/calendar_personal_lessons.json`); бальные + танго с 2025-09-01.

2026-07-31 — tangodb: fix preview_calendar_event_conflicts — восстановлена сигнатура `(jsonb, uuid)` после hall_rentals, исключены отменённые групповые занятия; popup создания мероприятия не показывает текст про конфликты при ошибке проверки.

2026-07-31 — tangodb: popup «Отпуск преподавателя» — на мобильном кнопка «Отменить N занятий» с иконкой выровнена по центру (вертикальный футер, `shrink-0` у иконки).

2026-07-31 — tangodb: popup «Новая аренда зала» — переименованы поля «Фиксированная стоимость» → «Стоимость аренды», «Оплата при создании» → «Оплачено» (i18n ru/en).

2026-07-30 — tangodb: fix mark_attendance — `v_sub subscriptions%ROWTYPE` вместо `RECORD` для вызова `resolve_subscription_freeze_policy` (ошибка «cannot cast type record to subscriptions» в журнале посещений).

2026-07-30 — tangodb: редактирование группового занятия в расписании — исправлена ложная ошибка «Выберите преподавателя» при сохранении после смены группы (fallback teacherMemberId, форма не сбрасывается при refetch scheduleSlots).

2026-07-30 — tangodb: право `meta.can_edit_past_schedule` — создание/редактирование записей расписания в прошлом (UI + RPC `delete/update_personal_lesson`, SQL `can_edit_past_schedule()`); выдано albertkoall@gmail.com в org Omow dance.

2026-07-30 — tangodb: создание разовой аренды зала стало прямым сценарием — CTA «Создать аренду», фоновая проверка занятости и экран возврата к форме только при реальном пересечении.

2026-07-30 — tangodb: создание мероприятия в расписании стало прямым сценарием — явный выбор «Мастер-класс»/«Открытый урок», CTA «Создать», фоновая проверка расписания и отдельное подтверждение отмен только при реальных пересечениях.

2026-07-30 — tangodb: popup «Новое мероприятие» — выбор времени через `TimeSelect` с шагом 15 минут (вместо `<input type="time">` с произвольными минутами).

2026-07-30 — tangodb: верхний блок «Расписание» приведён к общему стилю панелей (`panel-card-stack`, заголовок h2 как в «Журнале посещений», кнопки навигации по дате — как в фильтрах личных уроков).

2026-07-30 — tangodb: UI «Арендаторы» — вкладки «Активные/Архив/Заблокированные» визуально соединены со списком через `pageTabPanelCls` (как в «Клиентах»). Расписание — верхняя панель в одной карточке: дата и календарь → преподаватель → мероприятие → аренда → отпуск.

2026-07-30 — tangodb: страница «Арендаторы» — поле поиска выровнено по нижнему краю с селектами фильтров (`sm:items-end` в `RentersPanel`).

2026-07-30 — tangodb: фронтенд долгосрочной аренды с тарифами (CRM сценарий 14) — типы RentalTariff/RentalSeries/RentalInvoice, хуки useRentalTariffs/useRentalSeries/useRentalInvoices, страница настроек `/settings/rental-tariffs`, диалоги CreateRentalSeriesDialog и расширения RentalInfoPopup/CreateRentalDialog/FinanceTab арендатора, маршрут и RBAC, i18n rentalTariffs.* / rentalSeries.* / rentalInvoices.*, интеграция серии в расписание, rentalSeriesId в useRentals.

2026-07-30 — tangodb: долгосрочная аренда с тарифами (CRM сценарий 14) — миграция `20260845000001_rental_series_tariffs.sql`: таблицы тарифов/серий/счетов/авансов/депозитов, серверный расчёт почасовых и фиксированных ставок с льготными правилами, RPC preview/create/update/cancel серии, инвойсы и финансовые операции, патч `create_rental` (tariff_id) и `get_rentals_for_schedule_week` (rental_series_id), RLS и grants.

2026-07-30 — tangodb: фронтенд CRM арендаторов (сценарий 13) — раздел `/renters`, типы и хуки `useRenterCrm`/`useRenters` (list_renters RPC, upsert, contacts/contracts/documents/communications), RBAC `renters.*`, панели списка и карточки с вкладками, диалог дублей, интеграция с CreateRentalDialog и audit log.

2026-07-30 — tangodb: база арендаторов CRM (сценарий 13) — миграция `20260844000001_renters_crm.sql`: расширение `renters`, таблицы контактов/договоров/документов/коммуникаций, RPC list/detail/upsert/archive/duplicates, bucket `renter-documents`, RLS и audit, патч `create_rental`/`update_rental` для блокировки archived/blocked арендаторов.

2026-07-30 — tangodb: разовая аренда зала без преподавателя (CRM сценарий 12) — таблицы `renters`, `rentals`, `rental_payments`, RPC create/update/cancel/payment с проверкой конфликтов и advisory lock, тип «Аренда» в расписании (янтарный блок), role-aware `get_rentals_for_schedule_week`, выручка и CSV-экспорт источника «Аренда».

2026-07-30 — tangodb: явные ограничения офлайн-режима (CRM сценарий 11) — в журнале посещаемости скрыты personal-уроки, блок single-visit с черновиком-напоминанием, баннер `OfflineScopeNotice`, продажа абонемента/пакета офлайн сохраняет draft без финансового эффекта, `OfflineLimitedState` показывает локации снимка.

2026-07-30 — tangodb: безопасный офлайн-режим вечерней смены (CRM сценарий 11) — IndexedDB-снимок расписания/абонементов (72 ч), очередь офлайн-отметок посещаемости с idempotency (`sync_offline_mark_attendance`), экран сверки после восстановления, черновики оплат без финансового эффекта, изоляция по user/org, cross-tab sync lock, `QueryErrorState` retry, расширенный `OfflineBanner`.

2026-07-30 — tangodb: промпт 10 — idempotency на personal/single-visit платежах, undo посещаемости (30 с) + диалог коррекции с причиной, payroll по net_amount через payroll_refresh_settlement_lines.

2026-07-30 — tangodb: досрочное завершение абонемента с возвратом (CRM сценарий 9) — таблица `subscription_refunds`, RPC `preview_subscription_refund` / `finish_subscription_with_refund`, диалог «Завершить с возвратом», формула `sale_price × lessons_left / lessons_total`, чистая выручка (поступления − возвраты) в дашборде и «Выручке», зарплатная корректировка по проценту преподавателя.

2026-07-30 — tangodb: детализация собственной зарплаты преподавателя (CRM сценарий 8) — таблица `teacher_settlement_line_items`, перерасчёт с построчным снимком и историческими ставками на дату платежа, RPC `get_teacher_settlement_detail`, раскрываемые карточки месяца в `TeacherOwnPayrollView` с контрольной сверкой суммы строк и `amount_accrued`.

2026-07-29 — tangodb: замена партнёра — доработка ограничений: журнал посещаемости показывает состав на дату, запланированные замены применяются при загрузке абонементов, в карточке клиента — история участия с периодом.

2026-07-29 — tangodb: замена партнёра в парном абонементе (CRM сценарий 7) — таблица `subscription_member_changes`, RPC `replace_subscription_partner`, диалог «Заменить партнёра» в карточке активного pair/pair_hm абонемента, история состава, эффективный состав на дату для посещаемости и вместимости группы.

2026-07-29 — tangodb: вместимость групп и лист ожидания (CRM сценарий 6) — `classes.max_capacity`, RPC `create_group_subscription` / `get_groups_capacity_snapshot` / waitlist / override audit, блокировка продажи при переполнении, owner-director override с причиной, очередь и уведомление об освобождении места после `finish_subscription`.

2026-07-29 — tangodb: заморозка группового абонемента на диапазон дат (CRM сценарий 5) — таблица `subscription_freeze_periods`, RPC `apply_subscription_freeze_period` / `cancel_subscription_freeze_period`, переопределение политики на тарифе, продление `expires_at` для monthly_unlimited, диалог и история в карточке абонемента, `mark_attendance` учитывает активный период.

2026-07-29 — tangodb: отчёт по проведённым групповым урокам (CRM сценарий 4) — поле `disciplines.category`, RPC `get_conducted_group_lessons_report`, блок на «Настройки → Данные» с preview и CSV `lessons_YYYY-MM-DD_YYYY-MM-DD.csv`; источник «проведено»: occurrence не отменён и время окончания прошло (TZ организации).

2026-07-29 — tangodb: мероприятия — редактирование сессий (`update_calendar_event_with_cancellations`), preview конфликтов с учётом других мероприятий и exclude event id; список всех сессий в попапе.

2026-07-29 — tangodb: мероприятия — редактирование (`update_calendar_event`) и дозапись оплаты (`record_calendar_event_payment`) после создания; UI в попапе мероприятия.

2026-07-29 — tangodb: мероприятия/мастер-классы — `calendar_events`, `calendar_event_sessions`, `other_income`, RPC `preview_calendar_event_conflicts` и `create_calendar_event_with_cancellations`, мягкая отмена `personal_lessons` (`cancelled_at`), блок violet в расписании, диалог создания с preview конфликтов, учёт прочего дохода в «Выручке».

2026-07-29 — tangodb: расписание — журнал отмен (`schedule_occurrence_cancellations`), блок «Ближайшие отменённые занятия», отпуск преподавателя (RPC `cancel_teacher_group_vacation`, UI в расписании и команде); удалена мёртвая клиентская `cancelGroupLessonOccurrenceByDate`.

2026-07-29 — tangodb: расписание — атомарная пакетная отмена нескольких occurrence регулярного группового занятия (RPC `cancel_group_lesson_occurrences`, диалог с режимом «одна дата / диапазон», превью списка дат, подтверждение «Отменить N занятий»).

2026-07-28 — tangodb: расписание — атомарный перенос одного occurrence регулярного группового занятия (RPC `move_group_lesson_occurrence`, кнопка «Перенести это занятие», метаданные `moved_from_*`, проверка конфликтов на клиенте и сервере).

2026-07-19 — tangodb: расписание — метки времени слева над часовой линией, без перекрытия серой границей (`WeeklyScheduleGrid`).

2026-07-19 — tangodb: расписание — смена недели не сворачивает таблицу локации (без полноэкранного LoadingState); колонка текущего дня подсвечена светло-серым (`SchedulePageContainer`, `useScheduleForWeek`, `DayColumn`, `WeeklyScheduleGrid`).

2026-07-19 — tangodb: групповые уроки — повтор N недель / до даты в popup «Новое занятие» и «Редактирование»; по умолчанию одно занятие на выбранную дату; кнопка «Отменить одно занятие» в popup расписания (split слота без удаления серии).

2026-07-09 — tangodb-landing: палитра CTA и акцентов — terracotta/amber/violet/emerald заменены на indigo-600 (как логотип); кнопки `.btn-cta`, бейджи hero/pricing, блок поддержки, иконки features.

2026-07-09 — tangodb-landing: Cloudflare Web Analytics beacon в `index.html` (token site `tangodb-landing.pages.dev`).

2026-07-05 — Auth: полностью удалён вход через Telegram — убран auto-login в `AuthProvider` (Mini App bootstrap), `signInWithTelegram`, `TelegramRecoveryGate`, edge function `telegram-auth` и `_shared/telegramVerify.ts`; закомментированный UI на `/login` очищен. Контакты клиентов/команды и экспорт в Telegram Mini App без изменений.

## Формат

```
YYYY-MM-DD — краткое описание (причина / контекст)
```

2026-07-05 — tangodb-landing: синхронизирован EN-копирайт с RU — CTA «Start free», hero/pricing/FAQ, убраны подсказки про email и карту (`en.ts`).

2026-07-04 — tangodb-landing: обновлён RU-копирайт — CTA «Начать бесплатно», новые формулировки hero/pricing/FAQ, убраны подсказки про email и карту (`ru.ts`, `Hero.tsx`, `PricingSection.tsx`).

2026-07-03 — tangodb-landing: fix CI deploy — pinned wrangler 4, `CLOUDFLARE_ACCOUNT_ID` в env, прямой `wrangler pages deploy` вместо wrangler-action v3.

2026-07-03 — tangodb-landing: секция Platform — новый копирайт RU/EN, мобильный превью из живого UI вместо скриншота (`CrmMobilePreview.tsx`, `PlatformSection.tsx`, `ru.ts`, `en.ts`; удалён `CrmMobilePlaceholder.tsx`).

2026-07-03 — tangodb-landing: копирайт RU — «уважительный пропуск» вместо «заморозка», «Версия для ПК» вместо «Десктопная CRM», «Большой экран» вместо «Широкий layout» (`ru.ts`).

2026-07-03 — tangodb: сняты partial unique indexes на prices (type+lessons+location+discipline) — несколько тарифов с одной привязкой, разными названием/ценой; fix duplicate key при редактировании абонемента (migration `20260817000001`).

2026-07-03 — tangodb: post-import — локация Miami studio, price_id/discipline на абонементах, subscription_groups и payments из legacy (`import-postprocess.mjs`, `fix-import-postprocess.mjs`, `--default-location-name` в import-org); fix org `8da4b806-…` (43 payments).

2026-07-03 — tangodb: legacy import в org `8da4b806-…` (Omow dance) — clients/prices/schedule/subscriptions/attendance/personal; fix import-org (group_name, classes, schedule_group_id, personal times).

2026-07-03 — dev-console Tenants: колонка UUID с копированием; поиск по email без @, UUID org и owner через organization_members (`OrgsPage.tsx`, `dev-console-list-tenants`).

2026-07-03 — tangodb: конвертер legacy Excel → `tangodb_export.json` для `import-org.mjs` (`scripts/xlsx-to-export.py`, `data/import/albertkoall/`); маппинг `MonthsPaid`→`PairMonth`, нормализация ID/дат.

2026-07-02 — tangodb-landing: мобильный скриншот CRM в секции Platform; демо-CRM приведена к оболочке prod (нижние табы, sidebar/header, drawer), строки и финансовый дашборд синхронизированы с tangodb, данные в ₽ (`crm-mobile-overview.png`, `CrmMobilePlaceholder.tsx`, `CrmDemoApp.tsx`, `DashboardPanel.tsx`, `crm/strings.ts`, `crm/data.ts`). — `is_platform_developer_email`, обход `demo_owner_retention`/Turnstile/captcha для `platform_role=developer` (migration `20260816000001`, edge functions).
2026-07-02 — tangodb: fix self-service demo routing — вход и CRM без membership ведут на `/auth/verify-email` для автосоздания 30-дневного демо; `/activate-key` только после исчерпания демо-квоты email (`LoginPage`, `routeGuards`).
2026-07-02 — tangodb: после исчерпания бесплатного демо — редирект на `/activate-key` вместо бессмысленного retry на verify-email; вход без org ведёт на активацию ключа (`VerifyEmailPage`, `LoginPage`, `routeGuards`, `ActivateKeyPage`, i18n).
2026-07-02 — tangodb: captcha на странице подтверждения email — если challenge истёк или отсутствует, показывается Turnstile вместо ошибки «вернитесь на Регистрацию»; challenge списывается только после pre-flight проверок (`VerifyEmailPage.tsx`, `authErrors.ts`, i18n, migration `20260815000002_self_service_challenge_consume_order.sql`).
2026-07-02 — tangodb-landing: правки копирайта и UI — H1 hero на 4 строки, новый текст demoHint, «Личные уроки» выключены в «Сеть школ», иконки вместо превью во «Всё внутри CRM» (`Hero.tsx`, `ru.ts`, `en.ts`, `ModularitySection.tsx`, `CrmCapabilities.tsx`; удалён `CrmPanelThumbnail.tsx`).
2026-07-02 — tangodb-landing: производительность изображений — hero через `<picture>` (AVIF/WebP srcset + JPG fallback), preload LCP, aspect-ratio против CLS; og-image.jpg для шеринга; display-sized ассеты в `public/` (`Hero.tsx`, `config.ts`, `index.html`, `CrmMobilePlaceholder.tsx`; промт 16 аудита).
2026-07-02 — tangodb-landing: иконки и мини-превью — разные цвета иконок в Features (4 карточки), мини-превью реальных панелей демо в CrmCapabilities, компактные dashed-иконки для остальных разделов (`Features.tsx`, `CrmCapabilities.tsx`, `CrmPanelThumbnail.tsx`, `App.tsx`; промт 15 аудита).
2026-07-02 — tangodb-landing: визуальный ритм страницы — чередование фонов секций (белый / slate-50 / тёмный), порядок Demo → CRM → Platform, тёмный footer (`App.tsx`, `Features.tsx`, `DemoSection.tsx`, `CrmCapabilities.tsx`, `PlatformSection.tsx`, `PricingSection.tsx`, `FaqSection.tsx`, `Footer.tsx`; промт 13 аудита).
2026-07-02 — tangodb-landing: секция «Компьютер и смартфон» — десктопный превью из демо UI, placeholder для мобильного скриншота, блок поддержки с тёплым фоном и Telegram (`PlatformSection.tsx`, `CrmDesktopPreview.tsx`, `CrmMobilePlaceholder.tsx`, `App.tsx`, `ru.ts`, `en.ts`; промт 12 аудита).
2026-07-02 — tangodb-landing: SEO — meta description в i18n, синхронизация title/lang/OG/Twitter при смене локали, canonical, robots.txt, sitemap.xml (`pageMeta.ts`, `useI18n.ts`, `index.html`, `config.ts`, `ru.ts`, `en.ts`; промт 11 аудита).
2026-07-02 — tangodb-landing: footer — навигация по якорям, кликабельные контакты, юридическая строка, CTA на демо вместо «Войти» (`Footer.tsx`, `ru.ts`, `en.ts`; промт 10 аудита).
2026-07-02 — tangodb-landing: FAQ перед footer — 5 вопросов с accordion (`Accordion.tsx`, `FaqSection.tsx`, `App.tsx`, `ru.ts`, `en.ts`; промт 9 аудита).
2026-07-02 — tangodb-landing: блок «Стоимость» перед footer — 3 типа студии без цифр, CTA в Telegram (`PricingSection.tsx`, `App.tsx`, `ru.ts`, `en.ts`; промт 8 аудита).
2026-07-02 — tangodb-landing: секция модульности и ролей — 3 типа студии с чек-листом модулей, deep-link в демо (`#demo/settings/organization`, `#demo/team`; `ModularitySection.tsx`, `demoDeepLink.ts`, `CrmDemoApp.tsx`, `SettingsPanel.tsx`, `App.tsx`, `ru.ts`, `en.ts`; промт 7 аудита).
2026-07-02 — tangodb-landing: разведены Features и CrmCapabilities — 4 карточки выгод (результат), компактный справочник разделов CRM после демо (`Features.tsx`, `CrmCapabilities.tsx`, `App.tsx`, `DemoSection.tsx`, `ru.ts`, `en.ts`; промт 6 аудита).
2026-07-02 — tangodb-landing: блок доверия после hero — 3 колонки (преподаватель, живое демо, поддержка), ссылки на `#demo` и Telegram (`TrustSection.tsx`, `App.tsx`, `ru.ts`, `en.ts`; промт 5 аудита).
2026-07-02 — tangodb-landing: секция демо — приглашение к действию, новые заголовки, баннер view-only, подсказка «Финансы/Настройки» (`DemoSection.tsx`, `ru.ts`, `en.ts`, `crm/strings.ts`; промт 4 аудита).
2026-07-02 — tangodb-landing: hero — бейдж-ссылка на `#demo` с анонсом живой демо-CRM под CTA (`Hero.tsx`, `ru.ts`, `en.ts`; промт 3 аудита).
2026-07-02 — tangodb-landing: hero — H1, подзаголовок, primary CTA на `#demo`, secondary Telegram, микро-доказательство; «Войти» только в header (`Hero.tsx`, `ru.ts`, `en.ts`; промт 2 аудита).
2026-07-02 — tangodb-landing: hero-изображение заменено на `new_girl.png`, alt RU/EN, eager + fetchPriority high (`Hero.tsx`, `public/new_girl.png`; промт 1 аудита).
2026-07-01 — tangodb-landing: убраны все эффекты hero-изображения — CSS (`rounded-2xl`, `animate-fade-in`) и вшитая тень/ореол в `vert_girl.png` (обработка PNG + `Hero.tsx`).
2026-07-01 — tangodb-landing: убраны тени под hero-изображением (`Hero.tsx`).
2026-07-01 — tangodb-landing: hero-изображение заменено на `vert_girl.png` (`Hero.tsx`, `public/vert_girl.png`).
2026-07-01 — tangodb-dev-console: force purge licensed org (Tenants), подпись выдающего при выдаче lifetime key, обязательный email получателя; migration `20260815000001`, edge `issuerSignature.ts`, `DEV_CONSOLE_ISSUER_SIGNATURE` secret.
2026-06-30 — tangodb: favicon вкладки браузера — логотип TDB (`public/favicon.svg`, `index.html`).
2026-06-30 — fix: Dev Console purge org — `_purge_demo_organization_core` отключает `audit_%` триггеры перед `DELETE FROM organizations` (FK `audit_log_organization_id_fkey` при CASCADE); migration `20260814000001`.
2026-06-30 — tangodb-landing: деплой на Cloudflare Pages (`tangodb-landing.pages.dev`), GitHub Actions `.github/workflows/deploy-landing.yml`.
2026-06-30 — tangodb-landing: в шапке убрана ссылка на features, «Демо» → «Как это выглядит» (`Header.tsx`, `ru.ts`, `en.ts`).
2026-06-30 — tangodb-landing: уменьшен верхний отступ hero вдвое (`Hero.tsx`).
2026-06-30 — tangodb-landing: промо-изображение `vert_add.png` в hero справа от заголовка «Вся студия — в одном месте» (`Hero.tsx`, `public/vert_add.png`).
2026-06-30 — fix: «Обзор и статистика» — вкладка «Финансовый» обновляет KPI при каждом открытии (refetch запросов при монтировании `FinancialDashboard`).
2026-06-30 — RBAC/Команда: не более одного руководителя (`director`) на организацию — проверка в RPC и UI; migration `20260813000002`.
2026-06-30 — RBAC/Команда: роль «Руководитель» (`director`) в выпадающих списках приглашения и смены роли; только owner может назначать; migration `20260813000001`, edge `invite-member`.
2026-06-30 — Заморозки: убран чекбокс «списывает занятие»; фиксированная логика (фриз не списывает урок, при смене с присутствия/отсутствия — возврат на баланс); настройка «Активировать заморозки» с неактивной формой лимитов; кнопка «Фриз» скрыта в журнале при отключении; migration `20260812000001`.
2026-06-30 — fix: настройки «Организация» — подзаголовок показывает актуальное название студии из `branding_name`, а не устаревшее из регистрации (`OrganizationSettingsPage`). — фиксированные отступы (px-3), полная ширина колонки (≤65%), подписи месяцев в SVG, tooltip при наведении (`FinancialDashboard`).
2026-06-30 — fix: расписание — столбец времени больше не перекрывает панель «Расписание» при прокрутке таблицы (z-index сетки, sticky-заголовок страницы, `WeeklyScheduleGrid`, `DayColumn`, `SchedulePageContainer`).
2026-06-30 — fix: редактирование группового урока — изменения вступают в силу с текущего дня (не со следующего); настройки «Направления» — список дисциплин растягивается без фиксированного скролла (`useEditGroupSchedule`, `scheduleSlotEdit`, `EditLessonPopup`, `DisciplinesPanel`).
2026-06-29 — UX: popup «Персональный урок / Новая запись» — тариф и стоимость урока в одну строку (`PersonalLessonSaleForm`, `PayPersonalLessonModal`); график «Выручка» в финансовом дашборде — шкала сумм, линии max/avg, выравнивание подписей под точками, выбор периода (месяц / 6 мес / год), адаптивная ширина колонки (`FinancialDashboard`, `financeReports`).
2026-06-29 — fix: выбор дисциплины в popup «Новая запись» (персональный урок) — `useEffect` больше не сбрасывает значение при смене пользователем; UX: уменьшен шрифт подписей мобильной нижней панели (`PersonalLessonSaleForm`, `App.tsx`).
2026-06-29 — fix: журнал посещений для преподавателя — группы из scope «Доступ к группам» отображаются без обязательного совпадения teacher_member_id на слоте; локации групп доступны при scope по группам; SQL `teacher_can_mark_group_attendance` и `teacher_scope_has_access` синхронизированы; migration `20260811000001`.
2026-06-29 — UX/RBAC: комментарий к способу оплаты «Другое» при продаже абонемента (обязательное поле, `payments.method_comment`, RPC); компактная мобильная нижняя панель; «Соло» → «Один человек» в i18n; настройки CRM `teachers_can_sell_personal_lessons`, `directors_can_mark_attendance`; scope преподавателя — «Доступ к группам» / «Доступ к продажам дисциплин»; журнал посещений фильтруется по назначенному преподавателю и scope групп; migration `20260810000001`.
2026-06-29 — Dev tooling: правило `.cursor/rules/codegraph.mdc` (`alwaysApply`) — агент автоматически использует `codegraph_explore` вместо grep/read для indexed-кода.
2026-06-29 — Dev tooling: установлен CodeGraph MCP для Cursor (`.cursor/mcp.json`), проиндексирован репозиторий (`.codegraph/`, в `.gitignore`).
2026-06-28 — UX: журнал изменений — записи за текущий день, человекочитаемые scope/продажи/удаления, popup с выбором дня; «Трио-уроки» → «Персональные уроки до троих человек»; сокращены шаги сценария 2 покупки лицензии (`AuditLogSection`, `auditLogFormat`, `useOrgAuditLog`, i18n, `paymentConfig`).
2026-06-28 — fix: при выключенном модуле «Персональные уроки» скрыты тарифы персональных/пакетов, % по персональным в карточке члена команды, строки payroll; `can(personal_lessons.*)` учитывает `settings.modules` (`PricesPanel`, `MemberProfileModal`, `FinancePayrollPage`, `permissions`, `usePermissions`).
2026-06-28 — UX: мобильное расписание — sticky колонка времени слева и sticky заголовки дня/даты сверху при прокрутке таблицы; компактные заголовки на маленьких экранах (`WeeklyScheduleGrid`, `DayColumn`, `LocationScheduleSection`).
2026-06-28 — fix: при выключенном модуле «Персональные уроки» они скрыты во всём CRM — дашборд (операционный/финансовый/преподавательский), журнал посещаемости, расписание, должники, экспорт (`useOrgModules`, `TeacherScopedDashboard`, `OperationalDashboard`, `FinancialDashboard`, `DashboardPage`, `AttendancePanel`, `ScheduleDebtorsBlock`, `FinanceDebtorsPage`, `DataExportPage`).
2026-06-28 — fix: клик по пустой ячейке расписания учитывает модули организации — при выключенных персональных уроках popup персонального урока недоступен; преподаватель с «Продажа групповых абонементов» открывает форму группового занятия (`scheduleLessonAccess`, `SchedulePageContainer`, `AddLessonTypePopup`).
2026-06-28 — fix: оплата при продаже абонемента всегда через RPC `record_subscription_payment` (убран client-side INSERT по роли; RPC расширен на owner/admin/reception с `member_can_accept_payments`); migration `20260809000001`.
2026-06-28 — fix: продажа абонемента преподавателем — `enforce_tenant_row_org_consistency` теперь SECURITY DEFINER, чтобы EXISTS-проверки subscription/personal_lesson в payments trigger не падали под teacher RLS (ошибка «subscription_id does not belong to organization» при успешной продаже); migration `20260808000001`.
2026-06-28 — fix: продажа абонемента преподавателем — оплата через RPC `record_subscription_payment` (SECURITY DEFINER), обход tenant-trigger/RLS при прямом INSERT в `payments`; migration `20260807000001`.
2026-06-28 — fix: преподаватель с доступом к продажам видит тарифы при продаже абонемента — `can_read_prices()` в RLS разрешает SELECT scoped teacher; `prices.read` на фронте для teacher со scope, панель «Тарифы» по-прежнему только admin/owner/director.
2026-06-28 — Prices: привязка тарифов к преподавателям (`price_teacher_members`, dropdown «Привязать к преподавателю» в прайс-листе); при продаже абонемента teacher видит только свои тарифы и тарифы «Все преподаватели»; у роли teacher убрана ссылка на прайс-лист в форме продажи.
2026-06-28 — fix: «Тарифы и прайс-лист» — суффикс валюты в полях цены берётся из настроек организации (`getCurrencyInputSuffix`), вместо захардкоженного ₫.
2026-06-28 — fix: кнопка «Добавить» на «Настройки · Направления» всегда видна; в «Продажа абонемента» при пустом списке дисциплин — ссылка на настройки направлений.
2026-06-28 — fix: teacher team invite без scope — UI `TeacherScopeFields` в приглашении и профиле участника; default scope `all_disciplines/all_locations` в `create_organization_invite` + backfill активных teacher; migration `20260804000001`; после accept-invite invalidate memberships.
2026-06-28 — License purchase inbox: добавлена заявка самостоятельной оплаты из CRM (`submit-purchase-request` + `platform_purchase_requests`), Dev Console `/inbox` с активацией lifetime-доступа после проверки оплаты, обновлены инструкции сценариев покупки и кнопки поддержки в верхней панели CRM.
2026-06-28 — License purchase: клик по QR открывает popup с увеличенным изображением и кнопкой «Скачать QR» (`QrImagePreview` для crypto/bank/МИР/vietnamese).
2026-06-28 — Auth: на `/login` отключён вход через Telegram (код закомментирован); остался email/password с чекбоксом «Запомнить меня» (localStorage vs sessionStorage через `setAuthRememberMe` в `supabase.ts`).
2026-06-28 — fix: orphan cleanup — `self_service_demo_challenges` не имеет `user_id`, удаление по `owner_email_hash`.
2026-06-28 — fix: Dev Console orphan cleanup — удалена перегрузка RPC `(uuid, boolean)`, перед удалением auth user сбрасываются FK (`owner_user_id`, `created_by`, `actor_user_id` и др.).
2026-06-28 — Dev Console `/users`: выборочное удаление orphan-аккаунтов — чекбоксы в модалке «Delete orphan accounts», RPC `dev_console_cleanup_orphan_auth_users` принимает `p_user_ids`.
2026-06-28 — UX: единый компонент `AddLocationsInSettingsHint` (text-xs + ссылка на `/settings/locations`) в расписании, посещаемости, абонементах, персональных уроках, прайс-листе и полях тарифа. Dev Console `/users`: список auth-аккаунтов с org/ролями; очистка orphan-пользователей (`dev-console-list-users`, `dev-console-cleanup-orphan-users`, RPC `20260732000001`).
2026-06-28 — UX: ссылка «Настройки · Локации» в пустых состояниях продажи абонементов и персональных уроков; в инструкции получения ключа лицензии текстовые ссылки заменены на кнопки контактов (`DeveloperContacts` embedded).
2026-06-28 — CRM/Dev Console license/payment UX: пустые состояния при отсутствии локаций в расписании, продаже абонементов, продаже персональных уроков и прайс-листе; журнал изменений показывает modules/settings человекочитаемо; в лицензии добавлены постоянные контакты разработчика и вторая инструкция получения ключа; payment methods расширены суммой/валютой, вьетнамским переводом и загружаемыми QR, которые CRM показывает в свёрнутых способах оплаты без генерации QR на клиенте.
2026-06-28 — fix: self-service registration recovery — `create-self-service-demo-org` больше не блокирует создание tenant при сбое генерации recovery-code; email-login без org-claims ведёт на `/auth/verify-email` для retry создания демо-CRM; verify retry обновляет браузерную Supabase-сессию после создания org; тексты `/auth/verify-email` и ошибки duplicate email объясняют, что auth-пользователь уже есть, но tenant можно досоздать через вход.
2026-06-28 — fix: email self-service registration — `RegisterPage` после `createDemoOrganization()` обновляет браузерную Supabase-сессию и контекст организации перед переходом в onboarding; Edge Functions регистрации считают `ownerEmailHash` локально через Web Crypto вместо preflight RPC `owner_email_hash`; добавлена миграция `20260801000001_fix_self_service_demo_email_hash.sql`; на страницах входа/регистрации добавлен контакт разработчика `omowdance@gmail.com`.
2026-06-27 — scripts: `npm run db:reset-test` — сброс данных Supabase для тестового прогона (`supabase/scripts/reset_for_test_run.sql` + очистка storage/exports); сохраняет platform admin `albertkoall@gmail.com` (`platform_role=developer`), удаляет организации, ключи, регистрации, сессии и прочих auth-пользователей.
2026-06-27 — fix: `parseTelegramAuthError` в `AuthProvider.tsx` теперь переводит ответы `"Authentication failed"` / `"Service unavailable"` / `"Could not create demo organization"` в `auth.error.generic` вместо показа сырой строки; аналогичный кейс `"Could not create demo organization"` добавлен в `parseAuthError`; задеплоены все edge functions (включая исправленный `telegram-auth` с поиском по `user_metadata.telegram_id` и `organization_members.telegram`).
 `telegram-auth` теперь сопоставляет Telegram пользователя по строковому/числовому `telegram_id`, `user_metadata.telegram_id` и `organization_members.telegram` с ID/username; `/auth/verify-email` получил повтор создания демо-CRM и локализацию `Service unavailable`.
2026-06-27 — fix: `record_single_visit` — `ON CONFLICT` для `payments` теперь указывает предикат `WHERE single_visit_id IS NOT NULL`, чтобы совпасть с partial unique index `payments_org_single_visit_unique` (ошибка «there is no unique or exclusion constraint matching the ON CONFLICT specification» при «Отметить и оплатить»).
2026-06-27 — Single visit payments: добавлена отдельная модель разовых групповых посещений (`single_visits`, `payments.single_visit_id`, RPC `record_single_visit`) с тарифами `single_visit`, привязкой к локации/дисциплине/групповому слоту, кнопкой «Разовое посещение» в popup журнала посещений, финансовыми агрегатами/журналом/CSV и отдельным payroll-процентом `single_visit_rate_percent`; добавлены настройки прав `teachers_can_record_single_visits` / `admin_can_record_single_visits`; общий `AddClientModal` теперь сохраняет флаг несовершеннолетнего и поля опекунов во всех popup «Новый клиент».
2026-06-27 — Client guardians + personal debt payments: редактирование клиента теперь сохраняет флаг несовершеннолетнего и поля обоих опекунов; формы добавления клиента отключают native validation и показывают i18n-ошибку; в `/finance/debtors` убрана поясняющая фраза и добавлена оплата персональных долгов через `PayPersonalLessonModal`; `financial_debtors_v` расширен полями персонального урока (`20260730000003`); popup «Журнал посещений» показывает «Оплатил» для неоплаченного персонального урока при `payments.write`; `telegram-auth` умеет привязывать старый email-профиль по сохранённому Telegram username участника команды.
2026-06-27 — Auth locale picker + client minors + admin RBAC toggles: переключатель языка на auth-страницах (`AuthLocalePicker`); fix белого экрана Telegram (redirect на `/activate-key`, `needsOrgPicker`, skip duplicate Mini App auth); `admin_can_accept_payments` / `admin_can_edit_schedule` в «Расширенные права ролей»; чекбокс «Несовершеннолетний» + поля опекунов в форме клиента; popup карточки клиента с полным профилем; fix `client_notes` (author через `useTeamMembers` вместо broken embed); migration `20260730000002`. исправлен audit log (actor без двойной интерполяции); «Команда» вынесена в левое меню «Настройки» над «Настройки CRM» (route `/settings/team` вне SettingsLayout); фильтр по преподавателю в журнале платежей; «В разработке» под «Прочее» в выручке; viewport-fit + boot error fallback + es2020 build target для Telegram Android.
2026-06-27 — Payroll UX + audit actor: журнал изменений показывает «Пользователь: Имя (uuid)» по `user_id`; в `MemberProfileModal` у фиксированной оплаты суффикс валюты; на `/finance/payroll` колонка «Оклад», клик по участнику раскрывает разбивку (оклад / % групп / % персональных) и историю выплат с датой и автором. `teacher_pay_rates` расширены до зарплат команды (`pay_mode`, `fixed_amount`, раздельные `%` по group/personal), `recalculate_teacher_settlement` считает всех активных участников и фиксированную часть, `record_teacher_settlement_payment` разрешает авансы; `/finance/payroll` показывает всю команду, роли, оклад/проценты, выплату/аванс; `MemberProfileModal` — настройки системы оплаты для каждого участника; «Зарплаты» убраны из создания расходов; `FinancialDashboard` добавил начисленные зарплаты и прибыль `выручка − расходы − зарплаты`; `formatCurrency` нормализует разделители тысяч пробелами; Team audit log показывает автора и изменённые поля.
2026-06-27 — i18n fixes + clients contact fields: убран vi-VN из выбора языка; Schedule — `formatWeekRangeLabel`/`dowShort` с locale; счётчики debtors без дублирования count; `getPaymentMethodLabel` вместо hardcoded RU labels; `formatDebtorDetail` + meta columns в `financial_debtors_v`; migration `20260729000001` (`clients.phone`, `clients.email`); формы add/edit client; `LocaleDocumentSync` для native validation; расширен список timezone в General Settings. — migration `20260728000001_v2_teacher_payroll.sql` (`teacher_pay_rates`, `teacher_settlements`, `teacher_settlement_payments`, RPC `recalculate_teacher_settlement` / `record_teacher_settlement_payment`, RLS financial + teacher read-own, guard `teacher_has_future_lessons` in `update_team_member`); `usePayroll` hooks; `/finance/payroll` UI (admin table + teacher read-only cards); permissions `payroll.*`; route exception for teacher in `routeGuards`; `FinanceLayout` sub-nav filter; rate % in `MemberProfileModal`; «Мои выплаты» in `TeacherScopedDashboard`; i18n ru/en; `resolvePaymentTeacherId` exported; `assertPayrollPermissions`.
2026-06-26 — F5 (Промт 19): operational expenses — migration `20260727000001_v2_expenses.sql` (table, RLS owner/director/accountant, audit, tenant consistency, `expense_date <= CURRENT_DATE`); `useExpenses` CRUD hooks; `/finance/expenses` + nav; `FinanceExpensesPage` (filters, total, CRUD modal); permissions `expenses.read`/`expenses.write`; `FinancialDashboard` — «Расходы за месяц» + «Прибыль» (выручка − расходы); CSV expenses in `DataExportPage`/`exportFinancialCsv`; `DatePickerField` `max` prop; i18n ru/en.
2026-06-26 — Документация: Промт 19 (F5 Expenses) и Промт 20 (F6 Payroll) в `tangodb_modular_dance_crm_TZ.md` §10; порядок в `steps` §«СЛЕДУЮЩИЕ ШАГИ».
2026-06-26 — F5/F6 (Промт 7): план expenses/payroll — `tangodb_expenses_payroll_plan.md` (схемы, RLS, permissions, UI, бизнес-правила, порядок F5→F6); decision_log — ставки MVP (% от атрибутированной выручки); TZ §7.7 F1–F3 отмечены выполненными; fix: Guardians ≠ Промт 7. — `ORG_MODULE_GROUPS` в `orgModules.ts` (Разделы CRM / Форматы занятий / Инфраструктура); группировка чекбоксов + пояснение «выключение скрывает UI, данные сохраняются» в `OrganizationSettingsPage` и `OnboardingWizardPage`; i18n `orgModules.group.*`, `orgModules.disableHint`.
2026-06-26 — Этап 2 (Промт 5): UX-упрощения форм — `shouldShowLocationPicker` / `shouldShowDisciplinePicker` в `orgModules.ts`; `LocationSelect` + auto-hide в `DisciplineSelect` при `locations: false` / одной локации и `multi_discipline: false` / одном направлении; формы расписания/продажи/фильтры (`SchedulePanel`, `PersonalLessonSaleForm`, `EditLessonPopup`, `AddGroupLessonForm`, `SubscriptionsPanel`, `PersonalLessonFilters`, `LocationTariffField`).
2026-06-26 — F3 (Промт 4): расширенная аналитика dashboard — `financeReports.ts`: новые клиенты за месяц, топ-5 клиентов/преподавателей по выручке, заполняемость (present/absent); `FinancialDashboard`: карточки + rank lists; client-side агрегация через `useClients`, `useAttendanceRecords`, `usePersonalLessons`, `useSchedule`, `useSubscriptionGroups`, `useTeamMembers`; i18n `dashboard.newClients/occupancy/top*`.
2026-06-26 — F2 (Промт 3): owner finance KPI — `financeReports.ts`: MoM %, 6-month series, revenue split; `usePaymentsTrend`; `FinancialDashboard`: line trend + stacked bar split, MoM на карточке выручки; i18n `dashboard.mom*`, `dashboard.revenueTrend/Split`.
2026-06-26 — CSV export i18n: заголовки колонок и значения (статусы, способы оплаты, да/нет) через `exportCsvI18n.ts` + `organization_settings.locale`.
2026-06-26 — S10 follow-up: audit log labels + settings error keys через `resolveMutationError`; push/deploy завершение после прерванного push.
2026-06-26 — S10 (Промт 17): English localization — модульная i18n (`lib/i18n/`: `keys.ts`, `ru.ts`, `en.ts`, `vi.ts`, `core.ts`, `navHelpers.ts`); `useI18n` / `useGuestI18n`; locale из `organization_settings.locale` + `setGuestLocale` при сохранении; `en-US` для auth, nav, dashboard, clients, schedule, subscriptions, personal, attendance, prices, finance, settings, team, license/demo; `parseAuthError(err, locale)`; locale-aware `utils` (DOW, tariffs, conflicts, dates).
2026-06-26 — i18n batch 4: завершена локализация remaining UI в `SubscriptionsPanel`, `SchedulePanel`, `PricesPanel`, модалках/полях (`AddClientModal`, `SellPackageModal`, `CreatePrivatePackageTariffModal`, `AddDisciplineModal`, `CsvExportModal`, `DisciplineSelect`, `DatePickerField`, `GroupCheckboxDropdown`, `DisciplineTariffField`, `LocationTariffField`), а также `DisciplinesPanel`, `ClientNotesPanel`, `ClientCardModal`, `MemberProfileModal`; добавлены `resolveMutationError` и `translateConnectionBlockReason`/`translateMutationBlockedMessage` для mutation errors и offline/server-unreachable блокировок.
2026-06-26 — i18n batch 3 (continued): `lib/utils.ts` — `getDowLabels`/`getDowFullLabels`, `formatMonthTitle(locale)`, conflict helpers с `translate`/`locale`; `scheduleConflicts.ts` — `t`/`locale` в conflict messages; dashboards (`OperationalDashboard`, `FinancialDashboard`, `TeacherScopedDashboard`); finance pages (`FinancePaymentsPage`, `FinanceRevenuePage`, `FinanceDebtorsPage`, `FinancePayrollPage`); `DisciplinesSettingsPage`; 408 ключей `common.*`, `utils.dow.full.*`, `dashboard.*`, `finance.*`, `settings.*`.
2026-06-26 — i18n batch 3: `AttendancePanel`, personal-lessons (`PersonalLessonsPageContainer`, `PersonalLessonsList`, `PersonalLessonSaleForm`, `PersonalLessonFilters`), schedule popups/forms (`SchedulePageContainer`, `ScheduleToolbar`, `EditLessonPopup`, `AddGroupLessonForm`, `AddPersonalLessonForm`, `LessonInfoPopup`, `PayPersonalLessonModal`, `ScheduleDebtorsBlock`, `WeekPickerPopover`, `AddLessonTypePopup`), settings pages (`TeamSettingsPage` + `getTeamRolePresets`, `OrganizationSettingsPage`, `SubscriptionSettingsPage`, `LocationsSettingsPage`, `DataExportPage`) — `useI18n` (`t`, `plural`, `formatDate`/`formatDateTime`); ключи `attendance.*`, `personal.*`, `schedule.*`, `settings.*`, `common.*`; `findScheduleConflict`/`formatScheduleConflictToast` с `t`/`locale`; fix syntax в `SchedulePageContainer` (`selectedLessonMeta` useMemo).
2026-06-26 — i18n batch 2: `SettingsLayout`, `GeneralSettingsPage` (+ `setGuestLocale` on save), `DashboardPage`, `FinanceLayout`, UI banners/dialogs/loading/error, demo components, `lib/demoLicense` (locale-aware), `getPurchaseActivationSteps`, `LicenseSettingsPage`, `components/license/*` — `useI18n` + nav helpers.
2026-06-26 — i18n panels: `ClientsPanel`, `SubscriptionsPanel`, `SchedulePanel`, `PricesPanel` — UI strings через `useI18n` (`t`, `plural`, `formatDateTime`); ключи `clients.*`, `subscriptions.*`, `schedule.*`, `prices.*`, `utils.*`, `common.*`.
2026-06-26 — i18n auth pages: `LoginPage`, `RegisterPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `VerifyEmailPage`, `ActivateKeyPage`, `LicenseRequiredPage`, `OnboardingWizardPage`, `SelectOrganizationPage`, `RecoveryCodeModal`, `AuthLayout`, `routeGuards`, `TurnstileWidget` — `useGuestI18n()` + ключи `auth.*` / `onboarding.*` / `license.*`; `parseAuthError(err, locale)`; aria labels пароля в `AuthField`. `App.tsx` — nav/mobile tabs/panel titles через `getNavSections`/`getMobileTabs`/`getPanelTitle` + `useI18n`; aria/signOut/connectionRestored ключи `nav.*`. owner emergency recovery — Edge Function `dev-console-transfer-owner-email` (developer-only, min 2 verification factors, bcrypt recovery code, anti-abuse purged demo email, audit `owner.email_transfer_by_support` with email hashes); migration `20260726000001` (`dev_console_user_id_by_email_exact`, `dev_console_reassign_org_owner`); `verifyRecoveryCode` в `_shared/recoveryCode.ts`; Dev Console OrgsPage modal «Смена owner email»; `LicenseSettingsPage` — инструкции owner recovery (forgot password + manual support).
2026-06-26 — S8 (Промт 15): team invite + member recovery — `TeamSettingsPage`: инструкции owner/director (forgot password, lost email → deactivate + re-invite, owner recovery через developer); confirm деактивации; «Пригласить снова» для inactive members с сохранением role/scope/meta; i18n ключи recovery; `ForgotPasswordPage` — generic success без раскрытия email; `inviteMember` scope typed as `TeacherScope`.
2026-06-26 — S6 (Промт 13): curated ISO-4217 currencies — `lib/currencies.ts` (20 codes §8.6), `CURRENCY_SELECT_OPTIONS` в `GeneralSettingsPage` и `OnboardingWizardPage`; `format.ts` — symbol overrides для KZT/AED/VND через `formatToParts`; `LicenseSettingsPage` — контакты developer вне purchase flow (`DeveloperContacts` + `usePlatformPaymentConfig`). demo purge/retention — `data_purge_at = demo_expires_at` (strict 30d, backfill legacy 60d); `_purge_demo_organization_core` DELETE org + CASCADE business data + `demo_owner_retention`; `purge_expired_demo_organizations` / `purge_single_organization` без tombstone; `run_demo_lifecycle` только уведомления 7d/1d (без `demo_retention`); `activate_access_key` demo-key 30d; fix overload `20260725000002`; `organization_allows_writes` блокирует expired `demo_active`; UI read-only для expired demo; migrations `20260725000001`, `20260725000002`; тесты `v2_access_key_test.sql`.
2026-06-26 — DC1 (Промт 18): Dev Console SaaS-support — `dev-console-list-tenants` (owner email/name, storage, last login, key metadata, filters); `dev-console-reset-owner-password` (one-time password, audit без plaintext); `dev-console-purge-org` + RPC `purge_single_organization`; migration `20260724000001` (`estimate_org_storage`, `platform_org_notes`, `organizations.payment_ref`); OrgsPage Tenants table + modals; nav «Tenants»; save payment config через EF. форма вместо JSON; load/save через Supabase table + RLS `is_dev_console_operator()`; `invokeDevFunction` → `supabase.functions.invoke` с понятными ошибками env/CORS. — `platform_payment_methods` + `platform_waitlist`, migration `20260723000001`; purchase UI на `/settings/license?purchase=1` (crypto QR `react-qr-code`, bank/MasterCard, МИР, контакты, 7-step instruction); Stripe → «Скоро» + waitlist (`submit-subscription-waitlist`); Dev Console `/payment-methods` + `dev-console-payment-methods`; `lib/paymentConfig.ts`, `components/license/*`. — `ДЕМО-ВЕРСИЯ` под логотипом (sidebar + mobile drawer) с днями/датой окончания; CTA «Купить полную версию» в nav, dashboard banner и license page; `lib/demoLicense.ts`, `useDemoLicenseUi`, компоненты `components/demo/*`; owner/director only; read-only `demo_retention` не затронут.
2026-06-26 — S2 (Промт 9): Telegram self-service demo — новый Telegram ID → synthetic auth user (`tg_*@tangodb.auth`) + demo org без email/пароля; RPC `create_telegram_self_service_demo_org`, `telegram_id_hash` anti-abuse; `telegram-auth` Edge Function создаёт demo + recovery code; известный TG ID → login как раньше; `TelegramRecoveryGate` в App; миграция `20260722000001_telegram_self_service_demo.sql`.
2026-06-26 — fix: `owner_email_hash` migration — `search_path = public, extensions` для `digest()` на hosted Supabase.
2026-06-26 — S1 (Промт 8): self-service demo email — поле «Логин», Turnstile на `/register`, Edge Functions `verify-self-service-registration` + `create-self-service-demo-org`, RPC `create_self_service_demo_org`, recovery code (bcrypt hash), `VerifyEmailPage` auto-create demo без `/activate-key`; миграция `20260721000001_self_service_demo_registration.sql`; onboarding вариант A (wizard).
2026-06-26 — Этап 1 (Промт 1): module gate — `finance_basic` в `OrgModules`, `normalizeOrgModules`, gating в nav/mobile/settings/routes/dashboard/export; миграция `20260720000001_finance_basic_module_default.sql`. — единое название вместо «Календарь и журнал» / «Журнал посещений и календарь».
2026-06-25 — Персональные уроки, форма «Продажа»: подпись «Стоимость за один урок»; кнопка «Забронировать» в режиме «Списать с пакета» на всю ширину.
2026-06-25 — fix: персональные уроки — валидация дат при «Повторять до даты» (ошибка, если дата урока позже окончания); список сортирован от новых к старым, текущие/будущие даты с обводкой sky (PERSONAL_LESSON_COLOR); в сообщении о конфликте показывается время пересечения, а не начало нового интервала.
2026-06-25 — Персональные уроки, форма «Продажа»: дата и время (Начало/Окончание) в одной строке; чекбокс «Повторять еженедельно» перенесён ниже; еженедельное повторение по дням недели с индивидуальным временем на каждый день.
2026-06-25 — Персональные уроки: вкладки соединены с контентом (как абонементы); форма «Продажа» — новый порядок полей (локация+дисциплина, даты с «+ Добавить дату», чекбокс «Повторять еженедельно», тариф+стоимость в одной строке); «Создать в прайс-листе» в popup пакета открывает модал «пакет персональных уроков» без ухода со страницы.
2026-06-25 — UI: единая высота однострочных полей (`fieldCls` h-10 text-xs) — select, input, DatePickerField, ClientAutocomplete; описание через `descriptionFieldCls`.
2026-06-25 — Персональные уроки: иконки редактирования/удаления в колонке «Действия»; popup редактирования (время, локация, направление, преподаватель); подтверждение удаления; прошлые даты — без иконок; сегодня и будущее — можно удалять/редактировать; кнопки «Неделя/Месяц/Период» в стиле «Все/Оплаченные/Долг»; миграция RPC guard `date < today`.
2026-06-25 — Персональные уроки: двухстрочные фильтры (период/дата/оплата + локация/направление/преподаватель/поиск), ссылка «Текущая неделя» только вне текущей недели; убран фильтр «Посещение»; шапка группы — дата + склонение «урок»; колонка «Дата» убрана из таблицы; высота select (`text-xs`) выровнена с полем поиска.
2026-06-24 — PERSONAL_LESSONS Этап 4 (Промпт 4): раздел `/personal` — PersonalLessonsPageContainer, фильтры, список, вкладка продажи; routes + nav + modules.personal_lessons gate; удалены PersonalLessonsPanel/PersonalPage, personalFilter из store; откат redirect `/personal`→`/schedule`; Dashboard personalView → `/personal`; canWritePersonalLesson через isPersonalLessonLockedForWrite.
2026-06-24 — PERSONAL_LESSONS Этап 3 (Промпт 3): PersonalLessonSaleForm — общая форма продажи (schedule-cell + standalone), до 4 клиентов, режимы дат single/multiple/weekly; AddPersonalLessonForm — тонкая обёртка popup; lib/personalLessonDates.ts для генерации повторений.
2026-06-24 — PERSONAL_LESSONS Этап 2 (Промпт 2): usePersonalLessons — фильтры location/discipline/teacher/client/attendance, buildQueryKeySuffix; delete/update через RPC + hook guard date>today; useAddPersonalLessons/useMarkPersonalLessonAttendance invalidation schedule/subscriptions/payments; AttendancePanel — personal+пакет через handleMarkPersonal + excused.
2026-06-24 — PERSONAL_LESSONS Этап 1 (Промпт 1): миграция `20260718000001` — quad/client_id4, excused, единый `mark_personal_lesson_attendance` с списанием пакета, RPC `delete_personal_lesson` / `update_personal_lesson` (guard `date > today`), trigger пакет+дисциплина+локация; TS-типы и utils; smoke `personal_lessons_stage1_test.sql`.
2026-06-24 — PERSONAL_LESSONS Этап 0: зафиксированы MVP-решения (PL-0 в decision_log.md) — маршруты `/personal`, quad-клиент, вариант A для isPastDate, единый RPC attendance, правила пакет/дисциплина/локация.
2026-06-24 — fix: безлимитный абонемент в прайс-листе — «Безлимит» вместо «1 урок»; в «Обзор и статистика» счётчик дней (30) и попадание в «Заканчивается абонемент» по порогу дней.
2026-06-24 — fix: досрочное завершение абонемента через RPC finish_subscription (обход триггера protect_subscription_counters).
2026-06-24 — Продажа абонемента: дата активации справа от «Групповые уроки»; «Способ оплаты» и «Итого к оплате» в одной строке, компактнее.
2026-06-24 — fix: удаление группового слота закрывает его с даты занятия (valid_to = день до), а не включительно — занятие сразу исчезает из сетки.
2026-06-24 — fix: после удаления занятия из popup расписание сразу обновляется (refetch + инвалидация кэша schedule/personalLessons).
2026-06-24 — fix: при создании группового расписания valid_from считается от ближайшего будущего дня недели; expandSlotsToWeek не показывает даты до valid_from.
2026-06-24 — Расписание: popup создания группового урока теперь поддерживает несколько дней и времени за одно добавление, с проверкой внутренних и внешних конфликтов.
2026-06-23 — fix: prices_type_category_check — добавлен type monthly_unlimited для создания месячного тарифа.
2026-06-23 — Группы унифицированы через classes.id; посещаемость per-group; месячный безлимитный абонемент (billing_model, expires_at, счётчик дней).
2026-06-23 — Абонементы: привязка к групповым урокам (subscription_groups); выбор групп при продаже; отображение групп на карточках; фильтр «Группы» при выбранной локации; журнал посещений показывает клиента только в привязанных группах.
2026-06-23 — Абонементы: вкладка «Активные» (бывш. «Просмотр») — фильтры по локации, дисциплине и заканчивающимся; новая вкладка «История» с фильтрами дисциплина/локация/клиент, выбором месяца или года.
2026-06-23 — Расписание: в ячейках занятий сначала время (начало–конец), затем название/клиент и метаданные.
2026-06-23 — Тарифы: привязка к дисциплине (discipline_id); редактирование локации и дисциплины; фильтрация при продаже абонементов, персональных уроков и пакетов.
2026-06-23 — Миграция: prices.discipline_id + partial unique indexes для комбинаций location/discipline.
2026-06-23 — Абонементы: группировка по дисциплинам (свёрнутые секции с счётчиком); продажа — чекбокс «Локальный прайс-лист» и фильтр тарифов по локации.
2026-06-23 — Журнал посещений: кнопка «Уважит.» (статус excused, без списания урока); подсказки на кнопках; легенда в popup, кнопки под карточкой абонемента.
2026-06-23 — Тарифы: двухшаговое создание (выбор типа → форма); привязка к локации (location_id); глобальные vs локальные в прайс-листе.
2026-06-23 — Миграция: attendance excused + prices.location_id + mark_attendance v2.
2026-06-23 — Блок «Неоплаченные персональные уроки»: группировка по локациям; преподаватель видит только свои уроки; оплату принимают owner/director/admin через payments.write.
2026-06-22 — Расписание: ссылка «Текущая неделя» в тулбаре при просмотре другой недели (один клик — возврат к текущей).
2026-06-22 — fix: SellPackageModal поверх PayPersonalLessonModal (stackLayer above, z-[70]).
2026-06-22 — fix: PayPersonalLessonModal — выбор «Один урок» / «Списать с пакета» сбрасывался из-за useEffect на lessonTariffs.
2026-06-22 — Расписание: sky/indigo для personal/group; PayPersonalLessonModal (оплата урока / списание с пакета); все неоплаченные внизу с кнопкой «Оплатить».
2026-06-22 — fix: блок неоплаченных уроков в расписании — «1» + «800 000 ₫» больше не сливаются в «1 800 000 ₫»; подписи «N уроков · сумма», группировка по неделе.
2026-06-22 — Продажа пакета: DatePickerField для даты активации; ссылка на «Новый тариф → ПАКЕТ ПЕРСОНАЛЬНЫХ УРОКОВ»; deep link /prices?create=privatePackage; усилена UI-защита prices.write (только owner/director).
2026-06-22 — UX форм: DatePickerField для даты активации абонемента; автоподстановка стоимости из тарифа в новой записи персонального урока; подсказка при пустом списке пакетов; редактирование группового урока — добавление дней/времени с блокировкой сохранения при конфликте.
2026-06-22 — Расписание: секции локаций свёрнуты по умолчанию, разворачиваются по клику на заголовок (LocationScheduleSection).
2026-06-22 — fix: usePersonalLessons без PostgREST join clients (composite FK v2); имена через useClientDirectory — исправлена ошибка «Could not find a relationship» на /schedule.
2026-06-22 — Расписание Промпт 9: regression QA — lint/build/test:rbac PASS; SQL smoke `schedule_overlap_test.sql` + `npm run test:db:schedule-overlap`; rollback `valid_to` в useEditGroupSchedule при failed INSERT; architecture.md обновлён.
2026-06-22 — Расписание Промпт 7: слияние /personal → /schedule (redirect + backward-compat); навигация без «Персональные»; SellPackageModal в schedule UI; deep link /schedule?action=sell; @deprecated PersonalPage/PersonalLessonsPanel.
2026-06-22 — Расписание Промпт 6: ScheduleDebtorsBlock (операционные долги paid=no, без financial_debtors_v); useScheduleDebtors; суммы только owner/director; красная рамка в LessonBlock (hasDebt).
2026-06-22 — Расписание Промпт 5: EditLessonPopup (group → useEditGroupSchedule с versioning, personal → date/time/discipline/teacher); подключение из LessonInfoPopup; invalidate schedule при update personal.
2026-06-22 — Расписание Промпт 4: попапы добавления (AddLessonTypePopup, AddGroupLessonForm, AddPersonalLessonForm); клик по пустой ячейке; lib/scheduleConflicts, scheduleTime, TimeSelect; useAddPersonalLessons requireScope для schedule UI.
2026-06-22 — Расписание Промпт 2: read-only недельная сетка — components/schedule/* (WeeklyScheduleGrid, ScheduleToolbar, WeekPickerPopover, LocationScheduleSection, LessonBlock); SchedulePage → SchedulePageContainer; lib/scheduleColors, scheduleLayout; секция «Без локации» для legacy personal.
2026-06-22 — Расписание Промпт 1: миграция schedule_versioning (valid_from/valid_to, partial UNIQUE, HH:MM CHECK, overlap triggers); типы DisplayLesson/ScheduleSlot; lib/scheduleWeek.ts; хуки useScheduleForWeek, useEditGroupSchedule, soft delete; usePersonalLessons dateRange API без teacher fallback.
2026-06-21 — Расписание: редактирование локации и преподавателя в модалке группы (преподаватель — только owner/director). Команда: карточки профиля преподавателей (ФИО, контакты); редактирование owner/director, просмотр admin. Миграция member profile fields.
2026-06-20 — Локации в расписании и журнале: schedule_slots.location_id/teacher_member_id в UI; выбор локации перед календарём посещений с кнопкой «Все локации»; фильтрация групповых и персональных уроков по залу.
2026-06-20 — Dashboard tabs: убрана лишняя внешняя карточка вокруг «Обзор и статистика», чтобы split-dashboard следовал panel-page-stack и карточкам из design system.
2026-06-20 — Промпт 5 Regression QA re-run: scripts/rbac-regression-check.mjs + npm run test:rbac; §10 PASS (lint, build, migration sync); новых дефектов не выявлено.
2026-06-20 — RBAC-4 + RBAC-5 (verification pass): design_system — TeacherScopedDashboard и актуальная таблица dashboard split; regression asserts для teacher empty scope в assertReceptionPermissions.
2026-06-20 — RBAC-3: teacher_can_write_subscriptions() + guard на subscriptions_insert/update/delete_teacher — write только при teachers_can_sell_subscriptions=true и scope; default deny (REST не обходит UI).
2026-06-20 — RBAC-8: can_export_data() синхронизирован с §9 (admin_can_export, teachers_can_export); accountant убран из dashboard.export → только finance.export; DataExportPage split (OperationalExportSection / FinancialExportSection + exportFinancialCsv.ts).
2026-06-20 — RBAC P1 bundle: RBAC-2 (permissionOptionsFromSettings в routeGuards/SettingsIndexRedirect), RBAC-1 (owner/director — вкладки operational+financial на DashboardPage), RBAC-7 (findFirstAccessiblePanelPath вместо спиннера на /); assertReceptionPermissions + admin_can_export regression.
2026-06-20 — RBAC Этап 0: NAV-1 (accountant без /prices nav, prices.read сохранён), NAV-2 (teacher scoped home — dashboard.scoped_summary + TeacherScopedDashboard), RBAC-6 (admin без disciplines.write); assertReceptionPermissions в dev.
2026-06-20 — RBAC R2.1: view `financial_debtors_v` (security definer) + `useFinancialDebtors` — бухгалтер видит дебиторов с именем и Telegram без CRM SELECT; FinancialDashboard/FinanceDebtorsPage без CRM-хуков.
2026-06-20 — RBAC R5: split Dashboard (OperationalDashboard / FinancialDashboard), /finance/revenue, /finance/debtors, заглушка /finance/payroll, FinanceLayout с боковой навигацией.
2026-06-20 — RBAC R3: таблица payments, RLS, RPC record_personal_lesson_payment, backfill; usePayments, /finance/payments, журнал за день на dashboard, кнопки «Зафиксировать оплату».
2026-06-20 — OrganizationProvider: auto refreshSession при расхождении JWT role и role в БД.
2026-06-20 — RBAC R2: SQL-миграция v2_rbac_roles_refinement — admin→owner data migration, split can_read_operational/financial, accountant без CRM SELECT, prices read/write split, admin без team/settings/export.
2026-06-20 — RBAC R1: матрица permissions (admin/accountant/teacher), панель finance, UI guards и маскировка фин. полей для teacher (без SQL-миграций).
2026-06-20 — AuthLayout: логотип TDB вместо T — как в меню CRM.
2026-06-20 — Исправлен бесконечный спиннер на /accept-invite: стабилизирован useI18n.t и однократный preview.
2026-06-20 — Приглашения в команду: установка пароля по ссылке (preview-invite, complete-invite), email заблокирован; подсказка над кнопкой «Сгенерировать приглашение».
2026-06-20 — Персональные уроки: статус оплаты оформлен как кнопка с иконками (Coins / CircleOff) — понятнее, что статус можно переключить.
2026-06-19 — Приглашения в команду: отправка email через Resend (invite-member, request-demo-key); UI предупреждает, если письмо не ушло. clientDisplay из справочника клиентов вместо UUID (JOIN clients не работает с composite FK v2).
2026-06-19 — Действующие абонементы: в карточке отображаются посещения и пропуски (из attendance и personal_lessons), стиль как у «Активирован».
2026-06-19 — Журнал посещений: групповые абонементы фильтруются по disciplineId слота расписания; mark_attendance проверяет направление при отметке.
2026-06-19 — UUID v2: типы id/disciplineId/priceId как string в types, hooks, SchedulePanel, PersonalLessonsPanel, DisciplineSelect — единообразие с Supabase без parseInt.
2026-06-19 — Парные абонементы: создание тарифов solo/pair (pair_hm, pair_m1), продажа двум клиентам, фильтр по modules.pair_subscriptions; убран UI цикла m1/m2/m3.
2026-06-19 — Продажа абонемента: pair_month как m1/m2/m3 (не "1"), кастомные tariff_* → type solo — исправлен CHECK subscriptions.
2026-06-19 — UUID для discipline_id и price_id: убран parseInt в селектах, типы string вместо number — исправлена ошибка «invalid input syntax for type uuid: "8"» при продаже абонемента (v2-схема Supabase).
2026-06-19 — AddDisciplineModal: portal в document.body — исправлена перезагрузка при добавлении дисциплины из формы расписания (вложенные form).
2026-06-19 — Обзор: текст «Нет заканчивающихся абонементов», серый счётчик при 0; расписание: group_name в БД, форма с названием группы и несколькими днями.
2026-06-19 — INSERT в tenant-таблицы: organization_id в хуках (disciplines, locations, clients, subscriptions, personal_lessons) + миграция DEFAULT auth_organization_id().
2026-06-19 — Продажа персонального урока: компактные отступы между полями (panel-form-stack-compact).
2026-06-19 — Продажа абонемента: ещё меньше отступы между полями (space-y-1, gap-y-1).
2026-06-19 — Продажа абонемента: уменьшены отступы между полями формы (panel-form-stack-compact).
2026-06-19 — PricesPanel: откат auto-fill/minmax — восстановлена сетка секций; ширина карточек через меньше колонок (xl:3) и w-36.
2026-06-19 — PricesPanel: шире карточки тарифов (min 20rem, auto-fill) — сумма и кнопки не обрезаются в узкой сетке.
2026-06-19 — PricesPanel: поле суммы тарифа шире (w-36), чтобы вмещались длинные числа.
2026-06-19 — PricesPanel: секции тарифов вертикально (групповые → персональные → пакеты), карточки внутри секции — горизонтальная сетка.
2026-06-19 — Создание кастомных тарифов: organization_id в insert + миграция (DEFAULT auth_organization_id, CHECK tariff_*).
2026-06-19 — Унификация акцентных цветов: violet и emerald заменены на indigo по всему tangodb/; design_system.md зафиксирован как правило проекта.
2026-07-19 — Групповые уроки (новое/редактирование): `DisciplineSelect` с `alwaysShow` — поле «Дисциплина» видно даже при одной дисциплине или выключенном модуле multi_discipline.
2026-06-19 — Типографика nav/logo: text-[8px]/text-[9px] заменены на text-[10px]/text-[11px] для читаемости и соответствия design system.
2026-06-19 — Аудит design system: CsvExportModal rounded-xl, ClientAutocomplete dropdown z-50, иконки stat-карточек Dashboard w-5 h-5.
2026-06-19 — Empty state: PricesPanel, DisciplinesPanel и AttendancePanel приведены к эталону (py-20, иконка w-8, text-sm).
2026-06-19 — Sell-панели и popup на md+: полная ширина под PageTabs, двухколоночные формы, шире модали; мобильный layout без изменений.
