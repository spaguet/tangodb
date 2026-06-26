# TangoDB — модульное ТЗ для Dance CRM

> **Аудит:** 2026-06-26 (код `tangodb/` + `tangodb-dev-console/`, повторная сверка с запросом заказчика). Файл `crm_finance_minimal.md` в репозитории не найден — финансовая сверка ниже зафиксирована как адаптация уже перенесённых требований, а не как новая внешняя спецификация.
>
> **Пошаговый план для ИИ и заказчика:** §9.1 (краткая копия — файл `steps` в корне репозитория).
>
> **Связанные документы:** историческая платформенная спецификация — `tangodb_saas_platform_TZ.md` (multi-tenant v2, Dev Console, ключи). **Источник истины для порядка реализации модулей и SaaS** — этот файл (`tangodb_modular_dance_crm_TZ.md`). При расхождении следовать §6 и §8–§10 здесь.

> **Принцип:** эволюция существующей CRM, не переписывание. Hooks, RBAC/RLS и операционный контур не трогать без явной причины.

### Исправления аудита (2026-06-25)

| Найдено | Исправление в документе |
|---|---|
| **Сессия 2026-06-25 (SaaS review):** пользователь уточнил полный SaaS-сценарий — регистрация, demo, Telegram login, ручная покупка, команда, восстановление, i18n, валюты, защита | §8 расширен: S1–S10, Промты 8–17, §8.0–8.11; audit таблица актуализирована |
| `purge_expired_demo_organizations()` не удаляет business-данные | Текущий purge обнуляет members/settings/licenses и ставит `status = purged`, но **не** удаляет `clients`, `subscriptions`, `payments`, расписание и др. S5: явный DELETE business-таблиц или `DELETE FROM organizations` (CASCADE по FK) + retention-реестр email |
| После self-service demo `OrgWorkspaceRoute` всё равно ведёт на `/activate-key` | S1: после email/Telegram signup создавать `organization_members` + active org; обновить `VerifyEmailPage`, `routeGuards.tsx` — demo без ключа |
| Self-service demo + onboarding | `needsOnboarding` = placeholder org name (`OrganizationProvider`); S1: RPC создаёт demo org с пресетом `dance_school` и placeholder name → wizard **или** auto-complete onboarding с defaults (решение в S1, зафиксировать в `decision_log.md`) |
| «Главное меню» для CTA не было привязано к коду | §8.4: sidebar desktop (`App.tsx` `renderNav`), mobile drawer/bottom tabs — единые точки CTA |
| Месячная подписка отложена, но purge должен учитывать будущую подписку | §8.2: `organization_has_active_subscription()` уже есть; при реализации Stripe purge не трогает org с active subscription; сейчас UI Stripe — «Скоро» |
| Актуальная последняя миграция в репо — `20260719000001_...` | Любые новые изменения — только новыми миграциями поверх; не редактировать уже применённые |
| В §3.4 указана таблица `organization_modules` — в коде её нет | Модули хранятся в `organization_settings.modules` (JSONB) |
| Этап 1 и Этап 2 дублировали gating `group_subscriptions` / settings-флагов | Этап 1 = весь module gate; Этап 2 = только UX-упрощения форм |
| В Этапе 1 не хватало файлов (`DashboardPage`, `SettingsIndexRedirect`, fallback в `permissions.ts`) | Добавлены в таблицу Этапа 1 |
| `App.tsx` и `OrganizationProvider` не нормализуют JSONB (`settings?.modules ?? DEFAULT_ORG_MODULES`) | Явно зафиксировано как текущий баг; нормализация — часть Этапа 1 |
| Промты только для Этапа 1 и F1–F2; нет Этапа 2–3 и F3 | Добавлены Промты 2–6 |
| `findFirstAccessiblePanelPath` в `permissions.ts` не учитывает модули | Этап 1: module-aware fallback (расширить или обёртка в `orgModules.ts`) |
| `routeGuards.tsx` / `SettingsIndexRedirect` — fallback может вести в выключенную settings-секцию | Включено в критерии Этапа 1 |
| Gate-механизм для desktop nav (`if (section.moduleKey && !orgModules[section.moduleKey]) return null`) уже реализован в `App.tsx` `renderNav` | Зафиксировано в §2 и §3.2: нужно добавить `moduleKey` к секциям, механизм переписывать не нужно |
| Путь `scripts/rbac-regression-check.mjs` в таблице Этапа 1 неполный | Исправлено на `tangodb/scripts/rbac-regression-check.mjs` |
| Новый SaaS-сценарий «регистрация → демо CRM без ключа» конфликтует с текущим flow | Текущий код: email signup → `/activate-key`; демо создаётся через `access_keys.key_type = demo`. В §8 зафиксирован переход на self-service demo activation |
| Требование «отдельная база данных на пользователя» несовместимо с текущей Supabase-схемой | Сохраняем multi-tenant модель: отдельная `organization` как логическая база пользователя, все бизнес-таблицы изолированы `organization_id` + RLS; физические отдельные БД не создавать |
| В текущем purge после демо сохраняется запись `organizations` в статусе `purged`, а не только email | §8 требует добавить отдельный retention-реестр email владельца и после purge удалять/обезличивать бизнес-данные, сохраняя только минимальный email/hash и audit metadata |
| Telegram login уже есть, но не создаёт новую demo CRM для неизвестного Telegram ID | §8 добавлен этап Telegram self-service demo: verified Telegram → synthetic auth user → demo org без email/пароля; привязка telegram_id к профилю владельца |
| Stripe-подписка есть как заготовка, но пользователь просит месячную подписку пока не реализовывать | §8 помечает Stripe subscription UI/functions как отложенные; текущий purchase flow — ручная оплата + lifetime key |
| i18n есть только точечно (`ru-RU`, `en-US`, `vi-VN`), CRM в основном русскоязычная | §8 и S10/Промт 17 требуют полноценную английскую локализацию в самом конце SaaS-этапов |
| В проекте уже есть team invite по email, но SaaS-секция не описывала команду и восстановление доступа | Добавлены §8.8–8.9, этапы S8–S9 и промты 15–16: приглашение команды, owner-assisted recovery и emergency owner recovery |
| `currency_code` в БД ограничен `^[A-Z]{3}$`, а список валют в §8 включал `USDT` | `USDT` и монеты вынесены в payment instructions; CRM-валюты — только ISO-4217 |
| В §4 указана «последняя применённая миграция» `20260627000001...`, но в проекте есть более поздние миграции | Формулировка заменена: `20260627000001...` — последняя миграция, где определена `complete_organization_onboarding`; новые изменения — только миграцией поверх |
| В текущем `LicenseSettingsPage` Stripe-кнопки месяц/год активны | §8/S4 требуют скрыть или пометить их `Скоро`, пока месячная подписка не готова |
| В §8.8 роль `reception` была указана как отдельная роль команды | В коде и БД отдельной роли `reception` нет: кассир/ресепшен = `admin` + `meta.restricted_admin`; §8.8 и Промт 15 исправлены |
| Recovery code, Turnstile, QR и Stripe waitlist были описаны как предложения, хотя нужны для SaaS MVP | §8.4, §8.9, критерии и Промты 8/11/12/16 уточнены: recovery code при регистрации, Turnstile на `/register`, QR генерировать на клиенте из Dev Console config, Stripe — `Скоро` + waitlist |
| **Сессия 2026-06-26:** Dev Console не покрывает SaaS-support сценарии заказчика | Добавлен §8.11 и этап **DC1** + **Промт 18**: расширенный список org, owner email/имя, тип лицензии, размер базы, last login, restore password, ручной purge, payment config |
| Заказчик: purge строго через 30 дней без retention | §8.2: **целевая политика по умолчанию** — `data_purge_at = demo_expires_at`; read-only `demo_retention` опционален (§8.10 п.2) |
| `dev-console-search-orgs` не возвращает owner email, размер, last login, ключи | DC1: новый RPC/Edge Function `dev-console-list-tenants` с join auth.users + aggregates |
| В Dev Console нет UI восстановления пароля и ручного purge | DC1: `dev-console-reset-owner-password`, `dev-console-purge-org` + модалки в `OrgsPage.tsx` |
| `GeneralSettingsPage` — 4 валюты (`RUB/USD/EUR/VND`) | S6: `lib/currencies.ts` до 20 ISO-4217 |
| `RegisterPage` — только email/password, redirect на `/activate-key` | S1 без изменений в audit |
| `LicenseSettingsPage` — Stripe «Месяц/Год» активны, нет purchase UI (crypto/банк/МИР) | S4 |
| `OrgsPage` — name, version, status, created; без owner и actions | DC1 |
| Legacy demo-key flow всё ещё ставит `data_purge_at = now() + interval '60 days'` | S5 должен обновить/заменить и self-service, и старую ветку demo-key: целевой default — purge строго на 30-й день (`data_purge_at = demo_expires_at`) |
| `activate-access-key` включает `ACTIVATION_DEBUG` по умолчанию (`"true"`) | S7: debug-детали только при явном local/staging env; production default должен быть `false` |
| `dev-console-search-orgs` строит PostgREST `.or(...)` строкой из поискового ввода | DC1/S7: заменить на безопасный/экранированный поиск или RPC с параметрами; ограничить длину query; добавить поиск по email/payment_ref только backend-side |
| **Сессия 2026-06-26 (запрос заказчика):** нужен явный пошаговый план + ссылки на промты в одном документе | Добавлен §9.1; файл `steps` — краткий указатель на §9.1 |
| Заказчик: «MasterCard» и «МИР» — отдельные способы оплаты, не Stripe | §8.4–8.5: `bankTransfer` (международный перевод/карта) и `mir` — ручные реквизиты; Stripe checkout не основной flow |
| Заказчик: 30 дней → удаление, без read-only retention 31–60 | §8.2: целевой MVP **без** обязательной фазы `demo_retention`; S5 обновляет `run_demo_lifecycle` |
| `run_demo_lifecycle()` сейчас переводит `demo_active` → `demo_retention` на 31-й день | S5: либо прямой переход к purge на `demo_expires_at`, либо `demo_retention` = мгновенный блок + purge в тот же cron-run |
| `finance_basic` и `normalizeOrgModules` в коде отсутствуют | Этап 1 — блокер перед SaaS UI, но не блокер для S1 backend |
| Последняя миграция в репо — `20260719000001_personal_lessons_stage1.sql` | Подтверждено; новые изменения — только новыми файлами поверх |
| **Сессия 2026-06-26 (верификация требований заказчика):** заказчик верифицировал полный SaaS-сценарий — регистрация email/логин/пароль, demo 30 дней, Telegram login, ручная покупка (crypto QR / банк / МИР), поле активации ключа + 7-шаговая инструкция, Stripe «Скоро», контакты разработчика, команда + member recovery, owner emergency recovery, защита от взломов/инъекций, 20 ISO-4217 валют, Dev Console (CRM-базы клиентов, owner email/имя, ключи/версия, размер DB, last login, restore password popup, ручной purge, payment config CRUD), i18n en-US последним | ✅ все 18 пунктов §8.0 подтверждены как покрытые в §8.0–8.11, S1–S10, DC1, Промты 1–18; файл `steps` обновлён с инструкцией для ИИ, целями этапов и known incompatibilities |

### Результаты ревью (2026-06-26)

| Критерий | Статус |
|---|---|
| Последовательность разработки (модули + SaaS) | ✅ §6, §8.9, §9 |
| Промты для ИИ по этапам | ✅ Промты 1–17; добавлен **Промт 18** (Dev Console DC1) |
| Совместимость с текущим кодом | ✅ multi-tenant + RLS; self-service demo и SaaS UI — **не реализованы** |
| SaaS-сценарий заказчика | ✅ §8.0–8.11; purge/retention/team/recovery/i18n/валюты/защита |
| Dev Console для SaaS | 🟡 базовый MVP (metrics, keys, org search); **DC1** — расширение |
| Конфликт с `tangodb_saas_platform_TZ.md` | Исторический документ; при расхождении — **этот файл** (§6, §8–§10) |

---

## 1. Главный вывод

TangoDB — рабочая танцевальная CRM; операционный MVP закрыт примерно на 85–90%.

**Ядро (не переписывать):** клиенты, заметки, расписание, групповые абонементы, персональные уроки, посещаемость, тарифы, платежи/выручка/дебиторы, RBAC v2, teacher scope, onboarding/пресеты, экспорт, audit log.

**Ближайший фокус:** сначала закрыть module gate (`OrgModules` → nav/settings/route guards), затем доделать SaaS self-service: регистрация владельца, автоматическое создание 30-дневной demo CRM, демо-лейблы и CTA покупки, ручная покупка lifetime-лицензии через crypto/банк/МИР, активация ключом, контакты разработчика, команда по invite, восстановление доступа, защита от brute force/injection и только после этого полная английская локализация.

**Не делать:** физическую отдельную Supabase-базу на каждого demo-пользователя, обход RLS/service-role из клиента, реализацию месячной подписки сейчас, замену Stripe-заготовки на самописную подписку, миграции ради «идеальной» схемы, новые роли, матрицу «модуль × роль», отдельные приложения под пресеты, profit/cash-balance без expenses и ledger, статусы pending/cancelled для operational payments, налоги/счета-фактуры/прогнозы, лиды/портал/уведомления без отдельного ТЗ.

| Вопрос | Ответ |
|---|---|
| Переписывать CRM? | Нет |
| Следующий шаг | `normalizeOrgModules` + module gate + `finance_basic`, затем SaaS self-service demo |
| Главный пробел | Мёртвые флаги модулей; direct URL обходят module UI; demo сейчас требует ключ вместо self-service registration; нет описанного SaaS recovery flow |
| Из фин. ТЗ | Фильтры журнала, KPI owner, позже expenses/payroll |

