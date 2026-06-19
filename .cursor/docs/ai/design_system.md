# Design System — TangoDB

Единый источник правил визуального стиля основного приложения (`tangodb/`).

Обновлять при изменении цветов, типографики, отступов или UI-паттернов.

---

## Стек UI

| Слой | Расположение |
|------|--------------|
| Tailwind CSS v4 | `tangodb/src/index.css` (`@import "tailwindcss"`) |
| Глобальные компонентные классы | `@layer components` в `index.css` |
| Переиспользуемые UI-компоненты | `tangodb/src/components/ui/` |
| Иконки | `lucide-react` |

**Не использовать:** `violet-*`, `emerald-*`, `purple-*`, `green-*` — акцент только через `indigo-*`.

---

## Цветовая палитра

### Нейтральные (slate)

| Токен Tailwind | Назначение |
|----------------|------------|
| `slate-50` | Фон страницы (`body`, `AppLayout`) |
| `slate-100` | Разделители, фон неактивных табов, hover sidebar |
| `slate-200` | Границы карточек, полей, header, sidebar |
| `slate-300` | Пунктирные границы, scrollbar thumb |
| `slate-400` | Вторичный текст, плейсхолдеры, метки полей |
| `slate-500` | Подписи, вторичные кнопки |
| `slate-600` | Текст навигации, иконки |
| `slate-700` | Текст sidebar |
| `slate-800` | Основной текст, заголовки панелей |
| `slate-900` | Overlay backdrop (`bg-slate-900/40`) |
| `slate-950` | Hover текста навигации |
| `white` | Карточки, header, sidebar, модали |

### Акцент (indigo) — основной цвет бренда

| Токен | Hex (примерно) | Назначение |
|-------|----------------|------------|
| `indigo-50` | `#eef2ff` | Фон активного пункта меню, highlight-карточки, success-баннеры |
| `indigo-100` | `#e0e7ff` | Focus ring полей (`ring-indigo-100`), границы accent-блоков |
| `indigo-200` | `#c7d2fe` | Hover border, spinner track |
| `indigo-300` | `#a5b4fc` | Hover border карточек расписания |
| `indigo-400` | `#818cf8` | Focus border полей, scrollbar hover |
| `indigo-500` | `#6366f1` | Иконки секций, loader, focus outline (`index.css`) |
| `indigo-600` | `#4f46e5` | **Primary CTA**, логотип, активные кнопки, ссылки |
| `indigo-700` | `#4338ca` | Активный текст nav, значения статистики, персональные уроки |
| `indigo-800` | `#3730a3` | Hover ссылок |

### Семантические

| Роль | Tailwind | Когда |
|------|----------|-------|
| Ошибка / предупреждение / долг | `rose-50`, `rose-100`, `rose-600`, `rose-700` | Ошибки, неоплаченные уроки, низкий баланс, destructive |
| Предупреждение (лицензия) | `amber-50`, `amber-100`, `amber-800` | Demo retention, осторожные статусы |
| Информация | `indigo-500`, `indigo-600` | Toast info, подсказки, ссылки |
| Успех / оплачено / присутствие | `indigo-600`, `indigo-700`, `indigo-50` | Toast success, оплаченные уроки, «был на занятии» |
| Telegram | `#229ED9` / `#1C82B4` | Только для кнопок Telegram (исключение из палитры) |

### Различие типов занятий (оба — indigo)

| Тип | Маркер | Фон строки |
|-----|--------|------------|
| Групповой | точка `bg-indigo-500` | `bg-slate-50` |
| Персональный | точка `bg-indigo-700` | `bg-indigo-50/60`, border `indigo-100` |

---

## Типографика

### Шрифт

```css
--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
```

Подключение: Google Fonts в `index.css` (weights 400, 600).

Класс по умолчанию: `font-sans antialiased`.

### Размеры

