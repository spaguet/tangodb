# Lessons

Ошибки и как их избежать в будущем.

## Формат записи

- **Дата:** YYYY-MM-DD
- **Ошибка:** что пошло не так
- **Причина:** почему это произошло
- **Как избежать:** что делать иначе

## Записи

### 2026-08-21 — Расписание: красная ячейка после оплаты персонального урока

- **Ошибка:** после оплаты урока в «Расписании» ячейка оставалась с красной обводкой, долг «висел», без расшифровки откуда он.
- **Причина:** (1) `LessonBlock` смотрел только на `paid === "no"`, а не на остаток `price − paid_amount`; частичная оплата (например 800 из 950 по тарифу) корректно оставляла `paid=no`, но UI не объяснял формулу. (2) `handleScheduleRefresh` вызывал `scheduleQuery.refetch()` — это refetch **групповых слотов**, персональные уроки недели не перечитывались, если invalidate кэша не успевал/не попадал.
- **Как избежать:** рамку долга считать по remaining, когда суммы есть; `refetch` недели должен включать personal/events/rentals; в модалке оплаты показывать начисление, историю платежей и формулу долга.

### 2026-08-21 — PayPersonalLessonModal pay-all: idempotency key не UUID

- **Ошибка:** «Оплатить за всех участников» в попапе оплаты — `invalid input syntax for type uuid: "uuid:uuid"`.
- **Причина:** P14 добавил `${batchKey}:${chargeId}` в `p_idempotency_key`; колонка/RPC — тип `uuid`, не text.
- **Как избежать:** как в `PersonalLessonSaleForm` — стабильный `crypto.randomUUID()` на charge в ref/map; не склеивать UUID через `:`.

### 2026-08-21 — GCal sync UI: orphaned `pending` link без outbox job

- **Ошибка:** урок с `sync_status = pending` в `google_calendar_event_links`, но без активной задачи в outbox, показывал спиннер «Ожидает синхронизации» и опрашивал RPC каждые 15 с.
- **Причина:** `resolveLessonGoogleSyncUiStatus` трактовал `sync_status === "pending"` как UI `pending` даже без `has_pending_job`; `refetchInterval` крутился на любой UI `pending`.
- **Как избежать:** UI `pending` только при `has_pending_job`; orphaned link → `stale`; poll только при `has_pending_job`; invalidate `entry-sync-status` после CRUD персональных уроков.

### 2026-08-20 — org-scoped React Query key и invalidate/setQueriesData

- **Ошибка:** после мутаций UI не обновлялся (кнопки посещаемости, payroll, Google Calendar) без F5.
- **Причина:** `withOrgId([base, …filters])` ставит org id **последним** сегментом, а `withOrgId(base)` / `{ queryKey: withOrgId(base) }` ищет org id **вторым** — TanStack Query partial match не срабатывает.
- **Как избежать:** для cancel/get/set/invalidate org-кэша с фильтрами в ключе — `orgScopedQueryFilter(baseKey, organizationId)` из `lib/orgQueryFilter.ts`; не использовать `withOrgId(base)` как префикс для filtered queries.

### 2026-08-20 — Insert/update таблиц после createClient<Database>

- **Ошибка:** `Record<string, unknown>` не assignable к `RejectExcessProperties` при `.from("prices").update` / `.insert`.
- **Причина:** после `createClient<Database>` PostgREST ждёт `Tables.*.Insert` / `Update`, не динамический Record.
- **Как избежать:** собирать row как `Database["public"]["Tables"]["<table>"]["Insert"]` или `Update`; jsonb-аргументы RPC — `asJson`, не `any`. Junction-поля (disciplineIds, teacherMemberIds) — через sync-хелперы, в row prices только колонка `discipline_id` (`length === 1 ? id : null`).

### 2026-08-20 — Jsonb доменных интерфейсов: asJson на запись, normalizeTeacherScope на чтение

- **Ошибка:** `OrgModules`, `TeacherScope`, `MemberMeta` не assignable к `Json` при RPC/update; прямой cast `row.scope as TeacherScope` — TS2352.
- **Причина:** доменные интерфейсы без index signature; jsonb в Database — узкий `Json`.
- **Как избежать:** запись — `asJson(value)`; чтение scope — `normalizeTeacherScope(raw)`; meta — `as unknown as MemberMeta` только для plain object. В `SettingsProvider` деструктурировать `modules` из patch, не `{ ...patch, modules: asJson(...) }`.