---

## 2. Архитектура (факт по коду)

| Приложение | Путь | Назначение |
|---|---|---|
| CRM | `tangodb/` | React + Vite + TS, TanStack Query, Zustand, Supabase |
| Админ-консоль | `tangodb-dev-console/` | Ключи, биллинг, миграции — **не CRM-модули студии** |

| Слой | Где |
|---|---|
| Nav / routes | `App.tsx` — `NAV_SECTIONS`, `MOBILE_TABS`; `moduleKey` сейчас только у секции «Персональные уроки»; **gate-механизм `if (section.moduleKey && !orgModules[section.moduleKey]) return null` уже работает в `renderNav` для desktop nav** |
| Route guards | `auth/ProtectedRoute.tsx` реэкспортирует `auth/routeGuards.tsx`; `PanelAccessRoute` проверяет RBAC/settings sections, **без module gate** |
| RBAC UI | `lib/permissions.ts`, `hooks/usePermissions.ts`; `findFirstAccessiblePanelPath` — только RBAC |
| Модули org | `organization_settings.modules` (JSONB); типы в `types/organization.ts`, фильтры тарифов в `lib/orgModules.ts` |
| Нормализация modules | **Нет** — `OrganizationProvider.mapSettings` кастит JSONB как есть (`row.modules as OrgModules`); `App.tsx` использует `settings?.modules ?? DEFAULT_ORG_MODULES` без нормализации |
| Данные | `hooks/*` — единственная точка Supabase |
| RLS | `supabase/migrations/` — источник истины |

**Legacy:** `SchedulePanel.tsx` — deprecated, не развивать.

### 2.1. Маппинг panel / settings → module key

Централизовать в `lib/orgModules.ts` (функции `moduleKeyFromPanel`, `moduleKeyFromSettingsSection`, `isModuleEnabled`):

| UI / path | `PanelId` / settings section | Флаг `OrgModules` |
|---|---|---|
| `/finance/*`, financial tab на `/` | `finance` | `finance_basic` |
| `/subscriptions`, `/subscriptions/sell` | `subscriptions`, `subscriptions_sell` | `group_subscriptions` |
| `/personal`, `/personal/sell` | `personal`, `personal_sell` | `personal_lessons` |
| `/settings/disciplines` | `disciplines` | `multi_discipline` |
| `/settings/locations` | `locations` | `locations` |
| Тарифы pair/trio | — (не nav) | `pair_subscriptions`, `trio_lessons` — только фильтр в `orgModules.ts` |

---

## 3. Статус реализации

### 3.1. ✅ Готово

Клиенты, заметки, soft delete · расписание + группы (`classes`) · абонементы (freeze, monthly unlimited, subscription_groups) · персональные уроки (`/personal`) · attendance + excused · тарифы (pair/trio filter через `orgModules.ts`) · payments, `FinancialDashboard`, `/finance/*`, дебиторы · RBAC v2, кассир (`restricted_admin`) · teacher scope + masking · onboarding, пресеты, экспорт CSV · локации, направления, команда, audit log · gate-механизм в `renderNav` (desktop nav) для `moduleKey`.

### 3.2. 🟡 Пробелы и исправления аудита

| Область | Сейчас | Нужно (Этап 1) |
|---|---|---|
| **Module normalization** | JSONB кастится как `OrgModules`; новый ключ в старом JSONB → `undefined` | `normalizeOrgModules(raw)` в `orgModules.ts`: `{ ...DEFAULT_ORG_MODULES, ...raw }`; для **новых** ключей (сейчас только `finance_basic`) — `raw?.finance_basic ?? true` |
| **Module gate** | Gate-механизм в desktop nav работает, но `moduleKey` добавлен только к `personal_lessons`; `MOBILE_TABS` фильтрует только по RBAC; route guard не проверяет модули | Добавить `moduleKey` к секциям `group_subscriptions` и `finance_basic`; добавить `moduleKey?` к `MobileTabItem` + фильтр `MOBILE_TABS` по `orgModules`; module check в route guard |
| **`group_subscriptions`** | `moduleKey` отсутствует в секции `NAV_SECTIONS`; `solo_teacher` всё равно видит `/subscriptions` и mobile tab «АБОНЕМЕНТЫ» | Добавить `moduleKey: "group_subscriptions"` в секцию nav + фильтр `MOBILE_TABS` + route guard |
| **`personal_lessons`** | Desktop nav скрывается (`moduleKey` есть); direct URL `/personal/*` доступен при RBAC | Route guard + module-aware fallback |
| **`multi_discipline` / `locations`** | Флаги в JSONB; settings nav/route/fallback не учитывают | Скрыть секции; `SettingsIndexRedirect` и fallback в `routeGuards.tsx` не должны вести в выключенную секцию |
| **`finance_basic`** | Нет флага в `OrgModules`; `/finance`, `FinancialDashboard`, financial tab на `/` — только RBAC | Новый ключ + добавить `moduleKey: "finance_basic"` в nav + gating; операционная оплата при продаже **не** блокируется |
| **Журнал платежей** | Поиск по клиенту; `usePayments` поддерживает `dateFrom`/`dateTo`; CSV за месяц в `DataExportPage` | UI-фильтры — **F1**, после SaaS или по запросу |
| **Owner dashboard** | Карточки выручки за месяц, split, дебиторка, по method | MoM %, line 6 мес., pie/bar, топ-5 — **F2–F3** |
| **Payroll / расходы** | `/finance/payroll` — заглушка в `FinanceLayout.tsx`; таблицы `expenses` нет | **F5–F6** по запросу |

### 3.3. ⏸ Отложить

Лиды/воронка · guardians · уведомления · портал · онлайн-запись/оплата · документы/PDF · advanced analytics · прибыль/денежный остаток · inactive client 60d · напоминания о неоплате · архив данных · masterclass как категория (нет сущности).

### 3.4. 🚫 Не менять радикально

`organization_settings.modules` (JSONB, не отдельная таблица) · роль `reception` (есть кассир через `restricted_admin`) · rename `classes` → `groups` · замена action-based RBAC · удаление данных при выключении модуля · RLS ради UI-gate · `studio_id` / копирование схемы payments из мин. ТЗ · отдельное меню Owner без operational · ручной CRUD платежей бухгалтером (платежи из продаж).

---

## 4. Модель `OrgModules`

```ts
interface OrgModules {
  group_subscriptions: boolean;  // nav + route (после Этапа 1)
  personal_lessons: boolean;     // ✅ nav; ❌ route guard
  pair_subscriptions: boolean;   // ✅ filter тарифов (не nav)
  trio_lessons: boolean;         // ✅ filter тарифов (не nav)
  multi_discipline: boolean;     // settings nav + route (после Этапа 1)
  locations: boolean;            // settings nav + route (после Этапа 1)
  finance_basic: boolean;        // ➕ добавить, Этап 1
}
```

**Пресет `solo_teacher`:** `group_subscriptions: false`, но nav «Групповые абонементы» и mobile tab «АБОНЕМЕНТЫ» всё ещё видны — баг пресета (исправляется Этапом 1).

**Совместимость:** модули в JSONB `organization_settings.modules`; отдельная колонка не нужна. Добавление `finance_basic` требует:

1. Нормализации на клиенте (`normalizeOrgModules` в `OrganizationProvider` и везде, где читаются modules).
2. Новой миграции с обновлением default JSONB в RPC `complete_organization_onboarding` (`supabase/migrations/20260627000001_v2_complete_organization_onboarding.sql` — файл, где сейчас определён RPC; **не редактировать**, только новая миграция поверх).
3. Старые организации без ключа `finance_basic` → **`true`** (не лишать уже работающий финансовый контур).

**`PRESET_MODULES`:** для всех пресетов `finance_basic: true` (в т.ч. `solo_teacher` — персональная выручка). Обновить в `types/organization.ts` одновременно с добавлением ключа в `OrgModules`; `DEFAULT_ORG_MODULES` (`PRESET_MODULES.dance_school`) подхватит новый ключ автоматически через TypeScript.

| Бизнес-раздел | Флаг | Path |
|---|---|---|
| Клиенты, расписание, attendance, тарифы | всегда | `/clients`, `/schedule`, `/attendance`, `/prices` |
| Групповые абонементы | `group_subscriptions` | `/subscriptions` |
| Персональные | `personal_lessons` | `/personal` |
| Финансы | `finance_basic` | `/finance`, financial tab на `/` |
| Направления / локации | `multi_discipline` / `locations` | `/settings/disciplines`, `/settings/locations` |

**Нюанс `finance_basic`:** выключение скрывает раздел «Финансы» (отчёты, журнал, дебиторы, financial export в `DataExportPage`, вкладку «Финансовый» на `/`), но **не блокирует** приём оплаты в операционных формах продажи (`SellPackageModal`, `PayPersonalLessonModal` и т.д.).

**Алгоритм `normalizeOrgModules` (черновик):**

```ts
export function normalizeOrgModules(raw: Partial<OrgModules> | null | undefined): OrgModules {
  const merged = { ...DEFAULT_ORG_MODULES, ...(raw ?? {}) };
  return {
    ...merged,
    finance_basic: raw?.finance_basic ?? true, // backward compat для нового ключа
  };
}
```

---

## 5. Роли (сохранить)

`owner` · `director` · `admin` · `teacher` · `accountant` · кассир = `admin` + `restricted_admin`.

**Доступ:** `модуль включён?` → `PermissionAction?` → RLS. Module gate не заменяет RBAC.

**Сверка с `crm_finance_minimal.md` (адаптация, не замена RBAC):**

| Мин. ТЗ | TangoDB | Дополнения |
|---|---|---|
| Бухгалтер | `accountant` | Фильтры журнала + CSV за период; позже expenses/payroll CSV. Основной сценарий — **чтение и экспорт**, не ручной ввод платежей |
| Владелец | `owner`/`director` | KPI и графики на `FinancialDashboard`; operational + financial tab на `/` |
| Админ | `admin` | Операционная CRM + оплата при продаже; KPI не ограничивать |
| Преподаватель | `teacher` | Scope + masking; свой payroll — только после F6 |

TangoDB шире мин. ТЗ: у бухгалтера есть `/finance/revenue` и `/finance/debtors` — **оставить**, это полезные дополнения, не дублировать отдельный раздел «Экспорт» в nav (CSV уже в `DataExportPage`).

---

## 6. Последовательность разработки

```
Этап 0 ✅ → Этап 1 (module gate) → S1–S4 + DC1 (SaaS) → S5–S10 → F1–F3 / Этап 2–3 по запросу → F4–F6 по запросу
```

### Этап 1 — Module gate (следующий, ~12–14 файлов, 1 SQL-миграция)

| Файл | Изменение |
|---|---|
| `types/organization.ts` | `finance_basic: boolean` в `OrgModules`; обновить `PRESET_MODULES` (все пресеты + `finance_basic: true`) |
| `lib/orgModules.ts` | `normalizeOrgModules`, `isModuleEnabled`, `moduleKeyFromPanel`, `moduleKeyFromSettingsSection`, `findFirstEnabledAccessiblePanelPath` (или расширить `findFirstAccessiblePanelPath` в `permissions.ts` параметром `modules`) |
| `organization/OrganizationProvider.tsx` | Заменить `row.modules as OrgModules` на `normalizeOrgModules(row.modules)` в `mapSettings` |
| `App.tsx` | Добавить `moduleKey: "group_subscriptions"` к секции «Групповые абонементы»; `moduleKey: "finance_basic"` к секции «Финансы»; добавить `moduleKey?` к `MobileTabItem`; фильтр `MOBILE_TABS` по `orgModules`; заменить `settings?.modules ?? DEFAULT_ORG_MODULES` на `normalizeOrgModules(settings?.modules)` |
| `auth/routeGuards.tsx` | Module check в `PanelAccessRoute` **до** RBAC; module-aware fallback для settings и dashboard |
| `lib/permissions.ts` | Module-aware `findFirstAccessiblePanelPath` (принимает `OrgModules`) **или** вызов helper из `orgModules.ts` |
| `pages/DashboardPage.tsx` | Скрыть financial tab / `FinancialDashboard` при `!finance_basic` |
| `settings/SettingsLayout.tsx` | Gate `disciplines`/`locations` по modules |
| `settings/SettingsIndexRedirect.tsx` | Первый доступный раздел с учётом module gate (не редиректить в `disciplines`/`locations` при выключенных флагах) |
| `settings/pages/DataExportPage.tsx` | Скрыть financial export при `!finance_basic` |
| `settings/pages/OrganizationSettingsPage.tsx` | Чекбокс `finance_basic` в `MODULE_LABELS` |
| `auth/OnboardingWizardPage.tsx` | Чекбокс `finance_basic` в `MODULE_LABELS` |
| `supabase/migrations/YYYYMMDDHHMMSS_finance_basic_module_default.sql` | Default JSONB + `complete_organization_onboarding` с `finance_basic: true`; не редактировать предыдущую миграцию `20260627000001_v2_complete_organization_onboarding.sql` |
| `tangodb/scripts/rbac-regression-check.mjs` | Минимальные проверки module fallback (если удобно расширить) |

**Критерии приёмки:**

- [ ] `solo_teacher`: нет nav/mobile/route на `/subscriptions*`
- [ ] Выключенный `personal_lessons`: redirect с `/personal/*`
- [ ] Выключенный `finance_basic`: нет nav `/finance`, нет financial tab на `/`, нет financial export; redirect с `/finance/*`
- [ ] Выключенные `multi_discipline`/`locations`: нет settings sections; fallback не ведёт туда
- [ ] RBAC, операционные продажи и RLS не сломаны
- [ ] `npm run lint` в `tangodb/`