| Класс | px | Назначение |
|-------|-----|------------|
| `text-[8px]` | 8 | Мобильные tab labels |
| `text-[9px]` | 9 | Sidebar subtitle, секции nav |
| `text-[10px]` | 10 | **Метки полей**, uppercase badges, stat labels |
| `text-[11px]` | 11 | Мелкий UI-текст |
| `text-xs` | 12 | Toast, вторичный текст, табы |
| `text-sm` | 14 | Поля ввода, основной UI |
| `text-base` | 16 | Заголовок sidebar, panel title |
| `text-lg` | 18 | Значения статистики |
| `text-xl` | 20 | Крупные числа |
| `text-2xl` | 24 | — |

### Начертания

| Класс | Использование |
|-------|---------------|
| `font-normal` | Toast body |
| `font-semibold` | Заголовки, кнопки, nav, значения |
| `font-bold` | Редко (dev-console) |

### Стили текста

- **Метки полей:** `text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold`
- **Секции sidebar:** `text-[9px] text-slate-400 uppercase tracking-wider font-semibold`
- **Заголовок панели:** `text-base font-semibold text-slate-800 tracking-tight`
- **Uppercase CTA:** `text-xs font-semibold uppercase tracking-wider` или `tracking-widest`

---

## Отступы и сетка

### Layout-классы (`index.css`)

| Класс | Tailwind | Назначение |
|-------|----------|------------|
| `.panel-page-stack` | `space-y-4` | Вертикальный стек страницы панели |
| `.panel-card-stack` | `space-y-3` | Стек внутри карточки |
| `.panel-form-stack` | `space-y-3 text-sm` | Форма |
| `.field-stack` | `space-y-1` | Label + input |
| `.panel-form-header` | `text-center space-y-1 border-b border-slate-100 pb-3` | Шапка формы |
| `.panel-form-divider` | `border-t border-slate-100 pt-3` | Разделитель формы |

### Типичные значения

| Паттерн | Классы |
|---------|--------|
| Padding карточки | `p-3.5`, `p-4`, `px-3 py-2.5` |
| Gap сетки виджетов | `gap-3`, `gap-4` |
| Sidebar width | `w-64` (256px) |
| Content padding | `px-4 sm:px-6` |
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
| `shadow-lg` | Toast, drawer |
| `shadow-xl` | Modals, mobile drawer |

---

## Переходы

Стандарт: `transition-all` или `transition-colors` без кастомной duration (Tailwind default ~150ms).

Focus outline (глобально в `index.css`):

```css
:focus-visible {
  outline: 2px solid #6366f1; /* indigo-500 */
  outline-offset: 2px;
  border-radius: 4px;
}
```

---

## Компоненты

### Кнопки

**Primary CTA:**
```
bg-indigo-600 hover:bg-indigo-700 text-white
font-sans text-xs font-semibold uppercase tracking-wider
rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60
```

**Secondary / outline:**
```
border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50
rounded-lg text-xs font-semibold
```

**Accent secondary (продажа пакета, переключатели):**
```
bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100
```

**Destructive:**
```
bg-rose-600 hover:bg-rose-700 text-white
```

**Icon button (edit):**
```
p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer
```

**Icon button (delete):**
```
p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer
```

**Dashed link:**
```
border border-dashed border-slate-300 hover:border-slate-400
text-slate-500 text-[11px] uppercase tracking-wider font-semibold
```

### Поля ввода

Эталон (`selectFieldCls`, дублировать для `input`/`textarea`):

```
w-full bg-slate-50 border border-slate-200
focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100
outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all
```

Метка: `selectLabelCls` из `AppSelect.tsx`.

**Правило:** все `<select>` — через `AppSelect` или `selectFieldCls` (см. `.cursor/rules/dropdowns.mdc`).

### Карточки

```
bg-white rounded-xl border border-slate-200/90 shadow-xs
```

Hover-кликабельные виджеты:
```
hover:shadow-sm transition-all cursor-pointer
```

