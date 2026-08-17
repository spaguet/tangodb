# Design System — TangoDB (Atelier v2)

Единый источник правил визуального стиля основного приложения (`tangodb/`).

Обновлять при изменении цветов, типографики, отступов или UI-паттернов.

**Спека этапа 1:** `tangodb_design_system_v2.md` (закрыта 2026-08-17, CRM `2.9.0`).

> **Legacy запрещён:** в UI-коде (`tangodb/src`, `tangodb-dev-console/src`, `tangodb-landing/src`) **не использовать** Tailwind-семейства `slate`, `indigo`, `sky`, `violet`, `emerald`, `rose`, `red`, `blue`. Актуальная палитра — 6 семейств: `ink`, `gold`, `lavender`, `sage`, `garnet`, `amber`.

---

## Стек UI

| Слой | Расположение |
|------|--------------|
| Tailwind CSS v4 | `tangodb/src/index.css` (`@import "tailwindcss"`, `@theme`) |
| Глобальные компонентные классы | `@layer components` в `index.css` |
| Переиспользуемые UI-компоненты | `tangodb/src/components/ui/` |
| Иконки | `lucide-react` |

**Не использовать:** `violet-*`, `emerald-*`, `purple-*`, `green-*`, `slate-*`, `indigo-*` — акцент только через `gold-*`; вторичный акцент — `lavender-*`.

---

## Брейкпоинты

| Префикс Tailwind | px | Поведение в проекте |
|------------------|----|---------------------|
| (базовый) | < 640px | Мобильный layout, нижняя навигация |
| `sm:` | ≥ 640px | Увеличенные горизонтальные паддинги, часть кнопок header |
| `md:` | ≥ 768px | **Sidebar вместо drawer**, основной flex-row layout |
| `lg:` | ≥ 1024px | Двухколоночные сетки панелей (`lg:grid-cols-12`, `lg:col-span-*`) |
| `xl:` | ≥ 1280px | Увеличенный padding контента (`xl:p-8`) |

Sidebar и desktop-layout — от `md:`. Сетки форм/дашборда — от `lg:`.

---

## Z-index слои

Явная шкала по фактическому использованию в коде. Не добавлять произвольные значения вне таблицы.

| Слой | Значение | Применение |
|------|----------|------------|
| `z-0` | 0 | Базовый поток |
| `z-10` | 10 | Кнопка «прокрутить вниз» внутри контента |
| `z-20` | 20 | Sticky header |
| `z-30` | 30 | Desktop sidebar |
| `z-40` | 40 | Mobile bottom nav; backdrop dropdown (`OrgSwitcher`) |
| `z-50` | 50 | Модали (контейнер + backdrop внутри), mobile drawer, меню dropdown |
| `z-[60]` | 60 | Toast-уведомления |

**Правила:** toast всегда выше модалей. Backdrop модали — внутри того же `z-50` контейнера, не отдельным слоем.

---

## Цветовая палитра (Atelier)

Токены зарегистрированы в `@theme` (`index.css`) каждого приложения. Максимум **6 семейств**.

### Нейтральная база — `ink` (заменяет `slate`)

Тёплый графитовый ramp.

| Токен | Hex | Назначение |
|-------|-----|------------|
| `ink-25` | `#FAF9F7` | Фон карточек на светлом фоне |
| `ink-50` | `#F5F3EF` | Фон страницы (light CRM) |
| `ink-100` | `#E8E4DC` | Разделители, неактивные табы, skeleton |
| `ink-200` | `#D6D0C4` | Границы карточек, полей |
| `ink-300` | `#B5AC9C` | Scrollbar thumb, empty icons |
| `ink-400` | `#8C8272` | Вторичные иконки |
| `ink-500` | `#6B6255` | Подписи, вторичные кнопки, **метки полей** |
| `ink-600` | `#4F473D` | Текст навигации |
| `ink-700` | `#39332B` | Sidebar текст, fallback boot |
| `ink-800` | `#241F1A` | Основной текст, заголовки панелей |
| `ink-900` | `#171310` | Фон карточек (dark dev-console) |
| `ink-950` | `#0D0B09` | Overlay backdrop, фон dev-console |
| `white` | `#ffffff` | Карточки, header, sidebar, модали |

**Маппинг по роли (не 1:1 по суффиксу):** см. `tangodb_design_system_v2.md` §2.1.

### Основной акцент — `gold` (заменяет `indigo`)

CTA, активная навигация, primary-кнопки, логотип, focus.