### Этап 2 — UX-упрощения (после стабильного gate, без новых флагов)

Не дублирует gating из Этапа 1. Только UX:

- Скрыть location picker / селект зала, если `locations: false` или одна локация в org.
- Упростить выбор направления при `multi_discipline: false` (одно направление по умолчанию).
- Проверить формы расписания, продажи, клиента — не показывать лишние поля.

Затронутые области: `components/schedule/*`, формы продажи, `DisciplineSelect` — точный список определить при реализации.

### Этап 3 — UX настроек модулей

Группировка чекбоксов в `OrganizationSettingsPage` / `OnboardingWizardPage`: «Разделы CRM» / «Форматы занятий» / «Инфраструктура»; пояснение «выключение скрывает раздел, данные сохраняются».

### Этап 4+ — По запросу

Guardians · pipeline (`lead/active/archived` в clients) · F5 expenses · F6 payroll.

---

## 7. Финансы — сверка с `crm_finance_minimal.md`

> Дополняют существующие `payments`, `FinancialDashboard`, `/finance/*`. Схему `payments` **не расширять** без появления ручных «прочих» операций.

### 7.1. Уже закрыто (минимальный финансовый контур)

| Мин. ТЗ | TangoDB |
|---|---|
| Реестр платежей | `FinancePaymentsPage`, таблица `payments` |
| Категория прихода | Derived: абонемент / персональный (`paymentSourceLabel`) |
| Способ оплаты | `method`: cash, transfer, card, other |
| Выручка, дебиторы | `FinanceRevenuePage`, `FinanceDebtorsPage`, `financial_debtors_v` |
| Дашборд (карточки) | `FinancialDashboard` — выручка, split, дебиторка, по method |
| RLS accountant/operational | `can_read_financial` / `can_read_operational` |
| CSV платежей | `exportFinancialCsv` + `DataExportPage`; месяц для журнала платежей |
| Одна валюта | `organization_settings.currency_code` |

### 7.2. Маппинг полей (не менять без необходимости)

| Мин. ТЗ | TangoDB |
|---|---|
| `studio_id` | `organization_id` |
| `category` | derived из `subscription_id` / `personal_lesson_id` |
| `source` (касса/банк) | `method` (способ, не ledger касса/банк) |
| `status` | нет — платёж = факт оплаты при продаже |
| `payment_date` | `created_at` |
| `note` | нет — только при ручных «прочих» платежах |

### 7.3. Подэтапы F1–F6 (технически после Этапа 1, продуктовый приоритет — после SaaS)

| # | Scope | Миграция | Зависимости |
|---|---|---|---|
| **F1** | Фильтры `FinancePaymentsPage`: период, источник, способ; `usePayments({ dateFrom, dateTo })` | Нет | Этап 1; сейчас после SaaS или по запросу |
| **F2** | MoM %, line chart 6 мес., pie/bar по видам услуг; расширить `financeReports.ts` | Нет | F1 желательно |
| **F3** | Новые клиенты, топ-5 клиентов/преподавателей, выручка/препод, заполняемость | Возможно view/RPC — оценить нагрузку | F2 |
| **F4** | «Выписка за период» только если `DataExportPage` недостаточно | Нет | — |
| **F5** | `expenses` + `/finance/expenses`, CRUD accountant/owner | **Да** | Этап 1 |
| **F6** | `teacher_settlements` + замена заглушки `/finance/payroll` | **Да** | F5, продуктовое решение по ставкам |

**F5 schema (черновик):** `id, organization_id, amount, category, description, expense_date, created_at` — категории rent/utilities/marketing/salary/other. Прибыль = выручка − расходы **только после F5**. Денежный остаток не считать без ledger касса/банк.

**F6 schema (черновик):** `teacher_settlements` — period, amount_accrued/paid/balance; teacher read только своя строка. Перед F6 — продуктовое решение по ставкам/комиссиям.

### 7.4. Взять из мин. ТЗ

- Разделение задач: accountant = таблицы/фильтры/CSV; owner = здоровье бизнеса на dashboard.
- Периодные CSV-выгрузки — основной бухгалтерский интерфейс; внешняя бухпрограмма остаётся снаружи.
- KPI: MoM %, тренд 6 мес., split услуг, новые клиенты, заполняемость, топ-5.

### 7.5. Не брать из мин. ТЗ

Отдельное приложение Owner · статусы paid/pending/cancelled · ручной ввод всех платежей · налоги/амортизация/прогнозы/CAC/LTV · Excel до запроса · блокировка admin от KPI · переименование таблиц под `studio_id`.

### 7.6. Бизнес-правила

| Правило | Действие |
|---|---|
| Платёж не в будущем | Сейчас `now()` при продаже; проверка — только при ручном `payment_date` / expenses |
| Преподаватель не удаляется с будущими занятиями | Guard перед F6 |
| Клиент inactive 60d без платежей | Отложить (computed badge) |
| Пересчёт выручки | ✅ TanStack Query invalidation |
| Одна валюта | ✅ `currency_code` |

### 7.7. Критерии F1–F3

- [x] **F1:** `FinancePaymentsPage` — период, источник, способ оплаты; «Итого» пересчитывается; пустое состояние корректно
- [x] CSV в `DataExportPage` без регрессии; прямой CSV в журнале не добавлять без отдельного требования
- [x] **F2:** `FinancialDashboard` — MoM %, line 6 мес., pie/bar по split абон./перс.
- [x] **F3:** новые клиенты за период, топ-5, заполняемость — без тяжёлых N+1 на клиенте

**F5/F6:** детальный план — `tangodb_expenses_payroll_plan.md` (Промт 7, 2026-06-26). Реализация — **Промт 19** (F5), **Промт 20** (F6).

---

## 8. SaaS — целевой сценарий и доработка

### 8.0. Требования заказчика (сводка → этапы)

| # | Требование | Этап | Статус в коде |
|---|---|---|---|
| 1 | Публичная ссылка `/register`: email, логин (display name), пароль; подтверждение email | S1 | ❌ нет login; после verify → `/activate-key` |
| 2 | Логическая изоляция CRM-базы пользователя (`organization_id` + RLS, не физическая БД) | S1 | ✅ модель есть |
| 3 | После входа — demo CRM с **полным** функционалом, 30 дней | S1, S3 | ❌ demo только через ключ |
| 4 | Через 30 дней удалить demo-данные; сохранить только email владельца (anti-abuse), если нет lifetime; monthly sub — **позже**, но заложить в purge-логику | S5 | 🟡 lifecycle есть; purge неполный; retention email нет |
| 5 | Вход через Telegram без email/пароля; `telegram_id` → профиль владельца | S2 | 🟡 auth есть; новый TG ID → 403 |
| 6 | Метка `ДЕМО-ВЕРСИЯ` под логотипом/названием CRM | S3 | ❌ |
| 7 | CTA «Купить полную версию» в главном меню и в «Обзор и статистика» | S3 | ❌ |
| 8 | Покупка: crypto (QR), банк/MasterCard, МИР; ключ на email после ручной проверки | S4 | 🟡 activation key есть; purchase UI нет |
| 9 | Поле активации + инструкция в CRM | S4 | 🟡 ключ в `LicenseSettingsPage`; инструкции/реквизиты нет |
| 10 | Месячная подписка Stripe — **не реализовывать сейчас** | S4 | ❌ кнопки «Месяц/Год» активны |
| 11 | Контакты разработчика: email, Telegram, WhatsApp | S4, S6 | ❌ |
| 12 | До 20 валют ISO-4217 в CRM | S6 | 🟡 4–5 в `GeneralSettingsPage` |
| 13 | Английская версия CRM — **последний** этап | S10 | 🟡 i18n только team/license/settings nav |
| 14 | Защита: brute force ключей, injection, RLS, Telegram spoofing, массовые demo | S1, S7 | 🟡 частично (rate limit TG, hash keys); Turnstile на `/register` нет |
| 15 | Владелец приглашает команду (email + пароль через invite) | S8 | ✅ базовый flow есть |
| 16 | Восстановление участника: reset по email; при утрате email — через владельца | S8 | 🟡 reset есть; UI-подсказки owner — нет |
| 17 | Восстановление владельца: reset пароля; при утрате email — manual через разработчика + emergency recovery code | S1, S9 | ❌ support flow и recovery code не описаны в UI |
| 18 | Dev Console: список CRM-баз клиентов, owner email/имя, ключ/версия, размер, last login, restore password, ручной purge | DC1 | 🟡 `OrgsPage` — только name/status/created; нет owner/actions |

### 8.1. Факт по текущему коду

| Область | Сейчас | Несостыковка с целевым SaaS |
|---|---|---|
| Email registration | `/register` принимает email/password, подтверждение email через Supabase Auth, затем отправляет на `/activate-key` | Нет поля `login`; CRM не создаётся автоматически после email verification |
| Demo access | Демо создаётся через `access_keys` (`key_type = demo`) и `activate_access_key`; есть `request-demo-key` | Целевой сценарий требует self-service demo без ручной выдачи demo-key |
| Tenant isolation | Одна Supabase DB, бизнес-таблицы изолированы `organization_id`, RLS и JWT active org | Требование «база пользователя не пересекается с другими» реализовывать как логическую tenant-базу, не как отдельную физическую БД |
| Demo lifecycle | `demo_active` 30 дней → `demo_retention`; `data_purge_at` сейчас +60 дней от активации; `purge_expired_demo_organizations()` | Целевой: через 30 дней без lifetime — удалить business-данные; хранить только email/hash. **Баг:** purge не удаляет clients/schedule/payments — только members/settings/licenses и `status = purged` |
| Legacy demo-key activation | `activate_access_key` в миграциях `20260621000001...` / `20260626000002...` создаёт demo только после ключа и ставит purge через 60 дней | При S1/S5 не оставить две разные lifecycle-политики: self-service demo и старый demo-key flow должны вести к одной strict-30 модели или demo-key должен быть выведен из публичного flow |
| Onboarding после demo | `needsOnboarding` если имя org — placeholder; wizard после key activation | S1: определить auto-demo preset vs обязательный wizard; не блокировать demo функционал |
| Lifetime license | Есть `access_keys.key_type = lifetime`, `activate-access-key`, `LicenseSettingsPage`, Dev Console `KeysPage` | Нужно добавить purchase UI/инструкцию/реквизиты/контакты; ключ после оплаты отправляет разработчик вручную |
| Stripe subscription | Есть `organization_subscriptions`, `create-subscription-checkout`, UI месяц/год | Сейчас не реализовывать месячную подписку: скрыть/отключить CTA подписки до готовности |
| Telegram login | Есть `telegram-auth`, Telegram Login Widget/Mini App, привязка `telegram_id` к существующему user | Неизвестный Telegram ID получает 403; нет self-service demo org без email/password |
| Team invite | Есть `settings/team`, `organization_invites`, `/accept-invite`, edge functions `invite-member`/`preview-invite`/`complete-invite`; участник создаёт пароль по invite | В SaaS-ТЗ нужно явно оставить owner/director invite flow и добавить recovery flow через владельца |
| Password recovery | Есть `/auth/forgot-password` и `/auth/reset-password` через Supabase Auth | Работает только если email доступен; для утраты email владельца нужен manual recovery через разработчика |
| Demo label / CTA | Есть статусы лицензии и read-only banner | Нет явного «ДЕМО-ВЕРСИЯ» под логотипом/названием CRM и постоянного CTA «Купить полную версию» в menu/dashboard |
| I18n | Есть точечный `lib/i18n` для нескольких экранов | Большая часть CRM — hardcoded Russian; английскую версию делать последним этапом |
| Валюты | `currency_code` — 3 заглавные буквы (`CHECK currency_code ~ '^[A-Z]{3}$'`), UI сейчас даёт `RUB/USD/EUR/VND` | Добавить curated list до 20 ISO-4217 валют, не менять схему; crypto не писать в `currency_code` |
| Dev Console orgs | `OrgsPage` + `dev-console-search-orgs`: name, slug, status, CRM version, created | Нет owner email/имени, размера tenant-данных, last login, привязанного ключа, payment_ref, restore password, ручного purge |
| Dev Console keys | `KeysPage`: generate / manual payment → lifetime key | Ключ не отправляется на email автоматически — разработчик копирует вручную (соответствует MVP) |
| Security defaults | `activate-access-key` имеет rate limit и hash+pepper, но debug default сейчас включён; `dev-console-search-orgs` использует строковый PostgREST `.or` для поиска | S7: production debug off by default; безопасный поиск/валидация query в Dev Console; audit без plaintext секретов |

### 8.2. Архитектурное решение

**Изоляция данных:** не создавать отдельную физическую БД на каждого пользователя. В текущем Supabase-проекте правильная модель — одна организация = логическая база пользователя/студии. Все CRM-данные должны иметь `organization_id`, RLS должен проверять active organization/member claims. Это дешевле, проще в миграциях и уже совместимо с кодом.

**Login/display name:** в email-сценарии поле «логин» реализовать как `display_name`/публичное имя владельца, а не как отдельный способ входа. Фактический credential остаётся email+password. Отдельный username login не добавлять в MVP: он усложняет восстановление, unique constraints и anti-enumeration.

**Demo lifecycle:** целевое поведение для пользователя — **30 дней полного доступа** ко всем модулям CRM. На 30-й день, если нет lifetime-лицензии (и в будущем — active subscription), CRM блокируется и **все business-данные demo удаляются**. Сохраняется только минимальный anti-abuse след в отдельном retention-реестре (не в `organizations`): `owner_email` или `owner_email_hash`, опционально `telegram_id_hash`, даты demo/purge, `purged_at`. Строка `organizations` после purge **удаляется** (`DELETE` → CASCADE по FK на clients, subscriptions, payments, schedule и т.д.) **или** business-таблицы очищаются явным RPC до обезличивания org — предпочтительно `DELETE FROM organizations WHERE id = ...` после записи в retention.