### 2026-08-20 — Сгенерированные типы Database: шум Json vs реальная колонка

- **Ошибка:** `createClient<Database>` сразу дал ~35 ошибок tsc. Почти все — `Record<string, unknown>` / доменные интерфейсы (`OrgModules`, `TeacherScope`) не assignable к jsonb `Json`, плюс union `.from("table" | "view")`. Реальная опечатка колонки одна: `attendance.status` вместо `attendance_status` в офлайн-сверке (SELECT всегда падал). Отдельно — четыре TS2554 на module `t()` (см. запись ниже); это не шум Database-типов.
- **Причина:** клиент жил без generics; JSONB и динамический table/view не совпадают с узкими TS-типами приложения.
- **Как избежать:** после `db:gen-types` чинить только имена RPC/колонок. Не засыпать хуки `as any`. Jsonb-пейлоады — `Json` или `as Json`, table|view — раздельные query-ветки, не union-строка в `.from()`. Не списывать соседние TS2554 на каскад `TS2589`, пока не сверена сигнатура вызова.

### 2026-08-20 — Module `t()` без locale: TS2554 и сломанный перевод

- **Ошибка:** `t("common.client")` / `t("schedule.lessonInfo.clientNotSpecified")` в `personalLessonClients.ts` и `scheduleLessonAccess.ts`. `tsc` — TS2554 (ожидалось 2–3 аргумента). В рантайме строка ключа уходит в `locale`, ключ — `undefined`. Сначала это приняли за каскад `TS2589` (deep instantiation после union `.from()`).
- **Причина:** module-level `t` в `src/lib/i18n/core.ts` — `t(locale, key, params?)`. Одноаргументный `t` есть только у хука `useI18n`. Совпадение текста ошибки с «каскадом» после TS2589 не проверяли по сигнатуре.
- **Как избежать:** в `lib/` всегда `t(locale, key)` (`null` / `getGuestLocale()`, если locale нет на руках). Не менять сигнатуру `t()` в `core.ts` ради короткого вызова. Не считать TS2554 на `t("key")` каскадом, пока не открыт `core.ts`.

### 2026-08-20 — Мёртвый хелпер прямого paid-update

- **Ошибка:** `useUpdatePersonalPaid` делал `.update({ paid })` без payment RPC; вызовов не было, но хук оставался экспортированным. Повторное вешание на кнопку обошло бы ledger (урок `price=0` без платежа).
- **Причина:** опасный путь оставили «на всякий случай» после перехода на канонические RPC; заглушка `useRecordPayment` тоже жила без callers.
- **Как избежать:** не держать мёртвые write-хелперы, которые обходят ledger. Статус `paid` — только через канонические RPC (`record_personal_lesson_payment` / `sync_personal_lesson_paid_status` и аналоги).

### 2026-08-20 — CodeGraph MCP пропал из агента

- **Ошибка:** в чате агента не было сервера `codegraph` / `codegraph_explore`; аудит писал, что индекса нет.
- **Причина:** индекс `.codegraph/` был (gitignore), CLI работал. MCP stdio остановился 2026-08-18 после `snapshot_recovery`; в `.cursor/mcp.json` стояло `--path .`, а Cursor после recovery стартует MCP не из корня воркспейса — индекс не находится, процесс не поднимается. Glob `.codegraph/` агенту не показывает gitignored-каталог.
- **Как избежать:** в Cursor MCP для CodeGraph — абсолютный `--path` к репо и полный путь к `codegraph.cmd`; после зависания — Refresh в Settings → MCP или Reload Window. Статус индекса: `codegraph status`.

### 2026-08-20 — mark_attendance после early-return onMutate

- **Ошибка:** `useMarkAttendance` в `onMutate` выходил без optimistic update (`oldStatus===status`, freeze, `lessonsLeft`, нет sub), но `mutationFn` всё равно звал `mark_attendance` / `correct_attendance`. Сервер мог применить отметку, а кэш оставался старым до refetch.
- **Причина:** гарды жили только в `onMutate`; TanStack Query сначала ждёт `onMutate`, затем всегда вызывает `mutationFn`.
- **Как избежать:** общие гарды (`evaluateMarkAttendanceGuard`) до RPC; решение `onMutate` передавать в `mutationFn` (WeakMap по объекту vars), потому что после optimistic update кэш уже с новым статусом и повторная проверка по кэшу ложно пропустит RPC.