| Токен | Hex | Назначение |
|-------|-----|------------|
| `gold-50` | `#FBF3E3` | Фон активного пункта меню, highlight |
| `gold-100` | `#F5E4C0` | Focus ring, границы accent-блоков |
| `gold-200` | `#EDD096` | Hover border |
| `gold-300` | `#E2B665` | Hover border карточек |
| `gold-400` | `#D49F42` | Focus border, scrollbar hover |
| `gold-500` | `#C4902E` | Иконки секций, loader |
| `gold-600` | `#A97522` | Блоки расписания (групповой), ring highlight |
| `gold-700` | `#8A5D1B` | **Primary CTA** (filled), **текстовые ссылки** на светлом |
| `gold-800` | `#6B4715` | Hover CTA / ссылок |
| `gold-900` | `#4A3110` | Тёмные фоны с акцентом (dev-console) |

> **WCAG:** filled CTA — `bg-gold-700 text-white` (hover `gold-800`); inline-ссылки и accent-текст на светлом — `text-gold-700` (hover `gold-800`), не `gold-600`.

### Вторичный акцент — `lavender` (заменяет `sky` / `violet` / `blue`)

Персональные уроки, мероприятия, premium/особый статус, SaaS-бейджи. **Не для CTA.**

| Токен | Hex | Назначение |
|-------|-----|------------|
| `lavender-50` … `lavender-900` | см. `@theme` | Бейджи, блоки расписания, Subscription badge |
| `lavender-400` | `#9578C7` | Фон персонального урока |
| `lavender-500`–`600` | — | Персональный / мероприятие в расписании |
| `lavender-900/70` + `lavender-300` | — | Бейдж Subscription (dev-console) |

### Семантические (строго 3 семейства)

#### `sage` — успех (заменяет `emerald`)

` sage-50` / `sage-100` — фон sync badge; `sage-400`–`sage-600` — текст и иконки успеха.

#### `garnet` — ошибки, долги, destructive (заменяет `rose` и `red`)

| Роль | Токены |
|------|--------|
| Фон ошибок / долгов | `garnet-50`, `garnet-100` |
| Destructive CTA, attendance «не был» | `garnet-600` (hover `garnet-700`) |
| Текст долгов | `garnet-700` |
| Ring долга в расписании | `ring-garnet-500` |

#### `amber` — только пассивные warning-баннеры

Только `amber-50`, `amber-200`, `amber-700`. **Не кнопки в CRM.** Исключение dev-console emergency CTA → `garnet-600`.

### Бренд-исключение

Telegram-кнопки: `#229ED9` / `#1C82B4` — единственный разрешённый hex вне токенов.

### Прозрачность

Только три уровня: `/10` (tint, hover-подложки), `/40` (backdrop средней плотности), `/70` (плотный overlay, тёмные бейджи).

---

## Типографика

### Шрифт

```css
--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
```

Подключение: Google Fonts в `index.css` (weights 400, 600). CRM и dev-console — **только Inter**; display-шрифты Atelier (Cormorant) — только landing, отдельный этап.

Класс по умолчанию: `font-sans antialiased`.

### Размеры

| Класс | px | Назначение |
|-------|-----|------------|
| `text-[10px]` | 10 | **Минимум системы.** Метки полей, uppercase badges, stat labels, mobile tab labels |
| `text-[11px]` | 11 | Sidebar subtitle, секции nav, logo badge |
| `text-xs` | 12 | Toast, вторичный текст, табы |
| `text-sm` | 14 | Поля ввода, основной UI, текст empty state |
| `text-base` | 16 | Заголовок sidebar, panel title |
| `text-lg` | 18 | Значения статистики |
| `text-xl` | 20 | Крупные числа |

> **Минимальный размер — `text-[10px]`.** Не использовать `text-[8px]` или `text-[9px]`.

### Начертания

| Класс | Использование |
|-------|---------------|
| `font-normal` | Toast body, основной текст |
| `font-semibold` | Заголовки, кнопки, nav, значения, метки |
| `font-bold` | Редко (dev-console) |

### Стили текста

- **Метки полей:** `text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold`
- **Секции sidebar:** `text-[11px] text-ink-400 uppercase tracking-wider font-semibold`
- **Sidebar subtitle / logo badge:** `text-[11px]`
- **Mobile tab labels:** `text-[10px] font-semibold uppercase tracking-wide`
- **Заголовок панели:** `text-base font-semibold text-ink-800 tracking-tight`
- **Uppercase CTA:** `text-xs font-semibold uppercase tracking-wider` или `tracking-widest`

