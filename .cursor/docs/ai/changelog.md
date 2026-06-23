# Changelog

История значимых изменений кода. Обновлять при каждом изменении кода.

## Формат

```
YYYY-MM-DD — краткое описание (причина / контекст)
```

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
2026-06-19 — Типографика nav/logo: text-[8px]/text-[9px] заменены на text-[10px]/text-[11px] для читаемости и соответствия design system.
2026-06-19 — Аудит design system: CsvExportModal rounded-xl, ClientAutocomplete dropdown z-50, иконки stat-карточек Dashboard w-5 h-5.
2026-06-19 — Empty state: PricesPanel, DisciplinesPanel и AttendancePanel приведены к эталону (py-20, иконка w-8, text-sm).
2026-06-19 — Sell-панели и popup на md+: полная ширина под PageTabs, двухколоночные формы, шире модали; мобильный layout без изменений.