**Целевая политика по умолчанию (формулировка заказчика):** 30 календарных дней **полного** доступа (`demo_active`) → на `demo_expires_at` CRM блокируется, business-данные удаляются (`data_purge_at = demo_expires_at`). В retention-реестре остаётся только email/hash владельца. Lifetime-ключ или будущая active subscription отменяют purge.

**Отличие от `tangodb_saas_platform_TZ.md` §3.9:** исторический документ описывает фазу `demo_retention` (дни 31–60, read-only). **Целевой SaaS MVP по запросу заказчика — без этой фазы:** после 30 дней данные удаляются, а не хранятся ещё 30 дней в read-only. В S5 обновить `run_demo_lifecycle()` и cron: не оставлять org в `demo_retention` с `data_purge_at = now() + 60 days` (как в legacy demo-key flow).

Опциональное смягчение (§8.10 п.2 — **только** если явно включить в `decision_log.md`, не по умолчанию):

- **Вариант B+:** `demo_active` 30 дней → краткий read-only **до 7 дней** + напоминания → purge на `data_purge_at = demo_expires_at + interval '7 days'`. Снижает риск потери данных без предупреждения; **не** дефолт.

**Реализация purge (S5, обязательно):** текущая `purge_expired_demo_organizations()` **не соответствует** требованию — business-данные остаются в БД. Новая версия RPC должна: (1) записать retention; (2) удалить org row или все business-таблицы по `organization_id`; (3) не затрагивать `licensed` org и org с `organization_has_active_subscription()`.

**Onboarding после self-service demo:** RPC `create_self_service_demo_org` создаёт org + owner member + `organization_settings` с пресетом demo. Два допустимых UX:

- **A (рекомендуется):** placeholder name → пользователь проходит существующий `OnboardingWizardPage` (название, пресет, locale, modules) — полный функционал CRM доступен сразу после wizard.
- **B:** auto-complete onboarding в RPC с defaults (`dance_school`, `ru-RU`, `RUB`) → сразу на dashboard.

**Покупка полной версии:** месячную подписку **не реализовывать** в текущем цикле. Основной путь — manual payment → developer verifies → Dev Console generates lifetime key → developer sends key to email/Telegram/WhatsApp → owner activates in CRM. Stripe UI и Edge Functions оставить как заготовку (`Скоро` + waitlist §8.10 п.10), без checkout. При будущей подписке `organization_has_active_subscription()` уже участвует в `organization_allows_writes` — purge должен её уважать.

**Команда и recovery:** владелец/директор приглашает команду в ту же логическую CRM-базу через email invite. Участник регистрируется по invite, задаёт пароль и получает `organization_members` запись с ролью/scope. Восстановление пароля участника — стандартный Supabase reset, а если email участника утрачен, владелец/директор деактивирует старого member и отправляет новый invite на новый email. Восстановление владельца при утрате email нельзя автоматизировать безопасно: нужен manual support flow через разработчика с проверкой lifetime key/payment proof/Telegram binding/данных организации и обязательным audit log.

### 8.3. Целевой пользовательский flow

1. Пользователь переходит по публичной ссылке `/register` с серверно проверяемым Turnstile/challenge-токеном.
2. Выбирает способ входа:
   - Email: вводит email, login/display name и пароль; подтверждает email.
   - Telegram: входит через Telegram Login Widget или Mini App; email/пароль не требуются.
3. После подтверждения (email) или успешной Telegram-авторизации (новый пользователь) backend создаёт demo organization:
   - owner = текущий auth user;
   - `status = demo_active`;
   - `demo_activated_at = now()`;
   - `demo_expires_at = now() + interval '30 days'`;
   - `data_purge_at = demo_expires_at` (strict 30 дней, §8.2);
   - `organization_settings` + owner `organization_members`;
   - active org в JWT (`user_active_organizations`);
   - **без** ввода demo-key; redirect **не** на `/activate-key`.
4. Пользователь проходит onboarding (вариант A/B из §8.2) и попадает в CRM с полным функционалом demo.
5. После создания demo CRM пользователь один раз получает Emergency Recovery Code (см. §8.10 п.1) и предупреждение сохранить его безопасно.
6. Под логотипом/названием CRM (`App.tsx` sidebar header, mobile drawer header) — `ДЕМО-ВЕРСИЯ` (+ опционально «NN дней осталось», §8.10 п.2). В **главном меню** (desktop sidebar nav, mobile drawer nav) и **вверху «Обзор и статистика»** (`DashboardPage` / `OperationalDashboard`) — CTA `Купить полную версию`.
7. На странице покупки (`/settings/license?purchase=1` или отдельный route) пользователь выбирает **один из трёх способов** (не Stripe):
   - `Криптовалюта`: QR-коды и адреса для BTC, ETH, USDT (TRC20/ERC20), TON и других монет из Dev Console config.
   - `Банковский перевод / MasterCard`: реквизиты счёта или карты для международного перевода (beneficiary, IBAN/SWIFT, при необходимости last4 карты).
   - `МИР`: отдельный блок реквизитов для оплаты через систему МИР (получатель, телефон/карта, банк).
   - Контакты разработчика на той же странице: **email**, **Telegram**, **WhatsApp** (кликабельные ссылки).
8. После оплаты пользователь связывается с разработчиком или ждёт письмо. Разработчик вручную проверяет оплату и выдаёт lifetime key через Dev Console.
9. Пользователь открывает `Настройки → Лицензия` (`/settings/license`) или `/activate-key`, вводит ключ в поле «Активировать полную версию» — CRM становится licensed.
10. Владелец/директор приглашает команду: `Настройки → Команда` → invite по email → участник задаёт пароль на `/accept-invite`.
11. Участник: forgot password → email reset; потеря email → owner деактивирует member + новый invite.
12. Владелец: forgot password → email reset; потеря email → manual recovery через разработчика (S9; Emergency Recovery Code §8.10 п.1 как один из факторов).
13. Без lifetime (и в будущем без active subscription) до purge — business-данные удаляются; в retention остаётся только email/hash владельца.

### 8.4. UI и контент, которые нужно добавить

| UI | Требование | Файлы (ориентир) |
|---|---|---|
| `/register` | Поле `Логин` (display name → `user_metadata.display_name` / `organization_members.display_name`); Turnstile token; после email verification — auto demo org, **не** `/activate-key`; показать Emergency Recovery Code один раз после создания demo | `RegisterPage.tsx`, `VerifyEmailPage.tsx`, `AuthProvider.tsx` |
| Telegram tab | Новый Telegram ID → demo org; существующий → login как сейчас | `LoginPage.tsx`, `telegram-auth` |
| Sidebar/logo block | `ДЕМО-ВЕРСИЯ` + срок demo под названием CRM | `App.tsx` (sidebar + mobile header) |
| Главное меню | CTA `Купить полную версию` в desktop sidebar nav и mobile drawer nav (owner/director, demo) | `App.tsx` `renderNav`, mobile drawer |
| Dashboard «Обзор и статистика» | Demo banner + CTA вверху страницы | `DashboardPage.tsx`, `OperationalDashboard.tsx` |
| License/Purchase page | Crypto QR, Bank/MasterCard, МИР; инструкция; поле активации ключа; QR генерировать на клиенте из публичного payment config | `LicenseSettingsPage.tsx`, опционально `ActivateKeyPage.tsx` |
| Контакты разработчика | Email, Telegram, WhatsApp — кликабельные; из `platform_payment_methods` / config | `LicenseSettingsPage.tsx`, footer CTA в demo banner (S3) |
| Activation instructions | Инструкция (точный текст для UI): **1.** Выберите удобный способ оплаты на этой странице. **2.** Переведите оплату по указанным реквизитам. **3.** Свяжитесь с разработчиком через email, Telegram или WhatsApp — укажите ваш email регистрации и подтверждение платежа (скриншот или номер транзакции). **4.** Разработчик проверит платёж и отправит ключ активации на ваш email. **5.** Войдите в CRM, откройте «Настройки → Лицензия». **6.** Введите ключ в поле «Активировать полную версию» и нажмите «Активировать». **7.** Страница обновится — CRM переключится в полную версию. Метка «ДЕМО-ВЕРСИЯ» исчезнет. |
| Subscription UI | Кнопки Stripe `Месяц/Год` скрыть или пометить `Скоро`; добавить waitlist email/org; edge functions оставить как заготовку, но не делать основным flow |
| Team invite | Сохранить `Настройки → Команда`: приглашение по email, имя/фамилия, роль, scope; участник задаёт пароль на `/accept-invite` |
| Member recovery | В карточке/списке команды добавить понятный сценарий: reset password по email; при потере email — деактивировать старого member и отправить новый invite |
| Owner recovery | Добавить инструкцию в auth/license/help: пароль сбрасывается по email; при утрате owner email обращаться к разработчику и проходить ручную проверку владения |

### 8.5. Оплата и конфигурация

Не хранить приватные ключи, seed phrases и секреты платёжных систем в репозитории. В CRM хранить только публичные payment instructions:

```ts
type ManualPaymentConfig = {
  crypto: Array<{
    coin: "BTC" | "ETH" | "USDT_TRC20" | "USDT_ERC20" | "TON" | string;
    network: string;
    address: string;
    uriTemplate?: string; // optional deep link, QR генерируется на клиенте
  }>;
  bankTransfer: {
    beneficiary: string;
    bankName?: string;
    ibanOrAccount: string;
    swiftOrBic?: string;
    cardLast4?: string;
    note: string;
  };
  mir: {
    recipient: string;
    phoneOrCard: string;
    bankName?: string;
    note: string;
  };
  contacts: {
    email: string;
    telegramUrl: string;
    whatsappUrl: string;
  };
};
```

Для MVP конфиг можно держать в безопасной публичной таблице `platform_payment_methods` с RLS `SELECT true`, управлять через Dev Console. Не класть реальные реквизиты в `.env` клиента, если они должны меняться без деплоя. QR для crypto генерировать в `LicenseSettingsPage` на клиенте (`react-qr-code` или `qrcode`) из `address`/`uriTemplate`; статические QR-картинки не хранить как источник истины.

### 8.6. Валюты

Схему менять не нужно: `organization_settings.currency_code` уже хранит 3-буквенный код и форматируется через `Intl.NumberFormat`. Добавить UI-список до 20 популярных **ISO-4217** валют:

`RUB`, `USD`, `EUR`, `GBP`, `CNY`, `JPY`, `KRW`, `TRY`, `KZT`, `AED`, `THB`, `VND`, `IDR`, `INR`, `BRL`, `MXN`, `CAD`, `AUD`, `CHF`, `SGD`.

`USDT`, `BTC`, `ETH`, `TON` и другие монеты не включать в `currency_code`: текущий DB check пропустит только 3 буквы, но `Intl.NumberFormat` не гарантирует корректное отображение crypto. Crypto использовать только в payment instructions/QR.

### 8.7. Защита и anti-abuse

| Риск | Требование |
|---|---|
| Подбор license key | Хранить только hash + pepper; сравнение на backend; rate limit по IP/user/email; audit log попыток; одноразовый lifetime key; запрет debug в production |
| Повторные demo | Unique lower(email) для старых demo-key уже есть; для self-service demo добавить owner_email_hash/telegram_id_hash retention после purge; ограничить повторную demo-регистрацию; Turnstile на `/register` |
| SQL/JS injection | Supabase query builder/RPC params; никакой конкатенации SQL; sanitize display name/login; React escaping; не использовать `dangerouslySetInnerHTML` для payment instructions |
| RLS bypass | Service role только в Edge Functions/Dev Console; клиент не получает service keys; все business tables проверяют `organization_allows_reads/writes` и active organization |
| Telegram spoofing | Проверять подпись Telegram Login Widget/Mini App по bot token; rate limit по IP и telegram_id; не доверять client-side telegram id |
| CORS/CSRF | Edge Functions: allowlist origins, OPTIONS handling, Authorization required для private endpoints |
| Brute force login | Supabase Auth policies + UI throttling; не показывать, существует ли email; нормальные сообщения ошибок |
| XSS в реквизитах/контактах | Реквизиты выводить как текст/ссылки с whitelist протоколов `mailto:`, `https://t.me/`, `https://wa.me/`; QR генерировать из валидированной строки адреса/URI, без `dangerouslySetInnerHTML` |
| Debug leakage | `ACTIVATION_DEBUG` и аналогичные флаги должны быть `false` по умолчанию; подробности ошибок показывать только в local/staging при явном env |
| Dev Console search injection / malformed filter | Не собирать `.or(...)`/PostgREST filters напрямую из пользовательского ввода; экранировать `%`, `_`, `,`, `(`, `)`, ограничить длину query или вынести поиск в RPC/Edge Function с параметрами |
| Демо purge | Purge через SECURITY DEFINER RPC/service role; audit before/after; dry-run test; не удалять licensed org |

### 8.8. Команда и восстановление доступа

**Текущая база:** в проекте уже есть `settings/team`, `organization_invites`, `/accept-invite`, `invite-member`, `preview-invite`, `complete-invite`, `ForgotPasswordPage`, `ResetPasswordPage`. Это использовать как основу, не дублировать.