---

## Иконки

Библиотека: `lucide-react`.

| Контекст | Размер |
|----------|--------|
| Внутри кнопки (CTA), nav, icon button, search | `w-4 h-4` |
| Компактные inline-иконки, тип занятия в расписании | `w-3 h-3` |
| Мелкие inline (Ticket в badge) | `w-3.5 h-3.5` |
| Заголовки секций, stat cards, modal close | `w-5 h-5` |
| Empty state | `w-8 h-8` |
| Крупные иллюстративные | `w-6 h-6` |
| Loader (спиннер) | `w-7 h-7` |

**Правило:** использовать Tailwind-классы (`w-4 h-4`), не произвольные `w-[16px]`. Для нового кода — `w-4` по умолчанию; `w-3`/`w-3.5` только для плотных inline-элементов в таблицах.

---

## Отступы и сетка

### Layout-классы (`index.css`)

| Класс | Tailwind | Назначение |
|-------|----------|------------|
| `.panel-page-stack` | `space-y-4` | Вертикальный стек страницы панели |
| `.panel-card-stack` | `space-y-3` | Стек внутри карточки |
| `.panel-form-stack` | `space-y-3 text-sm` | Форма |
| `.panel-form-stack-compact` | `space-y-1`, `md:gap-y-1`, divider `pt-1`, field `space-y-0.5` | Компактная форма |
| `.field-stack` | `space-y-1` | Label + input |
| `.panel-form-header` | `text-center space-y-1 border-b border-ink-100 pb-3` | Шапка формы |
| `.panel-form-divider` | `border-t border-ink-100 pt-3` | Разделитель формы |

### Типичные значения

| Паттерн | Классы |
|---------|--------|
| Padding карточки | `p-3.5`, `p-4`, `px-3 py-2.5` |
| Gap сетки виджетов | `gap-3`, `gap-4` |
| Sidebar width | `w-64` (256px) |
| Content padding | `px-4 sm:px-6`, секция `p-4 sm:p-5 md:p-6 xl:p-8` |
| Max modal width | `max-w-lg`, `max-w-sm` |

### Сетка dashboard

- Виджеты сверху: `grid grid-cols-2 gap-3`
- Основной блок: `grid grid-cols-1 lg:grid-cols-12 gap-4` (5 + 7 колонок)

---

## Скругления

| Класс | Использование |
|-------|---------------|
| `rounded` | Logo badge |
| `rounded-md` | Nav items, badges |
| `rounded-lg` | **Кнопки, поля, карточки-строки** (основной) |
| `rounded-xl` | **Карточки панелей, модали, toast** |
| `rounded-full` | Scroll btn, toast close, dots |
| `rounded-t-lg` | Page tabs |

---

## Тени

| Класс | Назначение |
|-------|------------|
| `shadow-xs` | Карточки, sidebar, header, primary buttons |
| `shadow-sm` | Hover карточек |
| `shadow-md` | Mobile nav, scroll button |
| `shadow-lg` | Toast, drawer, dropdown |
| `shadow-xl` | Modals, mobile drawer |

---

## Переходы

Стандарт: `transition-all` или `transition-colors` без кастомной duration (Tailwind default ~150ms).

Focus outline (глобально в `index.css`):

```css
:focus-visible {
  outline: 2px solid var(--color-gold-500);
  outline-offset: 2px;
  border-radius: 4px;
}
```

---

## Компоненты

### Кнопки

**Общее правило:** высота всех кнопок = `h-8` (как `fieldCls` / `selectFieldCls`). Базовые классы — `tangodb/src/components/ui/buttonStyles.ts`.

| Тип | Класс | Цвет | Регистр текста | Когда |
|-----|-------|------|----------------|-------|
| Добавление / создание | `btnAddCls` | gold filled (`gold-700`) | С заглавной буквы, **без** uppercase | «Добавить», «Создать», сохранить |
| Добавление (мягкое) | `btnAddSoftCls` | gold outline | С заглавной буквы | Вторичное создание |
| Открытие popup / страницы | `btnOpenCls` | gold outline | С заглавной буквы | Диалоги, «Мероприятие», «Аренда» |
| Удаление / предупреждение | `btnDestructiveCls` | garnet filled | **UPPERCASE** | Удалить, опасное действие |
| Обновить / отмена | `btnRefreshCls` / `btnCancelCls` | ink | **UPPERCASE** | «Обновить», «Отмена» |
| Текстовая ссылка «+ Добавить» | `btnAddLinkCls` | `text-gold-700` | С заглавной буквы | Внутри форм |

