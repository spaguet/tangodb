# TangoDB — Design System v2 "Atelier"
## Техническое задание на редизайн палитры для Cursor

**Статус:** реализовано (этап 1 закрыт 2026-08-17, CRM `2.9.0`)
**Дата ревью данных:** 2026-08-17
**Затрагивает:** `tangodb/` (CRM), `tangodb-dev-console/`, `tangodb-landing/`
**Источник правды (заменяет после внедрения):** `.cursor/docs/ai/design_system.md`
**Стек:** Tailwind CSS v4, кастомная палитра через `@theme` / CSS-переменные
**Текущая CRM-версия:** `2.7.x` (см. `tangodb/src/lib/appVersion.ts`) — бамп версии только в финальном промпте закрытия этапа

---

## 0. Зачем это делается

Текущая палитра (`project_colors.md`) — дефолтная палитра Tailwind (`indigo-600` как primary CTA, `slate` как нейтраль) без единой кастомизации. Это узнаётся глазом как типовой SaaS-шаблон и не соответствует позиционированию TangoDB как премиального продукта для танцевальных студий.

**Диагноз (кратко):**
1. Primary-акцент — `indigo-600 #4f46e5` — самый растиражированный CTA-цвет в SaaS последних лет, не несёт бренд-идентичности.
2. Нейтральная база `slate` — холодная, синевато-серая, не соответствует эмоциональному, «тёплому» продукту про танец.
3. 9 цветовых семейств в реальном использовании (slate/indigo/sky/violet/emerald/rose/red/amber/blue) — избыточно для B2B-инструмента; расписание, где каждый тип занятия — своя хью-семья, читается как «декоративно», а не «спроектировано».
4. Дублирующиеся семантики: `rose` и `red` одновременно как «ошибка»; `sky`, `indigo`, `blue` — три синих одновременно.
5. Хардкод вне токенов (`#229ED9`, fallback-цвета в `index.html`/`index.css`).

**Задача:** заменить палитру на кастомную систему `Atelier` — тёплая нейтральная база (`ink`), один акцент (`gold`), один вторичный акцент (`lavender`), 3 строго ограниченных семантических семей (`sage`, `garnet`, `amber`). Убрать decorative-мультихромию, оставить дисциплинированную систему из **6 палитр** максимум: `ink`, `gold`, `lavender`, `sage`, `garnet`, `amber`.

### 0.1 Ревью данных (снимок кода 2026-08-17)

Сверка с `project_colors.md` и grep по `*.tsx` / `*.ts` / `*.css` (без `node_modules`).

| Семейство | `tangodb/` | `dev-console` | `landing` | Примечание |
|---|---:|---:|---:|---|
| `slate` | 2903 | 401 | 945 | нейтраль CRM — светлая тема (`body` `#f8fafc`, карточки `white`) |
| `indigo` | 843 | 123 | 278 | primary CTA |
| `sky` | 70 | 22 | 51 | персональные уроки, заморозка |
| `violet` | 117 | 22 | 22 | мероприятия, missing teachers |
| `emerald` | 41 | 79 | 46 | успех / sync / dev-console badges |
| `rose` | 303 | 104 | 63 | ошибки, долги |
| `red` | 56 | 27 | 114 | auth-формы, captcha, декор landing preview |
| `amber` | 318 | 65 | 40 | warning-баннеры; **1 CTA** в dev-console (`OrgsPage` emergency) |
| `blue` | 22 | 31 | 78 | dev-console бейдж Subscription; landing декор |

**Подтверждено в коде:**
- `tangodb/src/lib/scheduleColors.ts` — 4 хью-семейства (`indigo` / `sky` / `violet` / `slate`), совпадает с `project_colors.md`.
- `tangodb/src/components/schedule/LessonBlock.tsx` — **нет иконок типа занятия** (только цвет блока + ring при долге).
- Шрифт production: **Inter** (`tangodb/src/index.css`, `tangodb-landing/src/index.css`). `Cormorant Garamond` / `Plus Jakarta Sans` в production CRM **не подключены** (только legacy `from GAS/`, прототип `from Google Ai Studio/`).
- `tangodb-dev-console/src/index.css` — только тёмная тема (`bg-slate-950`).
- Хардкод hex: `tangodb/index.html` (`#334155`, `#64748b`, `#f8fafc`), `tangodb/src/index.css` (`#f8fafc`, `#6366f1`, `#cbd5e1`, `#818cf8`), Telegram `#229ED9` / `#1C82B4` — совпадает с `project_colors.md`.
- Бейдж Subscription: `tangodb-dev-console/src/pages/OrgsPage.tsx` → `bg-blue-900/50 text-blue-300`.

**Расхождения спеки с кодом (исправлены в этом документе):**
- В §0 было «4 семантических цвета» — фактически 3 (`sage`, `garnet`, `amber`).
- В §1.4 не были заданы полные ramp'ы `sage` и `garnet` — добавлены в §1.4.
- Atelier «тёмная база» в бренд-нарративе ≠ текущий светлый CRM — решение в §6.