### Навигация (sidebar)

**Активный пункт:**
```
bg-indigo-50 text-indigo-700 border-l-2 border-indigo-600 pl-2.5
text-xs font-semibold tracking-wide
```

**Неактивный:**
```
text-slate-600 hover:bg-slate-50 hover:text-slate-950
```

**Logo badge:**
```
w-8 h-8 bg-indigo-600 rounded text-white font-semibold text-[9px] shadow-xs
```

### Page tabs (`PageTabs.tsx`)

- Активный: `bg-white border-slate-200 text-indigo-700`
- Неактивный: `bg-slate-100/70 text-slate-400 hover:bg-slate-100`

### Toast (`App.tsx`)

| Тип | Accent |
|-----|--------|
| success | `text-indigo-600` |
| error | `text-rose-600` |
| info | `text-indigo-500` |

Контейнер: `bg-white border border-slate-200 rounded-xl shadow-lg text-xs`.

### Badges / статусы

**Uppercase pill:**
```
text-[10px] font-sans font-semibold uppercase tracking-wider
px-2 py-0.5 rounded
```

**Count badge (warning):**
```
text-[10px] bg-rose-50 text-rose-700 font-semibold tabular-nums
```

**Day badge:**
```
text-[10px] uppercase bg-indigo-50 text-indigo-700 font-semibold
```

### Таблицы

- Header row: `bg-slate-50` или inline cards
- Row hover: `hover:bg-slate-50`
- Scrollbar: 5px, thumb `slate-300`, hover `indigo-400`

### Модальные окна

```
bg-white rounded-xl border border-slate-200 shadow-xl
max-h-[90vh] overflow-y-auto
```

Backdrop: `bg-slate-900/40 backdrop-blur-xs`

### Attendance toggle (был / не был)

| Состояние | «Был» | «Не был» |
|-----------|-------|----------|
| Active | `bg-indigo-600 border-indigo-600 text-white` | `bg-rose-600 border-rose-600 text-white` |
| Inactive | `hover:border-indigo-300 hover:bg-indigo-50` | `hover:border-rose-300 hover:bg-rose-50` |

### Loader

```
Loader2 w-7 h-7 text-indigo-500 animate-spin
```

---

## Правила для агента

1. **Акцентный цвет — только indigo.** Не добавлять violet/emerald/green/purple.
2. **Ошибки и долги — rose.** Не заменять rose на indigo.
3. **Не дублировать стили полей** — использовать `AppSelect`, `selectFieldCls`, `selectLabelCls`.
4. **Не использовать inline-стили** (`style={{}}`), кроме grid columns в `PageTabs`.
5. **Карточки панелей** — `rounded-xl`, не `rounded-2xl`.
6. **CTA-кнопки** — uppercase + tracking-wider/widest.
7. **Метки полей** — всегда 10px, uppercase, slate-400.
8. **Персональные vs групповые** — различать оттенком indigo (500 vs 700), не другим цветом.
9. **Новые UI-компоненты** — в `tangodb/src/components/ui/`, следовать существующим паттернам.
10. При изменении палитры — обновить этот файл.

---

## Файлы-эталоны

| Паттерн | Файл |
|---------|------|
| Layout, nav, toast | `tangodb/src/App.tsx` |
| Глобальные стили | `tangodb/src/index.css` |
| Select / labels | `tangodb/src/components/ui/AppSelect.tsx` |
| Tabs | `tangodb/src/components/ui/PageTabs.tsx` |
| Dashboard widgets | `tangodb/src/components/Dashboard.tsx` |
| Auth forms | `tangodb/src/auth/AuthLayout.tsx` |
| Primary forms | `tangodb/src/components/SchedulePanel.tsx` |

---

## Записи

```
2026-06-19 — Унификация палитры: violet/emerald заменены на indigo; rose сохранён для ошибок. Документ заполнен.
```