| Сценарий | Решение |
|---|---|
| Владелец приглашает сотрудника | `Настройки → Команда`: email, имя/фамилия, роль (`admin`, `teacher`, `accountant` и др. из текущей схемы), scope; invite действует 7 дней |
| Сотрудник принимает invite | `/accept-invite?token=...`: email из invite read-only, пользователь задаёт пароль; создаётся/активируется `organization_members` |
| Сотрудник забыл пароль | `/auth/forgot-password` → Supabase reset email → `/auth/reset-password` |
| Сотрудник потерял email | Владелец/директор деактивирует старого member, отправляет новый invite на новый email; старый user/member не переиспользовать без проверки |
| Владелец забыл пароль, email доступен | Стандартный reset password по owner email |
| Владелец потерял email | Не делать автоматическое восстановление. Manual support через разработчика: проверить payment proof/lifetime key, Telegram binding, данные организации, последние платежи/даты; после проверки developer меняет owner email или создаёт нового owner через service-role tool с audit log |
| Telegram owner | Если Telegram ID привязан и подпись проверена backend-only, можно использовать как дополнительный фактор в manual recovery, но не как единственное доказательство владения |

**Важно по ролям:** отдельной роли `reception` в БД нет. Ресепшен/кассир остаётся ролью `admin` с `meta.restricted_admin = true`; в UI можно показывать как «Кассир/ресепшен», но в invite/RPC нельзя писать роль `reception`.

**Правила безопасности recovery:**

- Не показывать, существует ли email/organization.
- Все recovery-действия владельца через developer/support писать в audit log.
- Для смены owner email требовать минимум 2 фактора: подтверждённый платёж/lifetime key + доступ к Telegram/WhatsApp/email, который был указан в покупке, или ручная проверка данных организации.
- Не давать участнику команды восстанавливать owner-доступ без подтверждения владельца или developer support.
- Не переносить demo-историю на новый email, если old owner email уже purged/anti-abuse record совпадает с заблокированным demo.

### 8.9. Последовательность SaaS-разработки

```
Этап 1 (module gate) → S1 self-service demo email → S2 Telegram demo → S3 demo UI/CTA → S4 manual purchase/lifetime activation → DC1 Dev Console tenant admin → S5 purge/retention → S6 currencies/contact → S7 security → S8 team/recovery → S9 owner recovery → S10 English localization
```

| Этап | Scope | Миграции | Зависимости |
|---|---|---|---|
| **S1** | Email registration: login/display name, Turnstile, email verification, auto-create demo org, Emergency Recovery Code | Да: RPC/Edge Function для self-service demo; retention/recovery table | Этап 1 желательно |
| **S2** | Telegram self-service demo без email/password, привязка telegram_id к owner profile | Да: hash/retention для telegram anti-abuse; возможно synthetic user policy | S1 |
| **S3** | Demo label, срок demo, CTA «Купить полную версию» в sidebar/menu/dashboard | Нет | S1 |
| **S4** | Purchase page: crypto QR from Dev Console config, bank/MasterCard, МИР, contacts, activation instructions; Stripe `Скоро` + waitlist | Да/возможно: `platform_payment_methods`, `platform_waitlist` | S3 |
| **DC1** | Dev Console: расширенный список tenant/org, owner support actions (§8.11) | Да: RPC `estimate_org_storage`, optional `platform_org_notes`; Edge Functions | S1, S4 |
| **S5** | Demo lifecycle: 30-day policy (`data_purge_at = demo_expires_at`), purge business data, retention email/hash | Да | S1, DC1 желательно |
| **S6** | До 20 валют + contact developer config in settings/license | Нет или лёгкая config table | S4 |
| **S7** | Security hardening: rate limits, audit, production debug off, tests for key brute force/RLS/purge | Да/нет по результатам аудита | S1–S6, DC1 |
| **S8** | Team invite в SaaS-flow + member password/email recovery через owner/director | Нет или лёгкая Edge Function/RPC для resend/recovery hints | S1–S7 |
| **S9** | Owner emergency recovery через developer/support, recovery code как один из факторов, audit log, manual owner email transfer | Да, если нет support/audit структуры | S7–S8, DC1 |
| **S10** | Полная английская версия CRM после заморозки русского текста | Нет | Последний этап |

### 8.9.1. Критерии приёмки SaaS (S1–S10)

- [ ] **S1:** новый email → verify → demo org без ключа; login/display name сохранён; Turnstile проверяется на backend; Emergency Recovery Code показан один раз; повторный demo на тот же email заблокирован; lifetime flow не сломан
- [ ] **S2:** новый Telegram ID → demo org + вход; известный TG → login; подпись только backend; anti-abuse по telegram hash
- [ ] **S3:** `ДЕМО-ВЕРСИЯ` под логотипом; CTA в sidebar/mobile menu и на dashboard; owner/director only
- [ ] **S4:** purchase UI: crypto QR генерируется на клиенте из Dev Console config, bank, МИР, contacts, 7-step instruction; activation key; Stripe «Скоро» + waitlist
- [ ] **S5:** через 30 дней без lifetime — business-данные **удалены** (`data_purge_at = demo_expires_at` по умолчанию); retention email/hash; licensed org не затронуты; lifetime отменяет purge; будущий `organization_has_active_subscription()` также отменяет purge
- [ ] **S6:** 20 ISO-4217 валют в settings/onboarding; форматирование сумм корректно
- [ ] **S7:** rate limit activation keys; audit попыток; no service role in client; Turnstile на register проверен backend-only (§8.10 п.7)
- [ ] **S8:** owner invite → accept → login; member reset; owner deactivate + re-invite при потере email
- [ ] **S9:** owner password reset; emergency transfer только через Dev Console/support + audit; recovery code проверяется только как дополнительный фактор
- [ ] **S10:** `en-US` без смешанного русского UI на основных маршрутах
- [ ] **DC1:** таблица org с owner email/именем, demo/licensed, размер, last login, ключ (метаданные); restore password; ручной purge с подтверждением; payment config CRUD; audit всех admin actions

### 8.10. Предложения по реализации

Приоритеты ниже делятся на обязательные для SaaS MVP и дополнительные улучшения. Обязательные: **1, 6, 7, 10, 12**. Остальные реализовывать после завершения основных этапов S1–S9, если не мешают выпуску.

**1. Emergency Recovery Code при регистрации**
После успешного создания demo org показывать пользователю одноразовый аварийный код восстановления (12 символов, формат `XXXX-XXXX-XXXX`). Хранить только `bcrypt`-хэш. Пользователь сохраняет код — он становится дополнительным фактором при manual recovery владельца вместо требования только payment proof. При активации lifetime key: аннулировать старый код и генерировать новый. Показывать один раз с кнопкой «Скопировать» и предупреждением «Сохраните в безопасном месте — повторно не отобразится».

**2. Индикатор дней демо с визуальным акцентом**
Вместо статичного `ДЕМО-ВЕРСИЯ` показывать `ДЕМО · NN дней осталось`. При N ≤ 7 — amber, N ≤ 3 — red. Tooltip с точной датой окончания. Создаёт ненавязчивую срочность к покупке без блокировок.

**3. Telegram-уведомление перед окончанием демо**
Если к аккаунту привязан Telegram ID, отправлять напоминание через бота за 7, 3 и 1 день до окончания демо с кнопкой-ссылкой на страницу покупки. Реализовывать через `pg_cron`/Supabase scheduled tasks + Edge Function. Telegram bot token хранить в Vault Edge Function secrets.

**4. Тестовые данные при старте демо**
При создании demo org предлагать опцию «Заполнить демо-данными»: 10–15 клиентов, 2 группы, несколько занятий, несколько платежей. Пользователь сразу видит CRM в работе без ручного заполнения. Seed-данные помечать флагом `is_demo_seed = true` и удалять вместе с организацией при purge. Seed реализовать как отдельный RPC.

**5. Платёжная ссылка (payment reference)**
При переходе на страницу покупки генерировать уникальный `payment_ref` (8 символов, uppercase). Пользователь указывает его в комментарии к платежу или в теме письма. Разработчик в Dev Console ищет org по `payment_ref` и одним кликом выдаёт lifetime key. Снижает ошибку при ручном подборе владельца по email; особенно полезно при большом числе демо.

**6. Динамическая генерация QR-кодов**
Для адресов BTC/ETH/USDT генерировать QR на клиенте через библиотеку (`react-qr-code` или `qrcode`) из адреса в `platform_payment_methods`. Это позволяет менять адреса кошельков в Dev Console без перегенерации и загрузки изображений. Для TON и других монет формировать deep-link URI по их стандарту (`ton://transfer/...`). Статические QR-картинки не использовать как источник истины.

**7. Cloudflare Turnstile / hCaptcha на регистрации**
Добавить invisible CAPTCHA на `/register` и `/auth/forgot-password`. Защита от автоматических массовых demo-регистраций и брут-форса сброса пароля. Cloudflare Turnstile предпочтителен — нет friction для реального пользователя, ключи в env Edge Function, валидация на сервере.

**8. Magic link как альтернатива паролю**
Supabase поддерживает Magic Link (вход по email без пароля). Предложить как опцию при регистрации и входе: пользователь кликает ссылку в письме и попадает в CRM без ввода пароля. Особенно удобно при первом входе после email verification — пользователь уже в почте. При наличии Magic Link пароль можно задать позже в настройках профиля.

**9. Dev Console: дашборд активных демо и ожидающих оплат**
Добавить в Dev Console таблицу: активные demo org, email владельца, дата начала, дней осталось, статус Telegram, payment_ref (если реализован). Отдельный фильтр «Ожидают оплаты» после контакта с разработчиком. Снижает время реакции на подтверждение платежа и выдачу ключа.

**10. Stripe subscription: плейсхолдер «Скоро»**
Вместо полного скрытия Stripe-кнопок показать карточку «Месячная подписка — скоро» с полем для email уведомления. Собирает заинтересованных в подписной модели без реализации биллинга. Данные хранить в `platform_waitlist` (email, org_id, created_at): no public read, запись через Edge Function/service role с rate limit.

**11. Централизованный список валют (`lib/currencies.ts`)**
Единый curated list для `GeneralSettingsPage`, `OnboardingWizardPage` и format helpers — избежать рассинхрона (сейчас 4–5 валют в двух местах).

**12. Retention-реестр `demo_owner_retention`**
Отдельная таблица (service role write, no public read): `owner_email_hash`, optional `telegram_id_hash`, `first_demo_at`, `purged_at`, `payment_ref`. Не хранить PII plaintext дольше необходимого для anti-abuse; plaintext email — только если нужен для support lookup в Dev Console (ограничить RLS).

### 8.11. Dev Console — управление SaaS-клиентами (DC1)

**Принцип:** `tangodb-dev-console/` — отдельное приложение; **никакого** прямого Postgres/service role в браузере. Все операции — через Edge Functions с проверкой `platform_role=developer` (`devAuth.ts`).

#### 8.11.1. Что уже есть (не дублировать)

| Экран / function | Сейчас |
|---|---|
| `DashboardPage` | Platform metrics: org count, licensed/demo counts, DB size estimate |
| `KeysPage` | Generate lifetime key; manual payment → issue key (ключ показывается один раз) |
| `OrgsPage` | Search by name/slug/status; колонки name, CRM version, status, created |
| `BillingPage` | Subscription search/adjust (заготовка Stripe) |
| `dev-console-search-orgs` | Базовый список organizations без owner PII |
| `dev-console-metrics`, `dev-console-generate-key`, `dev-console-issue-key` | Работают |

#### 8.11.2. Целевая таблица организаций (CRM-базы клиентов)

Расширить `OrgsPage` (или новый route `/tenants`) — **единая таблица** self-service и key-activated org:

| Колонка | Описание | Источник |
|---|---|---|
| **Название CRM** | `organizations.name` — «логическая база» клиента | `organizations` |
| **Owner email** | Email владельца (вход в CRM) | `auth.users.email` по `organizations.owner_user_id` (Admin API, только Dev Console EF) |
| **Owner имя** | Логин/display name при регистрации | `organization_members.display_name` WHERE role=`owner` или `user_metadata.display_name` |
| **Telegram** | Привязан / ID (маскированный) | `auth.users` raw app_metadata `telegram_id` |
| **Версия** | Demo или полная (lifetime) | `organizations.status` + `organization_licenses.license_type`; badge: `Демо` / `Lifetime` / `Subscription`* |
| **CRM version** | Major-версия продукта | `crm_product_versions.code` |
| **Ключ доступа** | Не plaintext: `key_type`, `status`, последние 4 символа prefix если есть, `activated_at` | `access_keys` JOIN `organizations.access_key_id`; lifetime — `consumed` после активации |
| **Payment ref** | 8-символьный ref для ручной оплаты (§8.10 п.5) | `organizations.payment_ref` или `demo_owner_retention` |
| **Размер базы** | Оценка объёма данных **этой** org | RPC `estimate_org_storage(p_org_id)` — сумма `COUNT(*)` по tenant-таблицам + optional `pg_total_relation_size` heuristic; показывать в KB/MB |
| **Demo до** | Дата окончания demo | `demo_expires_at`; дней осталось — computed |
| **Last login** | Последний вход owner (или любого active member — уточнить в UI как «Last owner login») | `auth.users.last_sign_in_at` owner; fallback MAX по members |
| **Created** | Дата создания org | `organizations.created_at` |
| **Действия** | см. §8.11.3 | — |

\* Subscription — только badge «Subscription» когда Stripe готов; сейчас не активировать checkout из CRM.

**Фильтры:** status (`demo_active`, `demo_retention`, `licensed`, `purged`, `suspended`); «Demo истекает ≤7 дней»; «Ожидают оплаты» (есть `payment_ref` / note без lifetime); поиск по email/name/payment_ref.

#### 8.11.3. Действия администратора (обязательные)

