# Decision Log

Архитектурные решения и обоснование выбора.

## Формат записи

- **Дата:** YYYY-MM-DD
- **Решение:** что выбрали
- **Контекст:** какая была задача
- **Альтернативы:** что рассматривали
- **Почему так:** итоговое обоснование

## Записи

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

### Этап 0 — NAV-1, NAV-2, RBAC-6 (2026-06-20)

- **Дата:** 2026-06-20
- **Решение:**
  - **NAV-1 (B):** Скрыть пункт «Тарифы» в nav для accountant; `prices.read` сохранён для finance JOIN.
  - **NAV-2 (C):** Teacher home через `dashboard.scoped_summary` + `TeacherScopedDashboard` (расписание на сегодня, ближайшие персональные, быстрые ссылки) — без CRM-агрегатов.
  - **RBAC-6:** Убрать `disciplines.write` у admin; направления — только owner/director через `/settings/disciplines` (§4).
- **Контекст:** Regression QA CODE_REVIEW_ROLES.md — согласование nav и permissions до P1 bundle.
- **Альтернативы:** NAV-1 A (оставить /prices) — отклонено: лишний CRM-adjacent UI; NAV-2 A (скрыть Обзор) — отклонено: teacher нужен home; RBAC-6 оставить write — отклонено: противоречит «admin без стратегии».
- **Почему так:** Согласовано с tangodb_roles_rbac_TZ.md §4, §5.4, §5.5; минимальный diff в permissions.ts + новый компонент home.
