# Цвета проекта TangoDB

> **Устарел (2026-08-17):** актуальная палитра — `.cursor/docs/ai/design_system.md` (Atelier v2) и `tangodb_design_system_v2.md`.

Сводка всех цветов, используемых в репозитории: основное CRM (`tangodb/`), админ-консоль (`tangodb-dev-console/`), лендинг (`tangodb-landing/`).

**Стек:** Tailwind CSS v4 (палитра по умолчанию) + несколько кастомных hex.  
**Источник истины по UI-правилам:** `.cursor/docs/ai/design_system.md`

Формат записи: `токен` — `#hex` — где применяется.

---

## Белый и чёрный

| Токен | Hex | Применение |
|-------|-----|------------|
| `white` | `#ffffff` | Карточки, header, sidebar, модали, фон кнопок, текст на цветных CTA |
| `black` | `#000000` | Не используется напрямую в UI-классах |

---

## Серые (slate)

Нейтральная палитра — фон, текст, границы, overlay.

| Токен | Hex | Применение |
|-------|-----|------------|
| `slate-50` | `#f8fafc` | Фон страницы (`body`, `AppLayout`, auth) |
| `slate-100` | `#f1f5f9` | Разделители, неактивные табы, hover sidebar, skeleton |
| `slate-200` | `#e2e8f0` | Границы карточек, полей, header, sidebar |
| `slate-300` | `#cbd5e1` | Пунктирные границы, scrollbar thumb, иконки empty state |
| `slate-400` | `#94a3b8` | Вторичный текст, плейсхолдеры, метки полей |
| `slate-500` | `#64748b` | Подписи, вторичные кнопки, fallback в `index.html` |
| `slate-600` | `#475569` | Текст навигации, иконки; аренда зала в расписании |
| `slate-700` | `#334155` | Текст sidebar; fallback в `index.html` |
| `slate-800` | `#1e293b` | Основной текст, заголовки панелей |
| `slate-900` | `#0f172a` | Overlay backdrop (`bg-slate-900/40`) |
| `slate-950` | `#020617` | Hover текста навигации; фон dev-console |

### Прозрачные варианты slate (в коде)

`slate-50/40` · `slate-50/50` · `slate-50/60` · `slate-50/70` · `slate-50/80` · `slate-50/95` · `slate-100/70` · `slate-100/80` · `slate-200/60` · `slate-200/70` · `slate-200/80` · `slate-200/90` · `slate-300/50` · `slate-700/80` · `slate-800/60` · `slate-800/70` · `slate-900/30` · `slate-900/40` · `slate-900/50` · `slate-900/60` · `slate-950/60`

---

## Синие / индиго (indigo)

**Основной акцент бренда** — CTA, ссылки, активная навигация, успех, focus.

| Токен | Hex | Применение |
|-------|-----|------------|
| `indigo-50` | `#eef2ff` | Фон активного пункта меню, highlight-карточки, статус «оплачено» |
| `indigo-100` | `#e0e7ff` | Focus ring полей, границы accent-блоков |
| `indigo-200` | `#c7d2fe` | Hover border, spinner track, outline-кнопки |
| `indigo-300` | `#a5b4fc` | Hover border карточек расписания |
| `indigo-400` | `#818cf8` | Focus border полей, scrollbar hover |
| `indigo-500` | `#6366f1` | Иконки секций, loader, focus outline (`index.css`) |
| `indigo-600` | `#4f46e5` | **Primary CTA**, логотип, активные кнопки, ссылки, групповые уроки |
| `indigo-700` | `#4338ca` | Активный текст nav, значения статистики, персональные уроки (точка) |
| `indigo-800` | `#3730a3` | Hover ссылок |
| `indigo-900` | `#312e81` | Dev-console hover-фоны |
| `indigo-950` | `#1e1b4b` | Dev-console фоны |

### Прозрачные варианты indigo

`indigo-50/30` · `indigo-50/40` · `indigo-50/50` · `indigo-50/60` · `indigo-50/70` · `indigo-50/80` · `indigo-100/40` · `indigo-200/20` · `indigo-200/80` · `indigo-400/80` · `indigo-500/20` · `indigo-500/70` · `indigo-600/20` · `indigo-600/30` · `indigo-600/50` · `indigo-600/70` · `indigo-600/80` · `indigo-700/70` · `indigo-800/90` · `indigo-900/50` · `indigo-950/50` · `indigo-950/60`

---

## Голубые (sky)