| Действие | UI | Backend | Audit |
|---|---|---|---|
| **Выдать lifetime key** | Кнопка в строке org → pre-fill owner email → modal с ключом (reuse `dev-console-issue-key`) | Существующий EF + optional `organization_id` link | `key.issue`, org_id, actor |
| **Восстановить доступ (пароль)** | Кнопка «Восстановить доступ» → modal: сгенерированный **одноразовый пароль** (12+ символов) + «Скопировать» + предупреждение передать owner по email/TG/WA | Edge Function `dev-console-reset-owner-password`: Admin API `updateUserById` + `platform_audit_log`; **не** логировать plaintext пароль | `owner.password_reset_by_support`, org_id, owner_user_id hash |
| **Сменить owner email** | Только из детальной карточки org + modal с причиной (S9) | `dev-console-transfer-owner-email` — 2FA checklist в UI, не public | `owner.email_transfer`, old/new hash |
| **Ручной purge** | Кнопка «Удалить базу» для `demo_retention` / просроченных / abandoned demo; двойное подтверждение + ввод org name | Edge Function `dev-console-purge-org` → RPC purge одной org (та же логика S5) + retention record | `org.manual_purge`, reason |
| **Suspend / unsuspend** | Toggle для abuse | Update `organizations.status` | `org.suspend` |
| **Заметка support** | Inline note в карточке org | `platform_org_notes(org_id, note, updated_by)` — optional table | `org.note_update` |
| **Открыть payment config** | Link на `/payment-methods` (новая страница Dev Console) | CRUD `platform_payment_methods` через EF | `payment_config.update` |

**Restore password flow (важно):**

1. Admin нажимает «Восстановить доступ» в строке org.
2. Backend генерирует cryptographically secure password, устанавливает через Supabase Admin API.
3. Modal показывает пароль **один раз**; admin передаёт owner через email/Telegram/WhatsApp (контакты из §8.5).
4. Owner входит email+новый пароль; рекомендуется сменить пароль в профиле (future `/settings/account`).
5. Plaintext пароль **не** пишется в audit/логи.

**Ручной purge:** только для org без lifetime и без active subscription; licensed org purge **запрещён** без явного override + audit reason «legal request» / «duplicate test org».

#### 8.11.4. Дополнительные экраны Dev Console (рекомендуется)

| Экран | Назначение |
|---|---|
| **`/payment-methods`** | CRUD crypto addresses, bank/MIR, developer contacts — источник для CRM `LicenseSettingsPage` |
| **`/demo-queue`** | Активные demo + «истекает через N дней» + быстрая выдача ключа (расширение §8.10 п.9) |
| **Org detail drawer** | Members list, row counts (clients, subscriptions, payments), cron purge eligibility, history audit events |
| **Cron health** | Last run `demo-lifecycle` / purge job, `purged_count`, failures — на Dashboard |

#### 8.11.5. RPC `estimate_org_storage` (черновик)

```sql
-- SECURITY DEFINER, service_role only
-- Возвращает: total_rows, estimated_bytes, breakdown jsonb { clients, subscriptions, payments, ... }
SELECT sum(cnt) FROM (
  SELECT count(*) AS cnt FROM clients WHERE organization_id = p_org_id
  UNION ALL SELECT count(*) FROM subscriptions WHERE organization_id = p_org_id
  -- ... остальные tenant-таблицы
) t;
-- estimated_bytes ≈ total_rows * 2048 (heuristic) или sum(pg_column_size) sample
```

Точную формулу зафиксировать в `decision_log.md`; для MVP достаточно row counts + heuristic KB.

#### 8.11.6. Edge Functions (новые / расширить)

| Function | Назначение |
|---|---|
| `dev-console-list-tenants` | Заменяет/расширяет search-orgs: owner email/name, storage, last login, key metadata, payment_ref |
| `dev-console-reset-owner-password` | Admin reset owner password, return one-time password in response |
| `dev-console-purge-org` | Manual single-org purge |
| `dev-console-transfer-owner-email` | S9 support tool |
| `dev-console-payment-methods` | GET/PUT public payment config |
| `dev-console-org-detail` | Members + row counts + audit tail |

#### 8.11.7. Файлы для реализации DC1

| Файл | Изменение |
|---|---|
| `tangodb-dev-console/src/pages/OrgsPage.tsx` | Расширенная таблица, фильтры, action buttons, modals |
| `tangodb-dev-console/src/pages/PaymentMethodsPage.tsx` | **Новый** — CRUD payment config |
| `tangodb-dev-console/src/components/Layout.tsx` | Nav: Tenants, Payment methods |
| `tangodb/supabase/functions/dev-console-list-tenants/index.ts` | **Новый** |
| `tangodb/supabase/functions/dev-console-reset-owner-password/index.ts` | **Новый** |
| `tangodb/supabase/functions/dev-console-purge-org/index.ts` | **Новый** |
| `tangodb/supabase/migrations/..._org_storage_and_notes.sql` | `estimate_org_storage`, optional `platform_org_notes`, `organizations.payment_ref` |

---

## 9. Этапы — сводка

| Этап | Статус | Промт |
|---|---|---|
| 0 — Базовая CRM + RBAC v2 | ✅ | — |
| 1 — Normalize modules + module gate + `finance_basic` | 🔲 **Следующий** | Промт 1 |
| S1 — Self-service demo via email + Turnstile/recovery code | 🔲 после 1 | Промт 8 |
| S2 — Telegram demo signup | 🔲 после S1 | Промт 9 |
| S3 — Demo UI + CTA purchase | 🔲 после S1 | Промт 10 |
| S4 — Manual purchase + lifetime key activation + waitlist | 🔲 после S3 | Промт 11 |
| DC1 — Dev Console tenant admin + support tools | 🔲 после S1/S4 | Промт 18 |
| S5 — Demo purge/retention | 🔲 после S1/DC1 | Промт 12 |
| S6 — Валюты + контакты разработчика | 🔲 после S4 | Промт 13 |
| S7 — Security hardening | 🔲 после S1–S6 | Промт 14 |
| S8 — Team invite + member recovery | 🔲 после S7 | Промт 15 |
| S9 — Owner emergency recovery | ✅ (2026-06-26) | Промт 16 |
| S10 — English localization | 🔲 последним | Промт 17 |
| F1 — Фильтры журнала платежей | ✅ (2026-06-26) | Промт 2 |
| F2 — KPI и графики owner | ✅ (2026-06-26) | Промт 3 |
| F3 — Расширенная аналитика dashboard | ✅ (2026-06-26) | Промт 4 |
| 2 — UX-упрощения форм | ⏸ после gate/SaaS | Промт 5 |
| 3 — UX настроек модулей | ⏸ | Промт 6 |
| 4 — Guardians / pipeline | ⏸ по запросу | отдельный ТЗ |
| F5–F6 — Expenses / Payroll | ✅ план (2026-06-26) | Промт 7 → **Промт 19** (F5) → **Промт 20** (F6) |

### 9.1. Пошаговый план разработки (шаги и промты для ИИ)

> **Источник истины:** этот файл. Перед каждым этапом агент читает `.cursor/docs/ai/AI_CONTEXT.md`, затем **только** разделы и файлы из промта этапа (§10).
>
> **Главный порядок:** Этап 1 → S1 → S2 → S3 → S4 → DC1 → S5 → S6 → S7 → S8 → S9 → S10
>
> **Не начинать** F1–F6 и UX-этапы 2–3 до закрытия SaaS MVP, если отдельно не попросят.

| # | Шаг | Раздел ТЗ | Промт (§10) | Цель |
|---|-----|-----------|-------------|------|
| 1 | **Этап 1** — Module gate | §4, §6 | **Промт 1** | `finance_basic`, `normalizeOrgModules`, скрытие выключенных модулей в nav / mobile / settings / routes |
| 2 | **S1** — Self-service demo email | §8.0–§8.4, §8.9 | **Промт 8** | `/register`: email + login (display name) + пароль; Turnstile; verify email → demo CRM **без ключа**; Emergency Recovery Code |
| 3 | **S2** — Telegram demo signup | §8.3, §8.7, §8.9 | **Промт 9** | Новый Telegram ID → demo CRM без email/пароля; известный ID → вход как сейчас |
| 4 | **S3** — Demo UI + CTA | §8.3–§8.4 | **Промт 10** | `ДЕМО-ВЕРСИЯ` под логотипом; CTA «Купить полную версию» в меню и на «Обзор и статистика» |
| 5 | **S4** — Ручная покупка + activation | §8.4–§8.5, §8.10 | **Промт 11** | Crypto QR, банк/MasterCard, МИР, контакты, инструкция активации; Stripe → «Скоро» + waitlist |
| 6 | **DC1** — Dev Console SaaS-support | §8.11 | **Промт 18** | Список CRM-баз, owner email/имя, demo/lifetime, размер, last login, ключ metadata, restore password, manual purge, payment config |
| 7 | **S5** — Demo purge / retention | §8.2, §8.9, §8.10 | **Промт 12** | Strict 30 дней; удалить business-данные; retention email/hash; не трогать lifetime и будущую subscription |
| 8 | **S6** — Валюты + контакты | §8.6 | **Промт 13** | До 20 ISO-4217 валют; контакты developer в license/purchase UI |
| 9 | **S7** — Security hardening | §8.7 | **Промт 14** | Rate limit ключей, audit, Turnstile backend-only, безопасный Dev Console search, production debug off |
| 10 | **S8** — Team + member recovery | §8.8 | **Промт 15** | Owner invite → accept; reset password; deactivate + re-invite при потере email участника |
| 11 | **S9** — Owner emergency recovery | §8.8, §8.11 | **Промт 16** | Восстановление владельца через developer/support; recovery code как доп. фактор; audit |
| 12 | **S10** — English localization | §8, §10 | **Промт 17** | Полная `en-US` версия CRM — **последним**, после заморозки русских SaaS-текстов |

**Отложено после SaaS MVP или по отдельному запросу:**

| Этап | Промт |
|------|-------|
| F1 — фильтры журнала платежей | Промт 2 |
| F2 — KPI и графики owner | Промт 3 |
| F3 — расширенная аналитика dashboard | Промт 4 |
| Этап 2 — UX-упрощения форм | Промт 5 |
| Этап 3 — UX настроек модулей | Промт 6 |
| F5/F6 — expenses / payroll (сначала план) | Промт 7 ✅ → `tangodb_expenses_payroll_plan.md` |
| **F5** — expenses (реализация) | **Промт 19** |
| **F6** — payroll (реализация) | **Промт 20** (после F5) |

**Следующая работа (после закрытия SaaS MVP и F1–F3):**

```
Промт 7 ✅ (план) → Промт 19 (F5 expenses) → Промт 20 (F6 payroll)
```

Один запрос = один промт. F6 не начинать до завершения F5.

**Как давать задачу ИИ:** скопировать текст нужного промта из §10 целиком и указать «реализуй этап N». Не смешивать несколько промтов в одном запросе.

**Проверенные несовместимости с кодом (на 2026-06-26):** `/register` → `/activate-key`; Telegram unknown user → 403; Stripe «Месяц/Год» активны в `LicenseSettingsPage`; `purge_expired_demo_organizations` не удаляет clients/payments; Dev Console `OrgsPage` без owner/actions; 4 валюты в `GeneralSettingsPage`; `finance_basic` / `normalizeOrgModules` отсутствуют; legacy demo-key ставит `data_purge_at + 60 days`; `ACTIVATION_DEBUG` default `"true"`.

---

## 10. Промты для ИИ

Использовать **по одному промту на этап**. Перед каждым промтом агент обязан прочитать `.cursor/docs/ai/AI_CONTEXT.md` и только релевантные файлы из списка промта.

### Промт 1 — Module Gate (Этап 1)

```text
Изучи `tangodb_modular_dance_crm_TZ.md` (§4, §6 Этап 1), `.cursor/docs/ai/AI_CONTEXT.md`, затем:
- `tangodb/src/types/organization.ts`
- `tangodb/src/lib/orgModules.ts`
- `tangodb/src/lib/permissions.ts`
- `tangodb/src/organization/OrganizationProvider.tsx`
- `tangodb/src/App.tsx`
- `tangodb/src/auth/routeGuards.tsx`
- `tangodb/src/pages/DashboardPage.tsx`
- `tangodb/src/settings/SettingsLayout.tsx`
- `tangodb/src/settings/SettingsIndexRedirect.tsx`
- `tangodb/src/settings/pages/DataExportPage.tsx`
- `tangodb/src/settings/pages/OrganizationSettingsPage.tsx`
- `tangodb/src/auth/OnboardingWizardPage.tsx`
- RPC `complete_organization_onboarding` (`20260627000001_v2_complete_organization_onboarding.sql` как текущая точка определения; создать новую миграцию, старые не редактировать)

Сделай Этап 1: `finance_basic`, `normalizeOrgModules`, module gate (nav, mobile, settings, route guard, financial tab, financial export). Старые org без `finance_basic` → true. RLS не менять. Supabase только в hooks/lib.

Важно: gate-механизм для desktop nav (`if (section.moduleKey && !orgModules[section.moduleKey]) return null`) уже реализован в `renderNav`. Нужно только добавить `moduleKey` к нужным секциям и заменить `settings?.modules ?? DEFAULT_ORG_MODULES` на `normalizeOrgModules(settings?.modules)`.

После кода: `.cursor/docs/ai/changelog.md`; архитектурные решения → `decision_log.md`.

Проверка: `npm run lint` в `tangodb/`; сценарии из критериев приёмки §6 Этап 1.
```

### Промт 2 — Finance Payments Filters (F1)