---

## 1. Новая палитра — токены

Определить как CSS custom properties в `@theme` (Tailwind v4) в `index.css` каждого приложения. На первом шаге **держать старые и новые токены параллельно**; удалять legacy только после grep-чистки (§7, промпт 8).

### 1.1 Нейтральная база — `ink` (заменяет `slate`)

Тёплый графитовый ramp, не холодный синевато-серый.

| Токен | Hex | Роль |
|---|---|---|
| `ink-25` | `#FAF9F7` | Фон карточек на светлом фоне |
| `ink-50` | `#F5F3EF` | Фон страницы (light CRM) |
| `ink-100` | `#E8E4DC` | Разделители, неактивные табы (light) |
| `ink-200` | `#D6D0C4` | Границы полей, карточек |
| `ink-300` | `#B5AC9C` | Плейсхолдеры, вторичные иконки |
| `ink-400` | `#8C8272` | Вторичный текст, метки полей |
| `ink-500` | `#6B6255` | Подписи, вторичные кнопки |
| `ink-600` | `#4F473D` | Текст навигации |
| `ink-700` | `#39332B` | Заголовки панелей (light), fallback текст |
| `ink-800` | `#241F1A` | Основной текст на светлом фоне |
| `ink-900` | `#171310` | Фон карточек (dark), sidebar dev-console |
| `ink-950` | `#0D0B09` | Overlay backdrop, фон страницы dev-console |

> Это не переименование `slate` один в один — сдвиг в тёплый тон (коричнево-графитовый, а не сине-серый).

### 1.2 Основной акцент — `gold` (заменяет `indigo` как primary)

CTA, активная навигация, primary-кнопки, логотип, focus.

| Токен | Hex | Роль |
|---|---|---|
| `gold-50` | `#FBF3E3` | Фон активного пункта меню, highlight |
| `gold-100` | `#F5E4C0` | Focus ring, границы accent-блоков |
| `gold-200` | `#EDD096` | Hover border |
| `gold-300` | `#E2B665` | Hover border карточек |
| `gold-400` | `#D49F42` | Focus border, scrollbar hover |
| `gold-500` | `#C4902E` | Иконки секций, loader |
| `gold-600` | `#A97522` | **Primary CTA** (фон кнопки), логотип, активные filled-кнопки |
| `gold-700` | `#8A5D1B` | Активный текст nav, **текстовые ссылки** на светлом фоне |
| `gold-800` | `#6B4715` | Hover ссылок |
| `gold-900` | `#4A3110` | Тёмные фоны с акцентом (dev-console) |

**WCAG (light CRM):** `gold-600` на `ink-50` / `white` для **текста** — ниже AA 4.5:1. Правило: filled CTA — `bg-gold-600 text-white`; inline-ссылки и accent-текст на светлом — `text-gold-700` (hover `gold-800`). После миграции проверить контраст в промпте 9.

### 1.3 Вторичный акцент — `lavender` (заменяет `sky`/`violet`/`blue`)

Второстепенные акценты: персональные уроки, мероприятия, premium/особый статус, SaaS-бейджи. **Один вторичный акцент вместо трёх (sky + violet + blue).**

| Токен | Hex | Роль |
|---|---|---|
| `lavender-50` | `#F3F0FA` | Фон бейджей |
| `lavender-100` | `#E4DCF3` | Границы бейджей |
| `lavender-200` | `#CFC0E8` | Границы карточек |
| `lavender-300` | `#B39FD9` | Hover toggle |
| `lavender-400` | `#9578C7` | Фон блока персонального урока / мероприятия |
| `lavender-500` | `#7A5CB0` | Border персонального урока / мероприятия |
| `lavender-600` | `#634995` | Текст, иконки, активные состояния |
| `lavender-700` | `#4C3874` | Тёмный текст на светлом фоне |
| `lavender-800` | `#3A2A58` | Фон бейджа Subscription (dev-console) |
| `lavender-900` | `#2A1E40` | Тёмный фон бейджа (`lavender-900/70`) |

### 1.4 Семантические цвета (строго 3, без дублей)

#### `sage` (заменяет `emerald`)

| Токен | Hex | Роль |
|---|---|---|
| `sage-50` | `#F4F8F4` | Фон успеха / sync badge |
| `sage-100` | `#E2EDE2` | Граница sync badge |
| `sage-200` | `#C5DBC5` | Hover border |
| `sage-300` | `#9FC19F` | Бейдж Lifetime (dev-console) |
| `sage-400` | `#75A375` | Иконка успеха, скопированный ключ |
| `sage-500` | `#5C8A5C` | Базовый оттенок |
| `sage-600` | `#4A734A` | Текст успеха |
| `sage-700` | `#3A5C3A` | Превью возврата средств |
| `sage-800` | `#2D462D` | — |
| `sage-900` | `#1F311F` | Границы блоков с ключом (dev-console) |
| `sage-950` | `#141F14` | Фон success-баннеров (dev-console) |

