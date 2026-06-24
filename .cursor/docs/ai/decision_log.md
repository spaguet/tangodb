# Decision Log

Архитектурные решения и обоснование выбора.

## Формат записи

- **Дата:** YYYY-MM-DD
- **Решение:** что выбрали
- **Контекст:** какая была задача
- **Альтернативы:** что рассматривали
- **Почему так:** итоговое обоснование

## Записи

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