### 2026-08-20 — Write-on-read абонементов из каждого queryFn

- **Ошибка:** `useSubscriptions` на каждый fetch вызывал `apply_scheduled_subscription_member_changes` без проверки `{ error }`. Список абонементов рисовался как успешный, даже если смена партнёра не применилась. Несколько экранов (`SubscriptionsPanel`, `AttendancePanel` через `useSubsForDate`, `PayPersonalLessonModal`, …) монтировали хук параллельно; вместе с H7 `invalidateQueries()` RPC писали в БД с каждого refetch.
- **Причина:** мутационный RPC внутри read-`queryFn`; ошибка глоталась; нет once-per-org guard.
- **Как избежать:** список — чистый SELECT; apply — один раз при входе в org (bootstrap, как `useEnsureOwnMemberProfile`); `{ error }` не глотать (`reportClientError` / `{ success: false }`); не класть write в `queryFn`.

### 2026-08-20 — Query keys Google Calendar и personalLessons без org-scope

- **Ошибка:** после смены организации TanStack Query показывал binding/метрики синка Google Calendar, badge entry-sync-status и optimistic attendance персональных уроков из кэша предыдущей org.
- **Причина:** ключи `["google-calendar", "org-binding"]`, `team-sync-metrics`, `entry-sync-status` и `onMutate` в `useMarkPersonalLessonAttendance` не включали `organizationId`; invalidate/setQueriesData шли по глобальным префиксам.
- **Как избежать:** org-binding и team/org metrics — `withOrgId` + `enabled` от org; `googleCalendarSyncStatusQueryKey(organizationId, target)`; optimistic update только по `withOrgId(personalLessonsQueryKey)`; accounts пользователя оставлять без org.

### 2026-08-20 — Групповой слот: close без reopen на ветке successor

- **Ошибка:** при ошибке `update` successor после `closeScheduleSlotByDate` занятие исчезало из сетки (`valid_to` оставался установленным).
- **Причина:** ветка «есть successor» не делала rollback `valid_to = null`, в отличие от ветки insert; два последовательных запроса без транзакции.
- **Как избежать:** при любой ошибке после close — reopen исходного слота (`valid_to = null`); см. также 2026-06-22 (`useEditGroupSchedule` без rollback при failed INSERT). Для атомарности — RPC/транзакция в БД.

### 2026-08-20 — Тариф без дисциплин/преподавателей после сбоя sync

- **Ошибка:** `syncPriceTeacherMembers` / `syncPriceDisciplines` делали DELETE, затем INSERT; при падении INSERT связи оставались пустыми. `useCreatePrice` после успешного `prices.insert` при ошибке sync возвращал ошибку, но тариф оставался в прайсе.
- **Причина:** клиентские junction-sync без транзакции и без отката; create-price не удалял «полупустой» row.
- **Как избежать:** перед DELETE сохранять snapshot строк; при любой ошибке после DELETE — восстанавливать snapshot. При create-price при сбое sync — `DELETE` созданного тарифа (CASCADE снимет junction). Предпочтительнее серверный RPC в одной транзакции, если появится повторяющийся контур.

### 2026-08-20 — Повтор «до даты» без cap: бесконечный while и сотни freebusy

- **Дата:** 2026-08-20
- **Ошибка:** режим «до даты» без верхней границы генерировал сотни ISO-дат → последовательные Edge freebusy, тяжёлый conflict SELECT и bulk insert; не-ISO `endDate` мог зациклить `while` (лексикографика); freebusy не abort при unmount.
- **Причина:** нет `isIsoDateString` guard в expand; DatePicker weekly-end без `max`; нет client-side cap слотов; `invokeFunction` без timeout/AbortSignal; cleanup freebusy только debounce-timer.
- **Как избежать:** `dateRecurrenceLimits.ts` (cap 52/200, ISO guard, +12 мес); conflict-query только при `slots.length <= cap`; отказ insert в `useAddPersonalLessons`; AbortSignal + deadline в `useGoogleCalendarFreebusy`.

### 2026-08-20 — GCal sync UI: `detached` показывался как вечный `pending`

- **Дата:** 2026-08-20
- **Ошибка:** урок с `sync_status = detached` (событие удалено в Google) в попапе крутил спиннер «Ожидает синхронизации» и опрашивал RPC каждые 15 с бесконечно.
- **Причина:** `resolveLessonGoogleSyncUiStatus` в `else` возвращал `"pending"` для любого статуса вне `synced`/`failed`/`pending`; `refetchInterval` крутился на всё `ui === "pending"`.
- **Как избежать:** явные ветки `detached` и `unknown`; poll только при реальном pending job; cap на число poll-тиков → `stale` без interval.