#### `garnet` (заменяет `rose` **и** `red`)

| Токен | Hex | Роль |
|---|---|---|
| `garnet-50` | `#FDF2F4` | Фон ошибок, долгов, auth |
| `garnet-100` | `#F9E0E5` | Границы ошибок |
| `garnet-200` | `#F2C2CC` | Hover attendance «не был» |
| `garnet-300` | `#E899A8` | Декор, заголовки удаления |
| `garnet-400` | `#D9667A` | Ошибки (dev-console) |
| `garnet-500` | `#C04D62` | Ring долга в расписании |
| `garnet-600` | `#A8394A` | **Destructive CTA**, долги, attendance «не был», auth-текст |
| `garnet-700` | `#8B2D3C` | Текст долгов, предупреждений |
| `garnet-800` | `#6E2430` | Hover delete |
| `garnet-900` | `#551B25` | Фон error badge |
| `garnet-950` | `#3A1219` | Самый тёмный error фон |

#### `amber` (оставить Tailwind-совместимый ramp, использовать только 3 ступени)

| Токен | Hex | Роль |
|---|---|---|
| `amber-50` | `#FFFBEB` | Warning-баннеры, offline notice |
| `amber-200` | `#FDE68A` | Границы warning / offline |
| `amber-700` | `#B45309` | Текст предупреждений, бейдж demo |

**Правила:**
- `red` полностью удаляется из кодовой базы → `garnet-*` того же смыслового веса.
- `emerald` → `sage-*`.
- `amber` — **только пассивные** warning-баннеры в CRM. Исключение dev-console: emergency CTA в `OrgsPage` → `garnet-600` filled (не amber).

### 1.5 Бренд-исключение

Telegram-кнопки остаются как есть — единственное разрешённое отклонение от системы:
`#229ED9` / `#1C82B4` — не менять.

### 1.6 Что удаляется полностью (после миграции)

- `blue-*` → `lavender-*` (бейдж Subscription: `bg-lavender-900/70 text-lavender-300`).
- `sky-*` → `lavender-*`.
- `violet-*` → `lavender-*`.
- `red-*` → `garnet-*`.
- `indigo-*` → `gold-*`.
- `slate-*` → `ink-*` (по таблице ролей §2.1, не по числу).
- `emerald-*` → `sage-*`.
- `rose-*` → `garnet-*`.
- Произвольные opacity-хвосты → §3.

---

## 2. Схема замены категорий — таблица маппинга

Смысловой маппинг для Cursor. **Не механический** (`slate-500` ≠ автоматически `ink-500` по визуальному весу — сверяться с §2.1).

| Было | Роль | Стало |
|---|---|---|
| `slate-*` | нейтраль | `ink-*` (по роли, §2.1) |
| `indigo-*` | primary-акцент | `gold-*` |
| `sky-*` | персональные уроки, второстепенный акцент | `lavender-*` |
| `violet-*` | мероприятия | `lavender-*` |
| `emerald-*` | успех | `sage-*` |
| `rose-*` | ошибки/долги | `garnet-*` |
| `red-*` | ошибки (auth) | `garnet-*` |
| `amber-*` | warning-баннеры | `amber-50` / `amber-200` / `amber-700` только |
| `blue-*` | бейдж Subscription, декор landing | `lavender-*` |

### 2.1 Маппинг `slate` → `ink` по роли (light CRM)

Использовать при замене, когда суффикс Tailwind не совпадает 1:1 по контрасту.

| Роль в UI | Было | Стало |
|---|---|---|
| Фон страницы | `slate-50`, `#f8fafc` | `ink-50` |
| Карточки, header, sidebar | `white` | `white` (не менять) |
| Разделители, неактивные табы | `slate-100` | `ink-100` |
| Границы карточек/полей | `slate-200`, `border-slate-200/90` | `ink-200`, `border-ink-200` |
| Scrollbar thumb, empty icons | `slate-300` | `ink-300` |
| Вторичный текст, плейсхолдеры | `slate-400` | `ink-400` |
| Подписи, вторичные кнопки | `slate-500` | `ink-500` |
| Текст навигации | `slate-600` | `ink-600` |
| Sidebar текст, fallback boot | `slate-700` | `ink-700` |
| Заголовки панелей, основной текст | `slate-800` | `ink-800` |
| Overlay backdrop | `slate-900/40` (и `/30`, `/50`, `/60`) | `ink-950/40` |
| Hover nav (тёмный) | `slate-950` | `ink-950` |
| Подложки строк | `slate-50/80`, `/60`, `/50` | `ink-50/10` или `ink-100/10` |
| Skeleton | `slate-100` | `ink-100` |

### 2.2 Маппинг `indigo` → `gold` по роли