Персональные уроки в сетке расписания, заморозка абонемента, ссылки на оплату.

| Токен | Hex | Применение |
|-------|-----|------------|
| `sky-50` | `#f0f9ff` | Фон бейджей, блок поддержки в настройках |
| `sky-100` | `#e0f2fe` | Границы бейджей |
| `sky-200` | `#bae6fd` | Граница карточек (лендинг) |
| `sky-300` | `#7dd3fc` | Hover attendance toggle |
| `sky-400` | `#38bdf8` | Фон блока персонального урока (`scheduleColors.ts`) |
| `sky-500` | `#0ea5e9` | Border персонального урока (`scheduleColors.ts`) |
| `sky-600` | `#0284c7` | Активный attendance toggle, иконки поддержки |
| `sky-700` | `#0369a1` | Текст бейджа «заморозка» (лендинг) |
| `sky-800` | `#075985` | Hover ссылок |

### Прозрачные варианты sky

`sky-50/80`

---

## Фиолетовые (violet)

Мероприятия (календарь), финансовые коррекции, блок «нет преподавателя».

| Токен | Hex | Применение |
|-------|-----|------------|
| `violet-50` | `#f5f3ff` | Фон диалогов мероприятий, кнопки popup |
| `violet-100` | `#ede9fe` | Границы, блок missing teachers |
| `violet-200` | `#ddd6fe` | Границы кнопок, hover |
| `violet-300` | `#c4b5fd` | Выбранный тип мероприятия |
| `violet-400` | `#a78bfa` | Иконка chevron |
| `violet-500` | `#8b5cf6` | Финансовый дашборд — аренда |
| `violet-600` | `#7c3aed` | CTA мероприятий, блок в расписании (`scheduleColors.ts`) |
| `violet-700` | `#6d28d9` | Текст, иконки мероприятий; border (`scheduleColors.ts`) |
| `violet-800` | `#5b21b6` | Акцент в popup, hover |

### Прозрачные варианты violet

`violet-50/50` · `violet-50/60` · `violet-200/80`

---

## Зелёные (emerald)

Успех, синхронизация, положительные суммы — **не основной акцент UI** (в CRM предпочтителен indigo).

| Токен | Hex | Применение |
|-------|-----|------------|
| `emerald-50` | `#ecfdf5` | Фон статуса Google Calendar sync |
| `emerald-100` | `#d1fae5` | Граница sync badge |
| `emerald-200` | `#a7f3d0` | — |
| `emerald-300` | `#6ee7b7` | Бейдж Lifetime (dev-console) |
| `emerald-400` | `#34d399` | Успех, скопированный ключ (dev-console) |
| `emerald-600` | `#059669` | — |
| `emerald-700` | `#047857` | Превью отмены аренды (возврат средств) |
| `emerald-800` | `#065f46` | — |
| `emerald-900` | `#064e3b` | Границы блоков с паролем/ключом (dev-console) |
| `emerald-950` | `#022c22` | Фон success-баннеров (dev-console) |

### Прозрачные варианты emerald

`emerald-300/80` · `emerald-900/40` · `emerald-900/50` · `emerald-950/40` · `emerald-950/50`

---

## Красные и розовые (red, rose)

Ошибки, долги, destructive-действия, отсутствие на занятии.

### Rose (основной семантический «красный»)

| Токен | Hex | Применение |
|-------|-----|------------|
| `rose-50` | `#fff1f2` | Фон ошибок, долгов, count badge |
| `rose-100` | `#ffe4e6` | Границы, demo banner |
| `rose-200` | `#fecdd3` | Hover attendance «не был» |
| `rose-300` | `#fda4af` | Заголовок удаления (dev-console) |
| `rose-400` | `#fb7185` | Ошибки (dev-console) |
| `rose-500` | `#f43f5e` | — |
| `rose-600` | `#e11d48` | Destructive CTA, долги, attendance «не был» |
| `rose-700` | `#be123c` | Текст долгов, предупреждений |
| `rose-800` | `#9f1239` | — |
| `rose-900` | `#881337` | Hover delete (dev-console) |
| `rose-950` | `#4c0519` | Фон error badge (dev-console) |

### Прозрачные варианты rose

`rose-50/60` · `rose-200/80` · `rose-900/40` · `rose-900/50`

### Red (редко, в основном auth)