### 2026-08-20 — PostgREST max_rows: тихая потеря данных в списках

- **Дата:** 2026-08-20
- **Ошибка:** справочники и журналы (clients, subscriptions, attendance, personal_lessons, payments) обрезались на 1000 строк без ошибки — UI показывал урезанный массив как полный.
- **Причина:** `max_rows = 1000` в PostgREST; клиент не читал `Content-Range` и не использовал `.range()` для следующих страниц.
- **Как избежать:** общий хелпер `fetchAllPostgrestRows` с циклом `.range()`; не поднимать `max_rows` вместо пагинации; ошибки PostgREST пробрасывать, не маскировать пустым `data`.

### 2026-08-20 — Reconnect-эффект в App: self-triggering цикл на 3 с

- **Дата:** 2026-08-20
- **Ошибка:** после восстановления связи toast «связь восстановлена» и invalidate/reconciliation срабатывали многократно в течение ~3 с (`justConnectionRestored`), штормили PostgREST.
- **Причина:** `showToast` → `setToast` → ререндер → новые `openReconciliation` / `invalidateAfterOfflineSync` (из-за немемоизированного `withOrgId`) → эффект снова; `counts.*` в deps усиливали повторы.
- **Как избежать:** `useCallback` для `withOrgId`, `openReconciliation`; ref на rising edge `justConnectionRestored`; не включать `counts` в deps — читать внутри обработчика импульса.

### 2026-08-20 — Цикл refreshSession при рассинхроне JWT и UI от JWT-роли

- **Дата:** 2026-08-20
- **Ошибка:** при `jwtRole !== membership.role` эффект в `OrganizationProvider` крутил бесконечный refresh (deps на объект `session`); UI показывал JWT-роль выше membership; `member_id` mismatch не ловился; после refresh — голый `invalidateQueries()`.
- **Причина:** `refreshSession()` всегда создаёт новый объект session даже при тех же claims; JWT-first для `role`/`memberId`; сравнение только ролей в эффекте.
- **Как избежать:** deps на fingerprint claims (`member_role` + `member_id` + `exp`), in-flight + лимит попыток; UI из membership при наличии строки; scoped invalidate; баннер и блок finance/settings при mismatch.

### 2026-08-20 — Оптимистичная посещаемость остаётся при soft-fail RPC

- **Дата:** 2026-08-20
- **Ошибка:** после ошибки RPC (`{ success: false }`) UI показывал toast, но список посещаемости и `lessonsLeft`/статус абонемента оставались в оптимистичном состоянии до следующего refetch.
- **Причина:** `mutationFn` возвращал `{ success: false }` без throw; TanStack Query вызывает `onError` только при reject, поэтому откат из `onMutate` не срабатывал.
- **Как избежать:** при soft-fail вызывать тот же `rollback` в `onSettled`, если `result.success === false`; инвалидировать кэш только при `success === true`. Контракт `{ success, error }` для `mutateAsync` сохранять, если UI проверяет `!res.success`.

### 2026-08-18 — Google Calendar: групповые уроки — один день в календаре, остальные не повторяются

- **Ошибка:** в Google Calendar групповой «Танго» 20:00 по понедельникам «размножался» каждую неделю (или оставался один recurring orphan), а среда/пятница не повторялись — в CRM только одна дата на слот в `google_calendar_event_links`.
- **Причина:** `removeStaleRecipientLinks` при upsert group occurrence удалял links/Google-события **всех других дат** того же `schedule_slot`, оставляя только последний обработанный occurrence.
- **Как избежать:** в `removeStaleRecipientLinks` сравнивать recipient только среди links с `occurrence_date === current.occurrenceDate`; для полного пересоздания использовать `refresh_member` (purge managed events + links, затем reconcile).

### 2026-08-17 — Google Calendar: «requires reconnection» после переподключения

- **Ошибка:** в карточке урока оставалась ошибка `Google account requires reconnection`, хотя пользователь прошёл OAuth заново.
- **Причина:** callback помечал аккаунт `active`, даже если Google не вернул новый `refresh_token`, и переиспользовал отозванный credential; worker при `status=revoked` не пытался refresh; reconcile после reconnect не запускался.
- **Как избежать:** при `revoked`/`error` требовать новый refresh token в callback; всегда пробовать refresh по сохранённому credential; после reconnect enqueue `reconcile_member` и auto-sync в Integrations.