| Роль | Было | Стало |
|---|---|---|
| Primary filled CTA | `bg-indigo-600`, hover `indigo-700` | `bg-gold-600`, hover `gold-700`, `text-white` |
| Текстовая ссылка на светлом | `text-indigo-600` | `text-gold-700`, hover `gold-800` |
| Active nav текст | `text-indigo-700` | `text-gold-700` |
| Active nav фон | `bg-indigo-50` | `bg-gold-50` |
| Active nav border | `border-indigo-600` | `border-gold-600` |
| Focus ring полей | `ring-indigo-100`, `focus:border-indigo-400` | `ring-gold-100`, `focus:border-gold-400` |
| Logo badge | `bg-indigo-600` | `bg-gold-600` |
| Toast success/info | `text-indigo-600` / `indigo-500` | `text-gold-700` / `gold-500` |
| Highlight ring (расписание) | `ring-indigo-600` | `ring-gold-600` |
| Attendance «был» active | `bg-indigo-600` | `bg-gold-600` |
| Attendance «был» hover | `hover:bg-indigo-50` | `hover:bg-gold-50` |

---

## 3. Правило прозрачных вариантов

Вместо произвольных `/40 /50 /60 /70 /80 /95` — **ровно три** допустимых уровня:

| Уровень | Значение | Когда использовать |
|---|---|---|
| `/10` | лёгкий tint | фон бейджей, hover-подложки, `bg-ink-50/10`, highlight строк |
| `/40` | overlay средней плотности | backdrop модалок, disabled-состояния |
| `/70` | плотный overlay | плотный backdrop, тёмные бейджи (`lavender-900/70`) |

### 3.1 Типовые замены opacity (из кода)

| Было | Стало | Контекст |
|---|---|---|
| `slate-50/80`, `slate-50/60`, `slate-50/50` | `ink-50/10` или `ink-100/10` | подложки summary-блоков |
| `indigo-50/60`, `indigo-50/30` | `gold-50/10` | highlight персонального / toggle |
| `rose-50/60` | `garnet-50/10` | debtors block header |
| `amber-50/60`, `amber-50/80` | `amber-50` (solid) или `amber-50/10` | warning-баннеры |
| `slate-900/30`, `/50`, `/60` | `ink-950/40` | backdrop |
| `border-slate-200/90` | `border-ink-200` | карточки — solid border |
| `blue-900/50` | `lavender-900/70` | бейдж Subscription |

Любое другое значение (`/30`, `/50`, `/60`, `/80`, `/90`, `/95`) — заменить на ближайший из трёх уровней **по смыслу**, не по визуальному совпадению.

---

## 4. Обновлённая схема расписания — `scheduleColors.ts`

Текущая проблема: 4 разных хью-семейства на 4 типа занятий = визуальный шум. Новая логика: **gold + lavender + ink**, различение типа — цвет + **иконка типа** в `LessonBlock`.

| Тип занятия | Фон | Граница | Токен | Иконка lucide (`w-3 h-3`, слева от title) |
|---|---|---|---|---|
| Групповой урок | `gold-500` | `gold-700` | primary weight | `Users` |
| Персональный | `lavender-400` | `lavender-600` | secondary | `User` |
| Мероприятие | `lavender-600` | `lavender-700` | secondary, тёмный | `CalendarPlus` |
| Аренда зала | `ink-600` | `ink-700` | нейтраль | `Building2` |

Дополнительно в `LessonBlock.tsx`:
- `ring-indigo-600` (highlight) → `ring-gold-600`
- `ring-rose-500` (долг) → `ring-garnet-500`

Иконки уже используются в schedule-модуле (`Building2`, `CalendarPlus`, `CalendarDays`, `User`) — не вводить новые имена без необходимости.

---

## 5. Правила использования (перенести в `.cursor/docs/ai/design_system.md` после внедрения)

1. **Акцент UI — только `gold`.** Не использовать `lavender` для кнопок/CTA — только для второстепенных элементов (персональные уроки, мероприятия, premium-бейджи).
2. **Ошибки и долги — только `garnet`.** `red` в кодовой базе не должен встречаться нигде, включая auth-формы.
3. **`amber` — только пассивные warning-баннеры** (`50`/`200`/`700`), никогда кнопки в CRM.
4. **Telegram — `#229ED9` / `#1C82B4`**, единственное брендовое исключение вне токенов.
5. **Максимум 3 уровня прозрачности:** `/10`, `/40`, `/70`.
6. **Никаких хардкод-hex вне токенов**, кроме Telegram. `index.html` / `index.css` → `var(--color-ink-700)` и т.п. через `@theme`.
7. **`dev-console` использует ту же систему токенов** (`ink-900`/`ink-950` фон, `gold`/`garnet`/`sage`/`lavender`), не отдельную палитру `slate`.
8. **Шрифт CRM и dev-console — Inter.** Display-шрифты Atelier (Cormorant) — только landing, отдельный этап.
9. **Текстовые ссылки на светлом** — `gold-700`, не `gold-600`.

---

## 6. Продуктовые решения (закрыты 2026-08-17)

Вопросы из первой версии спеки — **решены** на основе фактического кода и ограничений B2B CRM.