```text
Реализуй F1 из `tangodb_modular_dance_crm_TZ.md` §7.3: фильтры журнала в `FinancePaymentsPage` без миграций.

Используй `usePayments({ dateFrom, dateTo })`, `paymentSourceLabel`, `PAYMENT_METHOD_LABELS`, `AppSelect`.
Фильтры: период, источник (абон./перс.), способ оплаты. Не дублируй CSV (`DataExportPage` уже экспортирует за месяц).

Проверка: `npm run lint` в `tangodb/`; фильтры, пустое состояние, сумма «Итого».
```

### Промт 3 — Owner Finance KPI (F2)

```text
Реализуй F2 из `tangodb_modular_dance_crm_TZ.md` §7.3: MoM %, тренд 6 месяцев, pie/bar split выручки.
Файлы: `FinancialDashboard.tsx`, `financeReports.ts`, `usePayments.ts`. Без новых таблиц; без profit/cash-balance.
При тяжёлых запросах — предложи лёгкую агрегацию на клиенте или один RPC.

Проверка: `npm run lint`; текущий месяц, прошлый месяц, месяц без платежей.
```

### Промт 4 — Extended Dashboard Analytics (F3)

```text
Реализуй F3 из `tangodb_modular_dance_crm_TZ.md` §7.3: новые клиенты за период, топ-5 клиентов/преподавателей по выручке, заполняемость.
Переиспользуй существующие hooks (`useClients`, `usePayments`, attendance/schedule). Новые view/RPC — только если клиентская агрегация слишком тяжёлая; согласуй в `decision_log.md`.

Проверка: `npm run lint`; org с малым и большим объёмом данных.
```

### Промт 5 — Module UX Simplifications (Этап 2)

```text
Реализуй Этап 2 из `tangodb_modular_dance_crm_TZ.md` §6: UX-упрощения при выключенных `locations` / `multi_discipline`.
Не меняй module gate из Этапа 1. Скрывай лишние pickers в формах расписания и продажи; не удаляй данные и RLS.

Проверка: org с одной локацией; org с `locations: false`; org с `multi_discipline: false`.
```

### Промт 6 — Settings Modules UX (Этап 3)

```text
Реализуй Этап 3 из `tangodb_modular_dance_crm_TZ.md` §6: группировка чекбоксов модулей в `OrganizationSettingsPage` и `OnboardingWizardPage`.
Группы: «Разделы CRM», «Форматы занятий», «Инфраструктура». Пояснение: выключение скрывает UI, данные сохраняются.

Проверка: сохранение modules через settings; onboarding wizard.
```

### Промт 7 — Expenses / Payroll (F5/F6, только по запросу)

```text
Подготовь план F5/F6 из `tangodb_modular_dance_crm_TZ.md` §7.3 перед кодом.
Не начинай миграции без согласования схемы `expenses` / `teacher_settlements`, RLS и ролей.
Опиши бизнес-правила: ставки преподавателей, частичные выплаты, доступ teacher/accountant/owner, замена заглушки `/finance/payroll`.
```

### Промт 8 — SaaS S1: Self-Service Demo Email

```text
Реализуй S1 из `tangodb_modular_dance_crm_TZ.md` §8: self-service demo registration через email.

Перед кодом прочитай `.cursor/docs/ai/AI_CONTEXT.md`, §8 этого ТЗ и файлы:
- `tangodb/src/auth/RegisterPage.tsx`
- `tangodb/src/auth/AuthProvider.tsx`
- `tangodb/src/auth/VerifyEmailPage.tsx`
- `tangodb/src/auth/routeGuards.tsx`
- `tangodb/src/auth/OnboardingWizardPage.tsx`
- `tangodb/src/organization/OrganizationProvider.tsx`
- `tangodb/supabase/migrations/20260620000001_v2_tenant_core_schema.sql`
- `tangodb/supabase/migrations/20260621000001_v2_access_key_activation.sql`
- `tangodb/supabase/migrations/20260626000002_v2_fix_activate_access_key_active_org.sql`
- `tangodb/supabase/functions/activate-access-key/index.ts`
- `tangodb/supabase/functions/request-demo-key/index.ts`

Цель: после email signup + email verification пользователь должен получить demo organization без ввода demo-key. Добавь поле login/display name в регистрацию. Обнови VerifyEmailPage и OrgWorkspaceRoute — не редиректить на /activate-key при успешном self-service demo. Сохрани текущий lifetime key activation flow для пользователей с ключом.

Требования:
- RPC/Edge Function `create_self_service_demo_org` (имя зафиксировать в migration);
- Turnstile на `/register`: token из клиента, проверка только на backend перед созданием demo;
- не создавать физическую БД; organization + organization_id + RLS;
- demo: demo_active, 30 дней полного доступа;
- создать organization_members + user_active_organizations;
- показать Emergency Recovery Code один раз после создания demo; хранить только hash, plaintext не логировать;
- onboarding: вариант A или B из §8.2 — выбрать и записать в decision_log.md;
- запрет повторной demo для того же email (normalized/hash);
- service role только в Edge Function/RPC;
- invite/team/lifetime flows не сломать.

Проверка: `npm run lint`; ручные сценарии: новый email, invalid/absent Turnstile token, повторный email, неподтверждённый email, пользователь с lifetime key, recovery code показывается только один раз.
После кода обнови `.cursor/docs/ai/changelog.md`; если принял решение по lifecycle/retention — `decision_log.md`.
```

### Промт 9 — SaaS S2: Telegram Demo Signup

```text
Реализуй S2 из `tangodb_modular_dance_crm_TZ.md` §8: Telegram self-service demo без email/пароля.

Файлы:
- `tangodb/src/auth/LoginPage.tsx`
- `tangodb/src/auth/AuthProvider.tsx`
- `tangodb/src/lib/telegram.ts`
- `tangodb/supabase/functions/telegram-auth/index.ts`
- `tangodb/supabase/functions/_shared/telegramVerify.ts`
- tenant/auth migrations с custom JWT claims

Сохрани текущий сценарий: если Telegram ID уже привязан к существующему user/member — логин как сейчас. Новый сценарий: если Telegram ID валиден, но пользователя/member нет, создать synthetic auth user, demo organization и owner membership без email/password.

Требования:
- проверка подписи Telegram только на backend;
- rate limit по IP и telegram_id;
- anti-abuse record по `telegram_id_hash`;
- не создавать дубль, если telegram_id уже найден в `app_metadata`;
- после login пользователь попадает в demo CRM.

Проверка: `npm run lint`; Telegram widget/Mini App; неизвестный Telegram ID; уже привязанный Telegram ID; повторная demo попытка.
```

### Промт 10 — SaaS S3: Demo UI + Purchase CTA

```text
Реализуй S3 из `tangodb_modular_dance_crm_TZ.md` §8: явный demo UI и CTA покупки.

Файлы:
- `tangodb/src/App.tsx`
- `tangodb/src/pages/DashboardPage.tsx`
- `tangodb/src/components/OperationalDashboard.tsx`
- `tangodb/src/components/FinancialDashboard.tsx`
- `tangodb/src/auth/LicenseRequiredPage.tsx`
- `tangodb/src/settings/pages/LicenseSettingsPage.tsx`
- `tangodb/src/organization/OrganizationProvider.tsx`

Добавь:
- под логотипом/названием CRM текст `ДЕМО-ВЕРСИЯ` для `demo_active/demo_retention`;
- срок окончания demo;
- CTA `Купить полную версию` в sidebar/mobile drawer и вверху «Обзор и статистика»;
- CTA виден owner/director в demo и ведёт на purchase/license page.

Не ломай read-only behavior для `demo_retention`. Проверка: `npm run lint`; demo_active, demo_retention, licensed.
```

### Промт 11 — SaaS S4: Manual Purchase + Lifetime Activation

```text
Реализуй S4 из `tangodb_modular_dance_crm_TZ.md` §8: ручная покупка полной версии и активация lifetime key.

Файлы:
- `tangodb/src/settings/pages/LicenseSettingsPage.tsx`
- `tangodb/src/auth/ActivateKeyPage.tsx`
- `tangodb-dev-console/src/pages/KeysPage.tsx`
- `tangodb/supabase/functions/dev-console-issue-key/index.ts`
- `tangodb/supabase/functions/dev-console-generate-key/index.ts`
- `tangodb/supabase/functions/activate-access-key/index.ts`

Добавь purchase UI:
- crypto cards с QR/address из public config (`platform_payment_methods` / Dev Console); QR генерировать на клиенте (`react-qr-code` или `qrcode`), не хранить статические QR как источник истины;
- bank/MasterCard реквизиты;
- МИР реквизиты;
- контакты developer: email, Telegram, WhatsApp;
- инструкция: оплатить → связаться/дождаться письма → получить ключ → `Настройки → Лицензия` → активировать.

Месячную подписку пока не реализовывать: скрыть или пометить Stripe month/year как `Скоро`, не удаляя существующую заготовку. Добавить waitlist для подписки (`platform_waitlist` или эквивалент), без checkout.

Важно: приватные ключи/секреты не хранить в repo/client. Реальные реквизиты брать из безопасной публичной config table или env-backed Edge Function response без секретов.

Проверка: `npm run lint`; purchase page без config; с config; QR генерируется из адреса/URI; waitlist сохраняет заявку; activation lifetime key; demo→licensed upgrade.
```

### Промт 12 — SaaS S5: Demo Purge / Retention

```text
Реализуй S5 из `tangodb_modular_dance_crm_TZ.md` §8: lifecycle demo и удаление данных после окончания demo, если нет lifetime.

Файлы:
- `tangodb/supabase/migrations/20260621000001_v2_access_key_activation.sql`
- `tangodb/supabase/migrations/20260626000002_v2_fix_activate_access_key_active_org.sql`
- текущие latest migrations для `run_demo_lifecycle` / `purge_expired_demo_organizations`
- `tangodb/supabase/functions/demo-lifecycle/index.ts`
- RLS tests: `tangodb/supabase/tests/v2_tenant_rls_test.sql`, `v2_access_key_test.sql`
- `tangodb/src/auth/LicenseRequiredPage.tsx`
- `tangodb/src/components/ui/ReadOnlyBanner.tsx`

Зафиксируй политику purge (§8.2): по умолчанию `data_purge_at = demo_expires_at` (strict 30 дней, **без** обязательной фазы `demo_retention` 31–60); опциональный read-only +7 дней — только если записано в decision_log.

Критично: текущий purge НЕ удаляет business-данные (clients, subscriptions, payments, schedule). Текущий `run_demo_lifecycle()` переводит org в `demo_retention` — в целевом MVP это нужно убрать или свести к мгновенному purge на `demo_expires_at`. Новая реализация должна:
- записать owner email/hash в demo_owner_retention (§8.10 п.12);
- DELETE organization row (ON DELETE CASCADE) ИЛИ явно удалить business-таблицы;
- не purge licensed org и org с organization_has_active_subscription();
- сохранить только retention record после purge.

Проверка: db tests — clients/payments удалены после purge; lifetime отменяет purge; RLS без регрессии. changelog.md + decision_log.md.
```

### Промт 13 — SaaS S6: Валюты и Контакты

```text
Реализуй S6 из `tangodb_modular_dance_crm_TZ.md` §8: список валют и контакты разработчика.

Файлы:
- `tangodb/src/settings/pages/GeneralSettingsPage.tsx`
- `tangodb/src/settings/pages/OrganizationSettingsPage.tsx`
- `tangodb/src/auth/OnboardingWizardPage.tsx`
- `tangodb/src/settings/pages/LicenseSettingsPage.tsx`
- `tangodb/src/lib/format.ts`
- создать `tangodb/src/lib/currencies.ts` (curated list §8.6)

Добавь curated list популярных валют до 20 штук в одном месте (`lib/currencies.ts`). Для CRM — ISO-4217; crypto только в payment instructions.

Добавь контакты developer в purchase/license UI: email, Telegram, WhatsApp. Ссылки валидировать/whitelist: `mailto:`, `https://t.me/`, `https://wa.me/`.

Проверка: `npm run lint`; форматирование сумм для RUB/USD/EUR/KZT/AED/THB/VND; пустые contacts.
```

### Промт 14 — SaaS S7: Security Hardening

```text
Проведи security hardening для SaaS из `tangodb_modular_dance_crm_TZ.md` §8.7.

Проверь и исправь только реальные риски:
- license key brute force: hash+pepper, backend compare, rate limit, audit, no production debug;
- demo abuse: email_hash/telegram_id_hash retention, повторные регистрации, Turnstile `/register` backend-only;
- RLS: no service role in client, `organization_allows_reads/writes`, active org claims;
- Edge Functions: CORS allowlist, Authorization где нужен, method checks, JSON validation;
- Telegram: подпись backend-only, rate limit;
- XSS/injection: no SQL concatenation, no `dangerouslySetInnerHTML`, whitelist external links, QR генерировать из валидированной строки.
- production debug: `ACTIVATION_DEBUG`/аналогичные флаги по умолчанию `false`, подробности ошибок не возвращать клиенту в prod;
- Dev Console search: не строить PostgREST `.or(...)` из raw query; сделать безопасный escaped search или RPC/EF с параметрами.

Файлы определить поиском по relevant functions/components. Не трогай RLS радикально без необходимости.

Проверка: `npm run lint`; db tests `test:db:keys`, `test:db:subscription`, RLS tests; manual brute-force smoke with invalid keys.
Запиши найденные и исправленные ошибки в `.cursor/docs/ai/lessons.md`; архитектурные решения — `decision_log.md`.
```

### Промт 15 — SaaS S8: Team Invite + Member Recovery

```text
Реализуй S8 из `tangodb_modular_dance_crm_TZ.md` §8.8: командный доступ и восстановление доступа участников.