**Header:**

| Элемент | Класс |
|---------|--------|
| Email / Telegram / WhatsApp | `btnHeaderContactCls` — outline white, h-8 |
| Выход (Sign out) | `btnHeaderSignOutCls` — outline ink, h-8 |

**Secondary / outline (legacy):**
```
border border-ink-200 text-ink-500 hover:text-ink-800 hover:bg-ink-50
rounded-lg text-xs font-semibold h-8
```

**Accent secondary (продажа пакета):**
```
bg-gold-50 text-gold-700 border border-gold-200 hover:bg-gold-100 h-10
```

**Icon button (edit):**
```
p-1.5 text-ink-400 hover:text-gold-700 hover:bg-gold-50 rounded-lg transition-all cursor-pointer
```

**Icon button (delete):**
```
p-1.5 text-ink-400 hover:text-garnet-600 hover:bg-garnet-50 rounded-lg transition-all cursor-pointer
```

**Dashed link:**
```
border border-dashed border-ink-300 hover:border-ink-400
text-ink-500 text-[11px] uppercase tracking-wider font-semibold h-10
```

> **Не использовать amber для кнопок.** Amber — только пассивные warning-баннеры.

### Поля ввода

Эталон (`fieldCls`, `selectFieldCls` в `AppSelect.tsx`):

```
w-full h-8 box-border bg-ink-50 border border-ink-200
focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-100
outline-none rounded-lg px-3 text-xs transition-all
```

**Select:** `selectFieldCls` = `fieldCls` + `appearance-none cursor-pointer pr-10`.

**Поиск:** `searchFieldCls` = `fieldCls` + `pl-9 pr-3`; иконка `Search` — `absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4`.

**Описание (textarea):** `descriptionFieldCls` — `min-h-[4.5rem]`, `resize-none`.

Метка: `selectLabelCls` — `text-[10px] text-ink-500 uppercase`.

### Карточки

```
bg-white rounded-xl border border-ink-200 shadow-xs
```

Hover-кликабельные виджеты:
```
hover:shadow-sm transition-all cursor-pointer
```

### Навигация (sidebar)

**Активный пункт:**
```
bg-gold-50 text-gold-700 border-l-2 border-gold-600 pl-2.5
text-xs font-semibold tracking-wide
```

**Неактивный:**
```
text-ink-600 hover:bg-ink-50 hover:text-ink-950
```

**Logo badge:**
```
w-8 h-8 bg-gold-600 rounded text-white font-semibold text-[11px] shadow-xs
```

### Page tabs (`PageTabs.tsx`)

- Активный: `bg-white border-ink-200 text-gold-700`
- Неактивный: `bg-ink-100/10 text-ink-400 hover:bg-ink-100`

### Toast (`App.tsx`)

| Тип | Accent |
|-----|--------|
| success | `text-gold-700` |
| error | `text-garnet-600` |
| info | `text-gold-500` |

Контейнер: `bg-white border border-ink-200 rounded-xl shadow-lg text-xs z-[60]`.

### Badges / статусы

**Uppercase pill:**
```
text-[10px] font-sans font-semibold uppercase tracking-wider
px-2 py-0.5 rounded
```

**Count badge (warning):**
```
text-[10px] bg-garnet-50 text-garnet-700 font-semibold tabular-nums
```

**Day badge:**
```
text-[10px] uppercase bg-gold-50 text-gold-700 font-semibold
```

### Таблицы

- Header row: `bg-ink-50` или inline cards
- Row hover: `hover:bg-ink-50`
- Scrollbar: 5px, thumb `ink-300`, hover `gold-400`

### Модальные окна

```
bg-white rounded-xl border border-ink-200 shadow-xl z-50
max-h-[90vh] overflow-y-auto
```

Backdrop: `absolute inset-0 bg-ink-950/40 backdrop-blur-xs`.

### Attendance toggle

| Состояние | «Был» | «Не был» |
|-----------|-------|----------|
| Active | `bg-gold-600 border-gold-600 text-white` | `bg-garnet-600 border-garnet-600 text-white` |
| Inactive | `hover:border-gold-300 hover:bg-gold-50` | `hover:border-garnet-300 hover:bg-garnet-50` |

### Пустое состояние (Empty State)

```
text-center py-20 text-ink-400 space-y-3
```

- Иконка: `w-8 h-8 mx-auto text-ink-300`
- CTA: `text-xs font-semibold text-gold-700 hover:text-gold-800 hover:underline`