### 6.1 Светлая vs тёмная тема

**Решение:** этап 1 — **светлый CRM** (`tangodb/`) с тёплыми `ink` нейтралями на `ink-50` + `white` карточки. Полный перевод CRM в тёмный Atelier — **не в scope v2**, отдельный этап (dark mode / `data-theme`).

| Приложение | Тема этапа 1 | Фон страницы | Карточки |
|---|---|---|---|
| `tangodb/` (CRM) | Light | `ink-50` | `white` |
| `tangodb-dev-console/` | Dark (как сейчас) | `ink-950` | `ink-900` |
| `tangodb-landing/` | Light | `ink-50` | `white` |

Токены `ink-25`…`ink-800` нужны для light CRM; `ink-900`/`ink-950` — для dev-console и backdrop. Не урезать ramp.

### 6.2 Шрифты

**Решение:** CRM и dev-console остаются на **Inter** (читаемость таблиц, форм, `text-[10px]` меток). `Cormorant Garamond` + `Plus Jakarta Sans` из брендбука Atelier — **не для CRM**; опционально для hero/display на landing в промпте 6 (не блокирует палитру).

### 6.3 Бейдж Subscription (dev-console)

**Решение:** `bg-blue-900/50 text-blue-300` → `bg-lavender-900/70 text-lavender-300` (SaaS-подписка = вторичный premium-статус, не primary gold).

---

## 7. Порядок внедрения (обзор)

1. Токены в `@theme` (параллельно со старыми).
2. Find & replace по приложениям (CRM → dev-console → landing).
3. `scheduleColors.ts` + иконки в `LessonBlock`.
4. Хардкод hex → переменные.
5. WCAG AA проверка.
6. Удаление legacy токенов (grep-чистка).
7. Замена `.cursor/docs/ai/design_system.md` содержимым §5 + структурные разделы из текущего файла (брейкпоинты, z-index, компоненты — обновить цвета, не удалять).

Детальные промпты — §9. Рекомендуемая последовательность и чеклист — §8.

---

## 8. Рекомендуемая последовательность (для владельца продукта)

### Как работать с промптами

1. **Один промпт = один новый чат в Cursor.** Не склеивать несколько промптов в одну сессию — diff раздувается, агент начинает пропускать grep-проверки.
2. **В начале каждого чата** приложи ссылку на файл: `@tangodb_design_system_v2.md` и напиши номер промпта («Выполни Промпт 2 из §9»).
3. **Промпт 0 обязателен** — без `DS-ATELIER-0` в `decision_log.md` агент может «улучшать» палитру от себя.
4. **После Промпта 1** визуально ничего не изменится — это нормально. Не останавливайся: смысл шага — зарегистрировать токены до массовой замены классов.
5. **Промпт 2 — самый объёмный.** Заложи время на ревью CRM: sidebar, формы, расписание, финансы, auth. Запусти `npm run dev` в `tangodb/` и пройди 5–6 ключевых экранов до Промпта 3.
6. **Промпты 4 и 5** можно запускать **параллельно** (два чата) сразу после Промпта 1 — они не зависят от Промпта 2. Но **Промпт 6** жди, пока закончатся 2, 4 и 5.
7. **Промпт 3** — после Промпта 2: расписание и иконки логично смотреть на уже перекрашенном CRM.
8. **Промпт 7** — единственный шаг, где ты **сознательно смотришь контраст** (ссылки gold-700, метки ink-400). Если что-то «мылится» — правки только в этом промпте, не размазывать по предыдущим.
9. **Промпт 9 — только в конце.** Версию `2.9.0` и `design_system.md` не трогать раньше: до Промпта 8 в коде ещё могут встречаться legacy-классы.
10. **Коммиты (по желанию):** удобно коммитить после Промптов 0, 2, 3, 6, 9 — чтобы откатить один этап без потери всего прогресса.

### Чеклист выполнения

Отмечай `[x]` по мере завершения. Дата/заметка — по желанию в конце строки.

| ☐ | # | Что запустить | Когда | После промпта проверь |
|---|---|---|---|---|
| ✅ | **0** | Decision log `DS-ATELIER-0` | Первым, до любого кода | Запись есть в `decision_log.md` — 2026-08-17 |
| ✅ | **1** | Токены `@theme` (3 приложения) | Сразу после 0 | `bg-ink-50` / `text-gold-700` резолвятся — 2026-08-17 |
| ✅ | **2** | CRM `tangodb/` — замена классов | После 1 | Dev-сервер CRM: nav, форма, таблица, модалка, auth — 2026-08-17 |
| ✅ | **3** | `scheduleColors.ts` + иконки `LessonBlock` | После 2 | Сетка расписания: 4 типа занятий + иконки — 2026-08-17 |
| ✅ | **4** | `tangodb-dev-console/` | После 1 *(можно параллельно с 2)* | OrgsPage, тёмный фон, бейдж Subscription — 2026-08-17 |
| ✅ | **5** | `tangodb-landing/` | После 1 *(можно параллельно с 2)* | Главная, CTA, preview-блоки — 2026-08-17 |
| ✅ | **6** | Хардкод hex + opacity | После 2 **и** 4 **и** 5 | Boot screen, focus ring, scrollbar; grep hex чистый — 2026-08-17 |
| ✅ | **7** | WCAG AA аудит | После 6 | Ссылки и метки читаемы; расписание на белом/цветном фоне — 2026-08-17 |
| ✅ | **8** | Grep-чистка legacy | После 7 | 0 вхождений legacy-классов в `src/` трёх apps — 2026-08-17 |
| ✅ | **9** | Docs + версия `2.9.0` | После 8 | `design_system.md`, `appVersion.ts`, changelog — 2026-08-17 |