Перед кодом прочитай `.cursor/docs/ai/AI_CONTEXT.md`, §8.8 этого ТЗ и файлы:
- `tangodb/src/settings/pages/TeamSettingsPage.tsx`
- `tangodb/src/hooks/useTeamInvites.ts`
- `tangodb/src/hooks/useTeamMembers.ts`
- `tangodb/src/auth/AcceptInvitePage.tsx`
- `tangodb/src/auth/ForgotPasswordPage.tsx`
- `tangodb/src/auth/ResetPasswordPage.tsx`
- `tangodb/src/lib/edgeFunctions.ts`
- `tangodb/supabase/functions/invite-member/index.ts`
- `tangodb/supabase/functions/preview-invite/index.ts`
- `tangodb/supabase/functions/complete-invite/index.ts`
- latest migrations for `organization_invites`, `organization_members`, `update_team_member`

Цель: owner/director приглашает команду в свою CRM-базу; участник регистрируется по email+password через invite; восстановление пароля идёт через email reset; при утрате email участника owner/director деактивирует старого member и отправляет новый invite.

Требования:
- не создавать отдельную organization для участника;
- не обходить RLS и `can_manage_team`;
- не добавлять роль `reception`: ресепшен/кассир = `admin` + `meta.restricted_admin`;
- не раскрывать, существует ли email;
- добавить понятные UI-инструкции для owner/director;
- не давать team member восстанавливать owner-доступ;
- все изменения member/recovery писать в audit log, если уже есть подходящий audit mechanism.

Проверка: `npm run lint`; invite new member; accept invite; reset password; deactivate old member + invite new email; role/scope не теряются.
После кода обнови `.cursor/docs/ai/changelog.md`; найденные recovery/security ошибки — `lessons.md`.
```

### Промт 16 — SaaS S9: Owner Emergency Recovery

```text
Подготовь и реализуй S9 из `tangodb_modular_dance_crm_TZ.md` §8.8: emergency recovery владельца при утрате email/пароля.

Сначала предложи короткий план и схему проверки владения. Не делай автоматический публичный endpoint для смены owner email.

Минимальный безопасный flow:
- если owner email доступен: использовать `/auth/forgot-password` и `/auth/reset-password`;
- если owner email утрачен: developer/support вручную проверяет владение по payment proof/lifetime key, Emergency Recovery Code, Telegram binding, контактам покупки, данным организации;
- после проверки service-role/admin tool меняет owner email или создаёт нового owner member и деактивирует старого;
- все действия пишутся в audit log с причиной, старым/новым email hash, developer actor и timestamp.

Файлы определить после поиска по Dev Console, auth users admin API, audit log и organization_members. Если в проекте нет безопасной support-панели — добавь только внутреннюю Edge Function/Dev Console action, недоступную обычным пользователям.

Запрещено:
- public self-service смена owner email без старого email;
- recovery только по Telegram ID;
- recovery только по emergency code без второго фактора;
- раскрытие email/org existence;
- перенос purged demo на новый email без anti-abuse проверки.

Проверка: `npm run lint`; manual owner email reset; emergency owner transfer; old owner loses access; new owner has active org; audit log заполнен; RLS не ослаблен.
После кода обнови `.cursor/docs/ai/changelog.md`, `decision_log.md` и `lessons.md`.
```

### Промт 17 — SaaS S10: English Localization

```text
Реализуй S10 из `tangodb_modular_dance_crm_TZ.md` §8: полная английская версия CRM. Делать только после завершения SaaS UI, payment/recovery текстов и заморозки русского текста.

Перед кодом найди все hardcoded Russian strings в `tangodb/src`. Расширь текущий `tangodb/src/lib/i18n/index.ts` или предложи более удобную локальную структуру, но не добавляй тяжёлую i18n-библиотеку без причины.

Требования:
- `ru-RU` остаётся default;
- `en-US` покрывает auth, sidebar/mobile nav, dashboard, clients, schedule, subscriptions, personal lessons, attendance, prices, finance, settings, team/recovery, license/purchase, banners/errors;
- переключатель locale использует `organization_settings.locale`;
- не переводить данные пользователя;
- сначала вынести ключи, затем перевести.

Проверка: `npm run lint`; smoke ru/en для основных маршрутов; нет смешанного русского UI в en-US, кроме пользовательских данных.
После кода обнови `.cursor/docs/ai/changelog.md` и при изменении подхода к i18n — `architecture.md`/`decision_log.md`.
```

### Промт 18 — SaaS DC1: Dev Console Tenant Admin

```text
Реализуй DC1 из `tangodb_modular_dance_crm_TZ.md` §8.11: расширенная Dev Console для SaaS-support.

Перед кодом прочитай `.cursor/docs/ai/AI_CONTEXT.md`, §8.11 и файлы:
- `tangodb-dev-console/src/pages/OrgsPage.tsx`
- `tangodb-dev-console/src/pages/KeysPage.tsx`
- `tangodb-dev-console/src/pages/DashboardPage.tsx`
- `tangodb-dev-console/src/components/Layout.tsx`
- `tangodb/supabase/functions/dev-console-search-orgs/index.ts`
- `tangodb/supabase/functions/dev-console-metrics/index.ts`
- `tangodb/supabase/functions/dev-console-issue-key/index.ts`
- `tangodb/supabase/functions/_shared/devAuth.ts`

Цель: админ видит CRM-базы клиентов с owner email/именем, demo/lifetime, размер данных org, last login, метаданные ключа; может восстановить пароль owner (modal с one-time password), вручную purge неактивной demo-org, выдать lifetime key из строки org.

Требования:
- новый EF `dev-console-list-tenants` (или расширить search-orgs): join owner через Admin API; `estimate_org_storage` RPC; last_sign_in_at; access_keys metadata (не plaintext);
- поиск tenants: безопасный query backend-side, без raw `.or(...)` из пользовательского ввода; поддержать email/name/payment_ref;
- EF `dev-console-reset-owner-password`: generate secure password, Admin API updateUser, audit log, return password once in response body;
- EF `dev-console-purge-org`: single-org purge (reuse S5 logic), запрет purge licensed без override;
- optional: `platform_org_notes`, `organizations.payment_ref`, страница `/payment-methods` для CRUD `platform_payment_methods`;
- OrgsPage: фильтры (status, expiring soon), колонки из §8.11.2, modals restore password / purge / issue key;
- все admin actions → `platform_audit_log`; не логировать пароли и plaintext keys;
- service role только в Edge Functions; developer auth через existing devAuth.

Проверка: `npm run lint` в `tangodb-dev-console/`; list tenants; reset password modal; manual purge demo org; issue key from row; licensed org purge blocked; audit entries created.
После кода обнови `.cursor/docs/ai/changelog.md`; RPC/storage decisions → `decision_log.md`.
```

### Промт 19 — F5: Expenses (реализация)

```text
Реализуй F5 из `tangodb_modular_dance_crm_TZ.md` §7.3 и `tangodb_expenses_payroll_plan.md` §2.

Перед кодом прочитай `.cursor/docs/ai/AI_CONTEXT.md`, план и файлы:
- `tangodb_expenses_payroll_plan.md` §2 (схема, RLS, permissions, UI)
- `tangodb/supabase/migrations/20260630000001_v2_payments_module.sql` (паттерн RLS/audit)
- `tangodb/src/pages/FinancePaymentsPage.tsx` (паттерн UI фильтров)
- `tangodb/src/pages/FinancePage.tsx`, `FinanceLayout.tsx`
- `tangodb/src/lib/i18n/navHelpers.ts`, `permissions.ts`, `orgModules.ts`
- `tangodb/src/components/FinancialDashboard.tsx`
- `tangodb/src/settings/pages/DataExportPage.tsx`
- `tangodb/src/hooks/usePayments.ts`

Цель: учёт операционных расходов — таблица `expenses`, CRUD для owner/director/accountant, маршрут `/finance/expenses`.

Миграция (новый файл, старые не редактировать):
- `expenses`: id, organization_id, amount (>0), category (rent/utilities/marketing/salary/other), description, expense_date, created_by, created_at, updated_at
- CHECK `expense_date <= CURRENT_DATE`
- RLS: SELECT/INSERT/UPDATE/DELETE — owner, director, accountant; teacher/admin/reception — нет
- tenant consistency для created_by; audit trigger как у payments
- `organization_allows_writes()` для demo read-only

Клиент:
- `PermissionAction`: `expenses.read`, `expenses.write` — owner/director/accountant
- `tangodb/src/types/expense.ts`, `lib/expenseCategories.ts`, `hooks/useExpenses.ts`
- `FinanceExpensesPage.tsx`: список, фильтры период+категория, «Итого», CRUD modal (AppSelect, DatePickerField max=today)
- route `/finance/expenses` + nav item в `getFinanceNav` + иконка в `FinanceLayout`
- module gate `finance_basic` — как у других finance routes
- i18n: `finance.nav.expenses`, `finance.expenses.*` (ru/en)

FinancialDashboard: карточки «Расходы за месяц» + «Прибыль» = выручка − расходы; подпись «без учёта кассы/банка»; **не** cash-balance.

DataExportPage: CSV расходов за месяц (date, category, description, amount); доступ `finance.export && finance_basic`; без регрессии payments CSV.

Не делать: ledger касса/банк, recurring, attachments, автосвязь F6 payroll с expenses.

Проверка: `npm run lint` в `tangodb/`; CRUD owner/accountant; teacher/admin не видят раздел; expense_date в будущем — ошибка; finance_basic off — route скрыт; CSV expenses работает.
После кода: `.cursor/docs/ai/changelog.md`; архитектурные решения → `decision_log.md`.
```

### Промт 20 — F6: Teacher Payroll (реализация)

```text
Реализуй F6 из `tangodb_modular_dance_crm_TZ.md` §7.3 и `tangodb_expenses_payroll_plan.md` §3.

Предусловие: F5 (Промт 19) завершён.

Перед кодом прочитай `.cursor/docs/ai/AI_CONTEXT.md`, план, `decision_log.md` (ставки MVP: % от атрибутированной выручки) и файлы:
- `tangodb_expenses_payroll_plan.md` §3
- `tangodb/src/lib/financeReports.ts` (`resolvePaymentTeacherId`, `buildTopTeachersByRevenue`)
- `tangodb/src/pages/FinancePayrollPage.tsx` (заменить заглушку)
- `tangodb/src/pages/FinancePage.tsx`, `FinanceLayout.tsx`
- `tangodb/src/auth/routeGuards.tsx`, `App.tsx`
- `tangodb/src/lib/permissions.ts`
- `tangodb/src/settings/TeamSettingsPage.tsx`, `MemberProfileModal.tsx`
- `tangodb/src/components/TeacherScopedDashboard.tsx`
- `tangodb/supabase/migrations/20260630000001_v2_payments_module.sql`

Цель: заменить заглушку `/finance/payroll` — начисления и выплаты преподавателям за месяц; teacher видит только свои строки.

Ставки (вариант A, MVP): `teacher_pay_rates` — rate_percent 0–100, effective_from; одна активная ставка на teacher (последняя по effective_from). UI: поле «% от выручки» в team settings для role=teacher (owner/director edit).

Миграция (новый файл):
- `teacher_pay_rates`, `teacher_settlements` (period_year/month, amount_accrued, amount_paid, CHECK paid<=accrued), `teacher_settlement_payments` (partial payments audit)
- RPC `recalculate_teacher_settlement(p_org_id, p_year, p_month)` — идемпотентный; accrued = sum(attributed payment amount × rate_percent/100); attribution как в `resolvePaymentTeacherId` (personal → teacher_member_id; subscription → первый teacher из schedule)
- RLS: financial roles — full; teacher — read own settlements/payments only; rates write — owner/director
- Guard: block deactivate/delete teacher member if future `schedule_slots` or `personal_lessons` exist (RPC или trigger — согласовать в decision_log)

Permissions:
- `payroll.read`, `payroll.write`, `payroll.read.own`, `payroll.rates.manage`
- Route exception: `/finance/payroll` доступен teacher при `payroll.read.own` + `finance_basic`; **не** открывать весь finance panel teacher
- `FinanceLayout`: для teacher скрыть sub-nav payments/revenue/debtors; только payroll content
- Опционально: ссылка «Мои выплаты» в `TeacherScopedDashboard`

UI:
- owner/director/accountant: таблица teachers × месяц (accrued, paid, balance), drill-down partial payments, «Записать выплату», фильтр период
- teacher: свои settlements (read-only), без write-кнопок
- Удалить `finance.payroll.comingSoon`; i18n ru/en

Hooks: `usePayroll.ts`, `types/payroll.ts`, `lib/payrollAccrual.ts` (preview); authoritative accrued — RPC. Invalidate on payment/rate change.

Не делать: фикс за занятие, налоги, автодублирование teacher payout в F5 expenses.

Проверка: `npm run lint`; owner records partial/full payment; teacher sees only own rows; accrued recalculates; paid>accrued blocked; teacher-with-future-lessons guard; stub removed; permissions self-check в `permissions.ts`.
После кода: `.cursor/docs/ai/changelog.md`; решения по RPC/guard → `decision_log.md`.
```

---

## 11. Правила для агента

1. Supabase — только `hooks/` и `lib/`.
2. Не дублировать страницы/hooks — расширять существующие.
3. RLS — не трогать без указания.
4. Новый module key: тип + `PRESET_MODULES` + normalizer + nav + route guard + settings (если применимо) + fallback + критерий приёмки.
5. Выключение модуля = скрытие UI, не DELETE.
6. После изменений кода — `changelog.md`; архитектура — `decision_log.md`.
7. Миграции — только новые файлы в `supabase/migrations/`, уже применённые не редактировать.