### Скелетон / загрузка

Spinner: `Loader2 w-7 h-7 text-gold-500 animate-spin`

Skeleton: `bg-ink-100 rounded-lg animate-pulse`

Пульсирующая точка «live»: `w-1.5 h-1.5 bg-gold-500 rounded-full animate-pulse`.

---

### Finance sub-layout

Навигация внутри `/finance/*` — горизонтальная панель; active = `bg-gold-50 text-gold-700 border-gold-100`.

Эталон: `tangodb/src/pages/FinanceLayout.tsx`.

### Dashboard split (RBAC)

| Роль | Компонент |
|------|-----------|
| owner, director | `OperationalDashboard` + `FinancialDashboard` |
| admin | `OperationalDashboard` |
| accountant | `FinancialDashboard` |
| teacher (scope) | `TeacherScopedDashboard` |

Teacher scoped home: quick-link кнопки `border-ink-200`, icon `gold-600`; empty state `text-ink-400`.

---

## Расписание — цвета блоков (`scheduleColors.ts`)

Различение типа — **цвет + иконка** в `LessonBlock` (`w-3 h-3`).

| Тип | Фон | Граница | Иконка lucide |
|-----|-----|---------|---------------|
| Групповой урок | `gold-500` | `gold-700` | `Users` |
| Персональный | `lavender-500` | `lavender-600` | `User` |
| Мероприятие | `lavender-600` | `lavender-700` | `CalendarPlus` |
| Аренда зала | `ink-600` | `ink-700` | `Building2` |

Дополнительно: highlight ring → `ring-gold-600`; долг → `ring-garnet-500`.

---

## Правила для агента

1. **Акцент UI — только `gold`.** Не использовать `lavender` для кнопок/CTA.
2. **Ошибки и долги — только `garnet`.** `red` в кодовой базе не должен встречаться.
3. **`amber` — только пассивные warning-баннеры** (`50`/`200`/`700`), никогда кнопки в CRM.
4. **Telegram — `#229ED9` / `#1C82B4`**, единственное брендовое исключение вне токенов.
5. **Максимум 3 уровня прозрачности:** `/10`, `/40`, `/70`.
6. **Никаких хардкод-hex вне токенов**, кроме Telegram.
7. **`dev-console` использует ту же систему токенов** (`ink-900`/`ink-950` фон, `gold`/`garnet`/`sage`/`lavender`).
8. **Шрифт CRM и dev-console — Inter.**
9. **Текстовые ссылки на светлом** — `gold-700`, не `gold-600`.
10. **Кнопки — через `buttonStyles.ts`.** Add/open — sentence case; destructive — garnet + uppercase.
11. **Не дублировать стили полей** — `AppSelect`, `fieldCls`, `selectLabelCls`.
12. **Карточки панелей** — `rounded-xl`.
13. **Высота кнопок и полей** — `h-8` (`controlHeightCls`).
14. **Метки полей** — `text-[10px]`, uppercase, `ink-500`.
15. **Z-index** — только из таблицы слоёв.
16. При изменении палитры — обновить этот файл.

---

## Файлы-эталоны

| Паттерн | Файл |
|---------|------|
| Layout, nav, toast | `tangodb/src/App.tsx` |
| Глобальные стили | `tangodb/src/index.css` |
| Select / labels / buttons | `tangodb/src/components/ui/AppSelect.tsx`, `buttonStyles.ts` |
| Tabs | `tangodb/src/components/ui/PageTabs.tsx` |
| Расписание | `tangodb/src/lib/scheduleColors.ts`, `LessonBlock.tsx` |
| Dashboard widgets | `OperationalDashboard.tsx`, `FinancialDashboard.tsx`, `TeacherScopedDashboard.tsx` |
| Finance sub-nav | `tangodb/src/pages/FinanceLayout.tsx` |
| Auth forms | `tangodb/src/auth/AuthLayout.tsx` |

---

## Changelog

| Дата | Изменение |
|------|-----------|
| 2026-08-17 | **Atelier v2 (2.9.0):** палитра `ink`/`gold`/`lavender`/`sage`/`garnet`/`amber`; расписание gold+lavender+ink с иконками; WCAG-фиксы CTA и меток. |
| 2026-08-01 | Компактные контролы h-8; add/save/open без uppercase. |
| 2026-06-20 | RBAC R5: FinanceLayout, split dashboard. |
| 2026-06-19 | Унификация палитры (legacy indigo/slate). |