**Краткая цепочка (если без параллели):**

```
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
```

**С параллелью (быстрее):**

```
0 → 1 → 2 ─┬→ 3 ─┐
           ├→ 4 ─┼→ 6 → 7 → 8 → 9
           └→ 5 ─┘
```

### Чеклист (отмечай `[x]` когда готово)

- [x] **Промпт 0** — Decision log `DS-ATELIER-0` → `decision_log.md` *(2026-08-17)*
- [x] **Промпт 1** — Токены `@theme` в CRM, dev-console, landing *(2026-08-17)*
- [x] **Промпт 2** — CRM: замена всех legacy-классов (`tangodb/`) *(2026-08-17)*
- [x] **Промпт 3** — Расписание: `scheduleColors.ts` + иконки в `LessonBlock` *(2026-08-17)*
- [x] **Промпт 4** — Dev-console: тёмная тема на Atelier *(2026-08-17)*
- [x] **Промпт 5** — Landing: светлая тема на Atelier *(2026-08-17)*
- [x] **Промпт 6** — Хардкод hex + нормализация opacity *(2026-08-17)*
- [x] **Промпт 7** — WCAG AA: контраст ссылок, меток, CTA *(2026-08-17)*
- [x] **Промпт 8** — Grep: 0 legacy `slate`/`indigo`/… в `src/` *(2026-08-17)*
- [x] **Промпт 9** — `design_system.md`, версия `2.9.0`, changelog *(2026-08-17)*

### Минимальный smoke-test после этапа (перед Промптом 9)

- [ ] CRM: логин, дашборд, расписание (неделя), продажа абонемента, красная ошибка / долг
- [ ] Dev-console: список orgs, бейдж Subscription, любой error/warning блок
- [ ] Landing: hero + одна кнопка CTA на мобильной ширине

---

## 9. Промпты для реализации

Готовые промпты для копирования в Cursor. Каждый — отдельный запуск. Перед каждым: `.cursor/docs/ai/AI_CONTEXT.md`. Спека — этот файл. **Не менять интерфейс сверх замены цветов** (layout, отступы, типографика — как есть).

Дата промптов: 2026-08-17. Этап 1 = подверсия **`2.9.0`** (новый контур Atelier palette). Бамп — только в Промпте 9. Чеклист — §8.

### Порядок и зависимости

| # | Промпт | Зависит от |
|---|--------|------------|
| 0 | Decision log `DS-ATELIER-0` | — |
| 1 | Токены `@theme` (3 приложения) | 0 |
| 2 | CRM `tangodb/` — замена классов | 1 |
| 3 | `scheduleColors.ts` + `LessonBlock` иконки | 1, 2 |
| 4 | `tangodb-dev-console/` | 1 |
| 5 | `tangodb-landing/` | 1 |
| 6 | Хардкод hex + opacity нормализация | 2, 4, 5 |
| 7 | WCAG AA аудит + фиксы контраста | 2–6 |
| 8 | Удаление legacy токенов (grep) | 2–7 |
| 9 | Закрытие: `design_system.md`, `2.9.0`, changelog | 8 |

### Общие правила для всех промптов с кодом

- **Не трогать** layout, spacing, z-index, брейкпоинты, размеры шрифтов.
- Логика Supabase — только `hooks/` / `lib/`; этот контур — только CSS/TSX классы.
- Не дублировать компоненты.
- `codegraph_explore` перед массовыми правками (`projectPath`: `D:\cursor_dev\TangoDB\tangodb` или соответствующий app).
- Telegram hex — не менять.
- После кода: `.cursor/docs/ai/changelog.md`. Архитектурное решение — Промпт 0 (`decision_log.md`).
- Проверка: `grep -r` по старым семействам в затронутом app после каждого промпта.

---

### Промпт 0 — decision log (этап 0) ✅ *(2026-08-17)*