| Токен | Hex | Применение |
|-------|-----|------------|
| `red-50` | `#fef2f2` | Фон ошибки в auth-формах |
| `red-100` | `#fee2e2` | Граница ошибки auth |
| `red-300` | `#fca5a5` | Декор окна (лендинг preview) |
| `red-500` | `#ef4444` | Ошибка captcha |
| `red-600` | `#dc2626` | Текст ошибки auth, teacher pay rules |

### Прозрачные варианты red

`red-300/80`

---

## Жёлтые / янтарные (amber)

**Только пассивные предупреждения** — demo, лицензия, дубликаты. Не для кнопок в CRM.

| Токен | Hex | Применение |
|-------|-----|------------|
| `amber-50` | `#fffbeb` | Warning-баннеры, offline notice |
| `amber-100` | `#fef3c7` | Границы warning-блоков |
| `amber-200` | `#fde68a` | Границы offline / cancel rental |
| `amber-300` | `#fcd34d` | Чекбокс подтверждения удаления (dev-console) |
| `amber-400` | `#fbbf24` | Demo days, предупреждения (dev-console) |
| `amber-500` | `#f59e0b` | — |
| `amber-600` | `#d97706` | CTA emergency recovery (dev-console) |
| `amber-700` | `#b45309` | Текст предупреждений, бейдж demo |
| `amber-800` | `#92400e` | Текст offline notice |
| `amber-900` | `#78350f` | Фон demo badge (dev-console) |
| `amber-950` | `#451a03` | Фон warning (dev-console) |

### Прозрачные варианты amber

`amber-50/50` · `amber-50/60` · `amber-50/80` · `amber-100/80` · `amber-200/80` · `amber-300/80` · `amber-700/80` · `amber-700/90` · `amber-800/90` · `amber-900/40` · `amber-900/50` · `amber-950/40`

---

## Синие (blue)

Только в **dev-console** — бейдж подписки.

| Токен | Hex | Применение |
|-------|-----|------------|
| `blue-300` | `#93c5fd` | Текст бейджа Subscription |
| `blue-900` | `#1e3a8a` | Фон бейджа Subscription (`blue-900/50`) |

---

## Кастомные hex (вне Tailwind)

| Hex | Где | Назначение |
|-----|-----|------------|
| `#f8fafc` | `tangodb/src/index.css` | `body` background (= `slate-50`) |
| `#6366f1` | `tangodb/src/index.css`, `tangodb-landing/src/index.css` | `:focus-visible` outline (= `indigo-500`) |
| `#cbd5e1` | `tangodb/src/index.css` | Scrollbar thumb (= `slate-300`) |
| `#818cf8` | `tangodb/src/index.css` | Scrollbar thumb hover (= `indigo-400`) |
| `#334155` | `tangodb/index.html` | Fallback текст (= `slate-700`) |
| `#64748b` | `tangodb/index.html` | Fallback подпись (= `slate-500`) |
| `#229ED9` | CRM: Telegram-кнопки | Фон Telegram (`bg-[#229ED9]/10`, hover `/20`) |
| `#1C82B4` | CRM: Telegram-кнопки | Текст Telegram |

---

## Расписание — `scheduleColors.ts`

| Тип занятия | Фон | Граница | Tailwind |
|-------------|-----|---------|----------|
| Групповой урок | `#4f46e5` | `#4338ca` | `indigo-600` / `indigo-700` |
| Персональный | `#38bdf8` | `#0ea5e9` | `sky-400` / `sky-500` |
| Мероприятие | `#7c3aed` | `#6d28d9` | `violet-600` / `violet-700` |
| Аренда зала | `#475569` | `#334155` | `slate-600` / `slate-700` |

---

## По приложениям

| Приложение | Доминирующие палитры |
|------------|---------------------|
| `tangodb/` (CRM) | slate, indigo, rose, amber (баннеры), sky, violet (мероприятия) |
| `tangodb-dev-console/` | slate-950/900/800 (тёмная тема), indigo, rose, amber, emerald |
| `tangodb-landing/` | slate, indigo, sky, emerald (декор preview) |

---

## Правила (кратко)

1. **Акцент UI — только indigo.** Не добавлять violet/emerald/green/purple для кнопок (violet — исключение для мероприятий в сетке).
2. **Ошибки и долги — rose.**
3. **Amber — только пассивные warning-баннеры**, не кнопки.
4. **Telegram — `#229ED9` / `#1C82B4`**, единственное брендовое исключение.

---

*Сгенерировано по фактическому использованию в коде. Hex для Tailwind-токенов — палитра Tailwind CSS v4 по умолчанию.*