### 2026-08-15 — Deep link в расписание открывал раздел, а не сетку с записью

- **Дата:** 2026-08-15
- **Ошибка:** кнопки «Открыть в расписании» из дебиторки вели на `/schedule`, но неделя/зал не раскрывались и запись не находилась.
- **Причина:** consume-эффект ждал `isFetching` только слотов недели и сразу чистил URL; персональные уроки и аренда ещё грузились, поиск не находил запись, сетки залов оставались свёрнутыми.
- **Как избежать:** ждать полный `useScheduleForWeek.isLoading` (слоты + персональные + аренда), ставить неделю из `?date=` до первого fetch, передавать `location`, раскрывать секцию зала и подсвечивать блок; popup не открывать автоматически.

### 2026-08-15 — Абонемент исчезает из журнала после последнего «Пришёл»

- **Дата:** 2026-08-15
- **Ошибка:** при отметке «Пришёл» на последнем занятии абонемент пропадал из списка журнала и не учитывался в счётчике пришедших.
- **Причина:** `computeSubsForDate` фильтровал только `subscriptionIsActiveForDate` (`lessonsLeft > 0`, `status === active`); после списания занятия оптимистичный кэш ставил `lessonsLeft = 0` и `status = finished`.
- **Как избежать:** в списке посещаемости на дату показывать абонементы с уже сохранённой отметкой на эту дату, даже если баланс исчерпан.

### 2026-08-10 — Кнопка «Урок оплачен» не нажимается при повторном открытии модалки

- **Дата:** 2026-08-10
- **Ошибка:** после успешной оплаты урока повторное открытие модалки показывало кнопку «Урок оплачен», клик ничего не делал.
- **Причина:** `usePaymentSubmitState` оставался в phase `saved` между открытиями модалки (компонент не размонтируется), а `handlePaySingle` выходит сразу при `phase === "saved"`.
- **Как избежать:** сбрасывать `paymentSubmit` при смене `lessonId`/открытии модалки; не полагаться на unmount для локального UI-state в always-mounted модалках.

### 2026-08-08 — Платёж в журнале при записи урока «Без оплаты»

- **Дата:** 2026-08-08
- **Ошибка:** после создания персонального урока в расписании без оплаты в разделе «Платежи» появлялась строка оплаты.
- **Причина:** `willRecordCashPayments` срабатывал для любого режима, кроме «пакет» (`bookingPaymentMode !== "package"`), включая `null`; `useAddPersonalLessons` всегда инвалидировал кэш `payments` после insert; venue-подтверждение могло повторно вызвать `handleBook(true)` без явного намерения оплатить.
- **Как избежать:** записывать оплату только при `immediatePaid && bookingPaymentMode === "single" && price > 0`; после создания неоплаченного урока не инвалидировать `payments`; хранить intent бронирования для venue-диалога; `paid` в маппере по умолчанию `no`.

### 2026-08-07 — `calendar.app.created` не даёт писать в основной календарь

- **Дата:** 2026-08-07
- **Ошибка:** worker получал Google API `404 Not Found` при вставке события в основной календарь пользователя.
- **Причина:** binding указывал на primary calendar, а OAuth-аккаунт имел strict scope `calendar.app.created`, который разрешает управлять только календарями, созданными приложением.
- **Как избежать:** в strict-scope режиме использовать выделенный календарь TangoDB; worker при 404 без существующего link создаёт такой календарь, атомарно обновляет binding и повторяет insert.

### 2026-08-07 — Просроченный lease блокировал всю очередь Google Calendar

- **Дата:** 2026-08-07
- **Ошибка:** `calendar-sync-worker` возвращал `Claim failed`, и готовые `pending` задачи не обрабатывались.
- **Причина:** пока задача была `processing`, повторный enqueue создавал отдельную `pending` строку с тем же `dedupe_key`; при истечении lease `claim_calendar_sync_jobs` пытался перевести старую строку в `retry` и нарушал partial unique index `idx_calendar_sync_outbox_pending_dedupe`.
- **Как избежать:** перед возвратом просроченных lease в `retry` удалять устаревшую `processing` строку, если уже существует более новая `pending/retry` задача с тем же tenant-safe dedupe key.

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