```
Задача: зафиксировать решения Design System v2 Atelier перед реализацией.

Прочитай tangodb_design_system_v2.md целиком (§0–§6) и добавь в .cursor/docs/ai/decision_log.md запись DS-ATELIER-0.

Зафиксировать как принятые:

1. Палитра Atelier: ink / gold / lavender / sage / garnet / amber (6 семейств).
2. CRM light на этапе 1; dev-console dark; полный dark CRM — out of scope.
3. Шрифт CRM и dev-console — Inter; Cormorant только landing (отдельно).
4. slate→ink, indigo→gold, sky/violet/blue→lavender, emerald→sage, rose/red→garnet.
5. Прозрачность только /10, /40, /70.
6. scheduleColors: gold/lavender/ink + иконки в LessonBlock.
7. Subscription badge → lavender-900/70 + lavender-300.
8. gold-600 — filled CTA; gold-700 — текстовые ссылки на светлом.
9. Подверсия этапа 1: 2.9.0.
10. design_system.md заменяется после кода (Промпт 9), не сейчас.

Не менять код. Не создавать миграции. Только decision_log.md.
```

---

### Промпт 1 — токены `@theme` (все приложения) ✅ *(2026-08-17)*

```
Задача: добавить палитру Atelier в Tailwind v4 @theme во всех трёх приложениях. Старые Tailwind-default токены (slate, indigo, …) НЕ удалять.

Контекст: tangodb_design_system_v2.md §1 (все hex), §6.1.

Файлы:
- tangodb/src/index.css
- tangodb-dev-console/src/index.css
- tangodb-landing/src/index.css

Что сделать:

1. В каждом @theme добавить --color-ink-25 … --color-ink-950, --color-gold-*, --color-lavender-*, --color-sage-*, --color-garnet-* по таблицам §1.1–§1.4.
2. amber-50/200/700 — можно оставить Tailwind default или явно задать hex из §1.4.
3. Не менять существующие классы в компонентах на этом шаге.
4. Не менять body/sidebar цвета — только регистрация токенов.
5. Убедиться, что классы bg-ink-50, text-gold-700, bg-lavender-400 и т.д. резолвятся (smoke: один тестовый временный div можно не добавлять — достаточно корректного @theme).

После: changelog.md (одна строка «токены Atelier в @theme»).
```

---

### Промпт 2 — CRM `tangodb/` — замена Tailwind-классов ✅ *(2026-08-17)*

```
Задача: заменить legacy палитру на Atelier во всём tangodb/ (только className / @apply в index.css components layer).

Контекст: tangodb_design_system_v2.md §2, §2.1, §2.2, §3, §5.

Порядок:

1. codegraph_explore: buttonStyles.ts, AppSelect.tsx, App.tsx (layout/nav), index.css @layer components.
2. Замена по семействам: slate→ink (§2.1), indigo→gold (§2.2), sky/violet→lavender, emerald→sage, rose/red→garnet, blue→lavender.
3. Нормализовать opacity по §3.1 (не трогать файлы вне tangodb/).
4. white / Telegram hex — не менять.
5. После замены: grep в tangodb/ на паттерны (slate-|indigo-|sky-|violet-|emerald-|rose-|red-|blue-) — должно быть 0 в src/ (tests/supabase можно отдельно, если есть — перечислить в ответе).

Эталоны проверить визуально по коду:
- tangodb/src/components/ui/buttonStyles.ts
- tangodb/src/App.tsx (sidebar, nav, toast)
- tangodb/src/auth/AuthLayout.tsx
- tangodb/src/components/ui/AppSelect.tsx (fieldCls)

Не менять: h-8, rounded-*, spacing, font sizes, z-index.

После: changelog.md.
```

---

### Промпт 3 — `scheduleColors.ts` + иконки `LessonBlock` ✅ *(2026-08-17)*

```
Задача: обновить цвета расписания и добавить иконки типа занятия.

Контекст: tangodb_design_system_v2.md §4.

Файлы:
- tangodb/src/lib/scheduleColors.ts
- tangodb/src/components/schedule/LessonBlock.tsx

Что сделать:

1. scheduleColors: GROUP → gold-500/gold-700; PERSONAL → lavender-400/lavender-600; EVENT → lavender-600/lavender-700; RENTAL → ink-600/ink-700.
2. LessonBlock: импорт Users, User, CalendarPlus, Building2 из lucide-react.
3. В блоке с title — flex row, иконка w-3 h-3 shrink-0 перед текстом (если heightPx позволяет — при height < ROW_HEIGHT_PX можно скрыть иконку, оставить только цвет).
4. ring-indigo-600 → ring-gold-600; ring-rose-500 → ring-garnet-500.
5. Grep scheduleColors / LessonBlock — не должно остаться indigo/sky/violet/slate/rose в этих файлах.

Не менять: позиционирование, lessonHeightPx, onClick logic.

После: changelog.md.
```

---

### Промпт 4 — `tangodb-dev-console/` ✅ *(2026-08-17)*

```
Задача: миграция палитры Atelier в dev-console (тёмная тема).

Контекст: tangodb_design_system_v2.md §6.1 (dark), §2, §1.4 (garnet для emergency CTA).

1. index.css: body bg ink-950, text ink-100 (или ink-50).
2. Все slate → ink по роли (950 фон, 900 карточки, 400 вторичный текст).
3. indigo → gold, emerald → sage, rose/red → garnet, sky/violet/blue → lavender.
4. OrgsPage Subscription badge: lavender-900/70 + lavender-300.
5. OrgsPage emergency CTA (был amber-700/600): garnet-600 filled.
6. amber warning backgrounds → только amber-50/200/700.
7. grep dev-console src — 0 legacy семейств.

После: changelog.md.
```

---

### Промпт 5 — `tangodb-landing/` ✅ *(2026-08-17)*

```
Задача: миграция палитры Atelier на лендинге (light).

Контекст: tangodb_design_system_v2.md §2, §6.1.

1. slate → ink, indigo → gold, sky/violet/blue → lavender, emerald → sage, rose/red → garnet.
2. Компонентные классы в index.css (@layer components): btn-primary, btn-cta, demo-*.
3. red-300/80 декор preview → garnet-300/10 или garnet-200 (§3).
4. Не менять layout landing, не добавлять Cormorant на этом шаге.
5. grep landing src — 0 legacy семейств.

После: changelog.md.
```

---

### Промпт 6 — хардкод hex + финальная opacity ✅ *(2026-08-17)*

```
Задача: убрать hex вне токенов (кроме Telegram) и добить opacity.

Файлы (проверить все):
- tangodb/index.html (#boot-error)
- tangodb/src/index.css (:focus-visible, body bg, scrollbar)
- tangodb-landing/src/index.css
- tangodb-dev-console/src/index.css

1. #f8fafc → ink-50 (или var(--color-ink-50)).
2. #6366f1 focus → gold-400 или gold-500.
3. #334155 / #64748b boot fallbacks → ink-700 / ink-500.
4. Scrollbar thumb → ink-300, hover → gold-400.
5. Пройти grep по src всех apps: pattern #[0-9a-fA-F]{3,8} — только Telegram и прозрачные варiantы в @theme.
6. Добить оставшиеся /50 /60 /80 /90 в apps, если grep найдёт после промптов 2–5.

После: changelog.md.
```

---

### Промпт 7 — WCAG AA аудит ✅ *(2026-08-17)*

```
Задача: проверить контраст после миграции и исправить только цветовые классы.

Контекст: tangodb_design_system_v2.md §1.2 (gold-700 для ссылок), §5.9.

Проверить минимум 4.5:1 для текста:

1. ink-800 на ink-50 / white — основной текст.
2. ink-400 на white — метки полей (может быть 3:1 для large text — если fail, ink-500).
3. gold-700 на white — ссылки.
4. gold-600 bg + white text — primary CTA.
5. garnet-600 bg + white text — destructive.
6. lavender-400/600 блоки расписания + white text.
7. ink-600 блок аренды + white text.

Инструмент: ручной расчёт или contrast checker. Фиксить только классы (например text-gold-600 ссылку → gold-700).

Не менять layout. После: lessons.md если найден системный паттерн; changelog.md.
```

---

### Промпт 8 — удаление legacy (grep-чистка) ✅ *(2026-08-17)*

```
Задача: убедиться, что legacy семейства не используются в UI-коде; опционально убрать неиспользуемые @theme overrides если были.

1. grep -r по tangodb/src, tangodb-dev-console/src, tangodb-landing/src:
   slate-|indigo-|sky-|violet-|emerald-|rose-|red-|blue-
   Ожидание: 0 matches (или явный список исключений с объяснением).
2. Если 0 — можно добавить в .cursor/docs/ai/design_system.md правило «не использовать legacy» (полная замена — Промпт 9).
3. Не удалять Tailwind default palette из node_modules — только наш код.

После: changelog.md.
```

---

### Промпт 9 — закрытие этапа 1 ✅ *(2026-08-17)*

```
Задача: закрыть этап 1 Design System v2 Atelier.

1. Обновить .cursor/docs/ai/design_system.md:
   - Цветовая палитра → ink/gold/lavender/sage/garnet/amber из tangodb_design_system_v2.md §5.
   - Заменить все примеры классов (slate→ink, indigo→gold, …) в компонентных секциях.
   - Сохранить брейкпоинты, z-index, типографику Inter, отступы, компоненты — только цвета.
   - scheduleColors таблица из §4.
   - Правила агента — из §5.

2. Версия CRM 2.9.0: tangodb/package.json + tangodb/src/lib/appVersion.ts.

3. decision_log.md — статус DS-ATELIER-0 «реализовано».

4. changelog.md — записать 2.9.0 и контур Atelier.

5. project_colors.md — добавить в начало файла notice «устарел, см. design_system.md» (одна строка, не полный рерайт).

Не менять функциональный код на этом шаге, только docs + version files.
```

---

*Документ подготовлен как техническое задание для реализации в Cursor. Числовые hex-значения — рабочие ориентиры; финальную калибровку (насыщенность/яркость) можно скорректировать визуально на реальных экранах CRM в Промпте 7 перед фиксацией в токенах.*
