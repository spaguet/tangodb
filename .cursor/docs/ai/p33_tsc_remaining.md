# P33 / L7 — оставшиеся ошибки `tsc`

**Дата:** 2026-08-20  
**Версия CRM:** 2.8.58  
**Команда:** `npx tsc --noEmit` в `tangodb/` (PowerShell: `cd tangodb; npx tsc --noEmit`)  
**Контекст:** после `createClient<Database>` (`src/types/database.ts`). Колонка `attendance.status` → `attendance_status` уже исправлена. Массовый `any` не добавлялся (шаг 4 промпта P33).

**Итого: 0 ошибок** (было 34; **P34** выполнен 2026-08-20; **P35** выполнен 2026-08-20; **P36** выполнен 2026-08-20; **P37** выполнен 2026-08-20; **P38** выполнен 2026-08-20). Опечаток имён RPC нет. `npm notice` в хвосте `npx` — не ошибки компилятора.

**Перепроверено 2026-08-20 (после P38):** `npx tsc --noEmit` в `tangodb/` — **0** ошибок. P33 follow-up закрыт.

Ключевые факты, сверенные с кодом (не путать с промптами P34–P38):

- TS2554 на `t("…")` — **не** каскад TS2589: module-level `t` в `src/lib/i18n/core.ts` требует `(locale, key, params?)`.
- Два `fetchAllPostgrestRows` — **внутри queryFn**, не union в одном callback; `select` ≠ table.
- `cancelled_at` есть только у `personal_lessons`, не у `personal_lessons_teacher_v`.
- `useSubscriptions.maskFinancial` = teacher **или** restricted reception admin; `usePersonalLessons.maskFinancial` = только `role === "teacher"`.
- `SettingsPatch` не переопределять; `update_rental_series` ≠ `seriesPayloadToRpc`.
- `upsert_renter` в CRM — `upsertPayload`; `check_renter_duplicates` — свой локальный payload.
- `disciplineIds` → колонка `discipline_id` (`length === 1 ? disciplineIds[0] : null`).

**Обозначения:** **п.N** — пункт полного списка ошибок (1–34); **PN** — промпт реализации (P34–P38). Например, п.34 — `SettingsProvider.tsx`, это **не** промпт P34.

## Сводка по кодам

| Код | Кол-во | Смысл |
|-----|--------|--------|
| TS2322 | 0 | ~~тип не assignable: `Record` → jsonb `Json` (P36)~~ |
| TS2345 | 0 | ~~`prices` Record insert/update (P37)~~ |
| TS2554 | 0 | ~~module `t()` без locale: ожидалось 2–3 аргумента, передали 1 (P38)~~ |
| TS2769 | 0 | ~~нет overload для `.from(table \| view)`~~ (P34) |
| TS2589 | 0 | ~~слишком глубокая инстанциация типа~~ (P34) |
| TS2352 | 0 | ~~небезопасный cast jsonb → `TeacherScope`~~ (P35) |

## Сводка по файлам

| Файл | Кол-во |
|------|--------|
| `src/hooks/usePersonalLessons.ts` | 0 |
| `src/hooks/useRenterCrm.ts` | 0 |
| `src/lib/scheduleLessonAccess.ts` | 0 |
| `src/hooks/usePrices.ts` | 0 |
| `src/hooks/useRentalSeries.ts` | 0 |
| `src/hooks/useSubscriptions.ts` | 0 |
| `src/hooks/useCompleteOrganizationOnboarding.ts` | 0 |
| `src/hooks/useRentalBillingProfile.ts` | 0 |
| `src/hooks/useRentalTariffs.ts` | 0 |
| `src/hooks/useRenters.ts` | 0 |
| `src/hooks/useTeacherPayRules.ts` | 0 |
| `src/hooks/useTeamInvites.ts` | 0 |
| `src/hooks/useVenueCosts.ts` | 0 |
| `src/lib/personalLessonClients.ts` | 0 |
| `src/lib/renterDocumentUpload.ts` | 0 |
| `src/settings/SettingsProvider.tsx` | 0 |
| **Итого** | **0** |

## Классы (как чинить)

1. **union table \| view в `.from()`** — два отдельных вызова `fetchAllPostgrestRows` **внутри queryFn**, не одна строка `"personal_lessons" | "personal_lessons_teacher_v"` и не `if` внутри одного callback (union возврата снова даст TS2589). То же для `subscriptions`. В `useSubscriptions` ветка `*_teacher_v` завязана на уже посчитанный `maskFinancial` (teacher **или** restricted reception admin), не на `role === "teacher"`. У `usePersonalLessons` колонки `select` идут от `maskFinancial`, не от имени таблицы. `.is("cancelled_at", null)` — только ветка base table (`personal_lessons`); у view колонки нет. Тогда уйдут TS2769, TS2589 и каскадные `.eq(..., never)`. **Промпт P34.**
2. **jsonb `Json` vs доменные интерфейсы** (`OrgModules`, `TeacherScope`, `MemberMeta`) — `asJson` / `as Json`, не `any`. Чтение scope — через `normalizeTeacherScope`. В `SettingsProvider` нельзя `{ ...patch, modules: asJson(...) }`: сначала вынуть `modules` из patch. **Промпт P35.**
3. **jsonb `Json` vs `Record<string, unknown>`** на RPC `p_payload` — хелперы/`asJson` у вызова, не `any`. У `update_rental_series` пейлоад — `input.payload`, не `seriesPayloadToRpc`. У `upsert_renter` в CRM — локальный `upsertPayload`; у `check_renter_duplicates` — отдельный локальный `payload`, не тот же хелпер. **Промпт P36.**
4. **`.update()` / `.insert()` таблицы `prices`** — `Database["public"]["Tables"]["prices"]["Update" | "Insert"]`, не `Record<string, unknown>`. Это не jsonb. В row идёт колонка `discipline_id` из массива `disciplineIds` (`length === 1 ? disciplineIds[0] : null`), не сам массив. **Промпт P37.**
5. **module `t(locale, key)` с одним аргументом** — `t("common.client")` и аналоги; сигнатуру `t()` в `core.ts` не менять. **Промпт P38.**

Промпты: раздел **«Промпты реализации»** ниже. Один блок = один запуск. Порядок **P34 → P38**.

---

## Полный список

### 1. `src/hooks/useCompleteOrganizationOnboarding.ts:26:9` — TS2322

```
Type 'OrgModules' is not assignable to type 'Json'.
  Type 'OrgModules' is not assignable to type '{ [key: string]: Json; }'.
    Index signature for type 'string' is missing in type 'OrgModules'.
```

### 2. `src/hooks/usePersonalLessons.ts:208:35` — TS2769

```
No overload matches this call.
  Overload 1 of 2, '(relation: ... Tables ...): PostgrestQueryBuilder<...>', gave the following error.
    Argument of type '"personal_lessons" | "personal_lessons_teacher_v"' is not assignable to parameter of type '<Tables>'.
      Type '"personal_lessons_teacher_v"' is not assignable to type '<Tables>'.
  Overload 2 of 2, '(relation: ... Views ...): PostgrestQueryBuilder<...>', gave the following error.
    Argument of type '"personal_lessons" | "personal_lessons_teacher_v"' is not assignable to parameter of type '<Views>'.
      Type '"personal_lessons"' is not assignable to type '<Views>'.
```

### 3. `src/hooks/usePersonalLessons.ts:227:28` — TS2345

```
Argument of type '"paid"' is not assignable to parameter of type 'never'.
```

Каскад от п.2 (`.eq` после сломанного `.from`).

### 4. `src/hooks/usePersonalLessons.ts:231:28` — TS2345

```
Argument of type '"location_id"' is not assignable to parameter of type 'never'.
```

Каскад от п.2.

### 5. `src/hooks/usePersonalLessons.ts:235:28` — TS2345

```
Argument of type '"teacher_member_id"' is not assignable to parameter of type 'never'.
```

Каскад от п.2.

### 6. `src/hooks/usePersonalLessons.ts:239:28` — TS2345

```
Argument of type '"discipline_id"' is not assignable to parameter of type 'never'.
```

Каскад от п.2.

### 7. `src/hooks/usePersonalLessons.ts:245:28` — TS2345

```
Argument of type '"attendance_status"' is not assignable to parameter of type 'never'.
```

Каскад от п.2. `.is("attendance_status", null)` на unmarked (стр. 243) в tsc сейчас не ругается — чинить всё равно корень (п.2), не отдельные `.eq`. То же для `.is("cancelled_at", null)` на ~211.

### 8. `src/hooks/usePersonalLessons.ts:530:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
  Type 'Record<string, unknown>' is missing the following properties from type 'Json[]': length, pop, push, concat, and 29 more.
```

### 9. `src/hooks/usePrices.ts:161:62` — TS2345

```
Argument of type 'Record<string, unknown>' is not assignable to parameter of type 'RejectExcessProperties<{ archived_at?: string; billing_model?: string; category?: string; ... }, Record<...>>'.
  Type 'Record<string, unknown>' is not assignable to type '{ [x: string]: never; }'.
    'string' index signatures are incompatible.
      Type 'unknown' is not assignable to type 'never'.
```

### 10. `src/hooks/usePrices.ts:396:17` — TS2345

```
Argument of type 'Record<string, unknown>' is not assignable to parameter of type 'RejectExcessProperties<{ archived_at?: string; billing_model?: string; category: string; ... }, { ...; }> | RejectExcessProperties<...>[]'.
  Type 'Record<string, unknown>' is missing the following properties from type 'RejectExcessProperties<...>[]': length, pop, push, concat, and 29 more.
```

### 11. `src/hooks/useRentalBillingProfile.ts:43:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
  Type 'Record<string, unknown>' is missing the following properties from type 'Json[]': length, pop, push, concat, and 29 more.
```

### 12. `src/hooks/useRentalSeries.ts:81:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 13. `src/hooks/useRentalSeries.ts:220:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 14. `src/hooks/useRentalTariffs.ts:137:76` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 15. `src/hooks/useRenterCrm.ts:356:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 16. `src/hooks/useRenterCrm.ts:382:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 17. `src/hooks/useRenterCrm.ts:466:77` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 18. `src/hooks/useRenterCrm.ts:552:78` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 19. `src/hooks/useRenterCrm.ts:743:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 20. `src/hooks/useRenterCrm.ts:788:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 21. `src/hooks/useRenters.ts:68:69` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 22. `src/hooks/useSubscriptions.ts:59:9` — TS2589

```
Type instantiation is excessively deep and possibly infinite.
```

Каскад от union `.from(table)` в том же queryFn (п.23): generic `fetchAllPostgrestRows` разворачивает union table|view. Не i18n и не «бесконечный» наш тип.

### 23. `src/hooks/useSubscriptions.ts:60:17` — TS2769

```
No overload matches this call.
  Overload 1 of 2 (Tables):
    Argument of type '"subscriptions" | "subscriptions_teacher_v"' is not assignable to Tables.
      Type '"subscriptions_teacher_v"' is not assignable to Tables.
  Overload 2 of 2 (Views):
    Argument of type '"subscriptions" | "subscriptions_teacher_v"' is not assignable to Views.
      Type '"subscriptions"' is not assignable to Views.
```

### 24. `src/hooks/useTeacherPayRules.ts:62:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 25. `src/hooks/useTeamInvites.ts:46:17` — TS2352

```
Conversion of type 'string | number | boolean | { [key: string]: Json; } | Json[]' to type 'TeacherScope' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type 'Json[]' is missing the following properties from type 'TeacherScope': discipline_ids, location_ids, schedule_group_ids, all_disciplines, and 3 more.
```

### 26. `src/hooks/useTeamInvites.ts:109:9` — TS2322

```
Type 'TeacherScope' is not assignable to type 'Json'.
  Type 'TeacherScope' is not assignable to type '{ [key: string]: Json; }'.
    Index signature for type 'string' is missing in type 'TeacherScope'.
```

### 27. `src/hooks/useTeamInvites.ts:110:9` — TS2322

```
Type 'MemberMeta' is not assignable to type 'Json'.
  Type 'MemberMeta' is not assignable to type '{ [key: string]: Json; }'.
    Index signature for type 'string' is missing in type 'MemberMeta'.
```

### 28. `src/hooks/useVenueCosts.ts:352:9` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 29. `src/lib/personalLessonClients.ts:24:32` — TS2554

```
Expected 2-3 arguments, but got 1.
```

Реальный вызов module `t` без locale (`t(locale, key, params?)` в `src/lib/i18n/core.ts`). Не каскад TS2589. В рантайме `"common.client"` уходит в аргумент locale, ключ — `undefined`.

### 30. `src/lib/renterDocumentUpload.ts:30:5` — TS2322

```
Type 'Record<string, unknown>' is not assignable to type 'Json'.
```

### 31. `src/lib/scheduleLessonAccess.ts:71:12` — TS2554

```
Expected 2-3 arguments, but got 1.
```

Реальный вызов module `t` без locale (`t("common.client")`). Не каскад TS2589.

### 32. `src/lib/scheduleLessonAccess.ts:75:12` — TS2554

```
Expected 2-3 arguments, but got 1.
```

Реальный вызов module `t` без locale (`t("schedule.lessonInfo.clientNotSpecified")`). Не каскад TS2589.

### 33. `src/lib/scheduleLessonAccess.ts:84:17` — TS2554

```
Expected 2-3 arguments, but got 1.
```

Реальный вызов module `t` без locale (`t("schedule.lessonInfo.clientNotSpecified")`). Не каскад TS2589.

### 34. `src/settings/SettingsProvider.tsx:64:17` — TS2345

```
Argument of type '{ updated_at: string; locale?: string; timezone?: string; admin_can_accept_payments?: boolean; ... }' is not assignable to parameter of type 'RejectExcessProperties<{ admin_can_accept_payments?: boolean; ... }, { ...; }>'.
  Types of property 'modules' are incompatible.
    Type 'OrgModules' is not assignable to type 'Json'.
      Type 'OrgModules' is not assignable to type '{ [key: string]: Json; }'.
        Index signature for type 'string' is missing in type 'OrgModules'.
```

---

## Промпты реализации (строго по порядку)

Готовые блоки для нового чата с агентом. Источник истины по ошибкам — полный список п.1–34 выше. Этот раздел не меняет смысл списка, только порядок работ.

### Как запускать

**п.N** — пункт списка ошибок (1–34); **PN** — промпт (P34–P38). п.34 (`SettingsProvider`) ≠ промпт P34 (union `.from`).

1. Новый чат / новый контекст на **один** промпт (P34, затем P35, …).
2. Скопировать целиком блок между ` ``` ` и ` ``` `.
3. Шаги внутри блока выполнять **сверху вниз**. Не перескакивать. Не чинить ошибки другого промпта, даже если они в том же файле.
4. Не начинать промпт N, пока N−1 не закрыт (DoD в конце блока).
5. Не объединять промпты «за один прогон, быстрее».

### Общие правила (все промпты)

- Сначала `.cursor/docs/ai/AI_CONTEXT.md`, затем файлы из блока «Прочитай сначала».
- Логика Supabase — только `tangodb/src/hooks/` и `tangodb/src/lib/`. RLS не трогать. `src/types/database.ts` не править руками и не перегенерировать.
- Не дублировать хуки и компоненты. Не поднимать PostgREST `max_rows`.
- **Запрещено:** `as any`, `as never`, `// @ts-expect-error`, `// @ts-ignore`, отключение `tsc`.
- Разрешено: `as Json`, хелпер `asJson`, `as unknown as DomainType` только на **чтении** jsonb → домен (после `unknown`).
- Не менять сигнатуру `t()` в `src/lib/i18n/core.ts`. Четыре TS2554 — реальные call sites без locale; их закрывает **P38**, не P34.
- После кода: бамп третьей цифры `APP_VERSION` (`tangodb/src/lib/appVersion.ts`) и `tangodb/package.json` на +1 от **текущего** значения; строка в `.cursor/docs/ai/changelog.md`.
- В конце прогона: `npx tsc --noEmit` в `tangodb/`. Ошибки из ещё не закрытых промптов — ок; **новых** кодов/файлов не добавлять. Число ошибок своего класса должно упасть.
- Если упираешься в ошибку другого промпта — остановись и напиши, какой её закрывает. Не чини сам.

### Порядок промптов

| # | Класс | Закрывает п. | Зависит от |
|---|--------|--------------|------------|
| **P34** ✅ | union `.from(table \| view)` | 2–7, 22–23 | — |
| **P35** ✅ | `Json` vs доменные интерфейсы | 1, 25–27, 34 (список) | P34 (организационно) |
| **P36** ✅ | `Json` vs `Record` на RPC jsonb | 8, 11–21, 24, 28, 30 | P35 |
| **P37** ✅ | typed insert/update `prices` | 9–10 | P36 (организационно) |
| **P38** ✅ | module `t()` без locale | 29, 31–33 | P37 (организационно) |

После P38: `npx tsc --noEmit` — **0 ошибок**.

---

#### P34 — union table \| view в `.from()` ✅ выполнен 2026-08-20 (2.8.54)

**Закрывает:** п.2–7 (`usePersonalLessons.ts`), п.22–23 (`useSubscriptions.ts`). п.29 / 31–33 (`t()` без locale) **не** уйдут — это P38.

```
Задача: P34 из .cursor/docs/ai/p33_tsc_remaining.md. Только union `.from(table | view)`. Не чинить jsonb/Json, OrgModules, TeacherScope, prices insert/update, i18n.

Предшественник: P33 (типы Database подключены). Если в обоих хуках `.from()` уже без union-строки — остановись и скажи.

Прочитай сначала:
- .cursor/docs/ai/p33_tsc_remaining.md (шапка, классы, п.2–7, 22–23)
- .cursor/docs/ai/lessons.md записи 2026-08-20 про Database / Json / union и про module `t()` без locale
- tangodb/src/hooks/usePersonalLessons.ts (queryFn usePersonalLessons, ~203–261: `useBaseTable` ~205, `table` ~206, `.from(table)` ~208; константы personalLessonsSelect / personalLessonsSelectTeacher ~135–139)
- tangodb/src/hooks/useSubscriptions.ts (queryFn useSubscriptions, ~45–70: maskFinancial ~48–50, `table` ~57, `.from(table)` ~60)
- tangodb/src/lib/postgrestRange.ts (fetchAllPostgrestRows)

Шаги:
1) useSubscriptions: не `const table = maskFinancial ? "subscriptions_teacher_v" : "subscriptions"` + `.from(table)` (сейчас table на ~57, .from на ~60). Два отдельных вызова `fetchAllPostgrestRows` **внутри queryFn** (if/ternary вокруг двух вызовов; не `if` внутри одного callback — union двух builder'ов снова даст TS2589): `supabase.from("subscriptions_teacher_v")` и `supabase.from("subscriptions")`. В каждой ветке одинаково: select "*", order activation_date desc, range. Других фильтров нет.
   Не пересчитывать условие ветки: оставить как есть `maskFinancial = role === "teacher" || isRestrictedReceptionAdmin(...)`. Не заменять на `role === "teacher"` — restricted reception admin тоже читает view.
2) usePersonalLessons: не `const table = ...` внутри callback (`useBaseTable` ~205, `table` ~206, `.from(table)` ~208). Тоже два отдельных `fetchAllPostgrestRows` **внутри queryFn**, не union table-имени и не хелпер, который принимает `"personal_lessons" | "personal_lessons_teacher_v"` или union builder.
   Выбор таблицы: `personal_lessons_teacher_v` только если `maskFinancial && resolved.excludeCancelled !== true`; иначе `personal_lessons`. `maskFinancial` здесь = `role === "teacher"` (так в файле, не трогать).
   selectColumns зависит от `maskFinancial`, не от таблицы: teacher + excludeCancelled читает **base table**, но колонки **teacher** (`personalLessonsSelectTeacher`, ~138). Не подставлять полный `personalLessonsSelect` (~135) только потому что таблица base.
   Общие фильтры в обеих ветках: dateRange/yearMonth, paid, location_id, teacher_member_id, discipline_id, attendance_status (unmarked→`.is` иначе `.eq`), client `.or`, order date, range.
   `.is("cancelled_at", null)` при `excludeCancelled` — **только** ветка `personal_lessons`. У `personal_lessons_teacher_v` колонки `cancelled_at` нет (Database.Views); копирование фильтра на view после split даст новую ошибку tsc. Сейчас `.is("cancelled_at")` на ~211 в списке tsc нет (как unmarked `.is` на ~243).
3) Не трогать mapPersonalLesson / mapSubscription, мутации, RPC.
4) Не трогать personalLessonClients.ts и scheduleLessonAccess.ts и вызовы t() — это P38.
5) npx tsc --noEmit в tangodb/. Должны исчезнуть TS2769/TS2589 на этих .from и TS2345 `.eq(..., never)` в usePersonalLessons. TS2554 на t() останется (P38). Оставшиеся — Json/Record/prices из P35–P37 плюс t() из P38. Новых ошибок на `.is("cancelled_at")` (view без колонки) быть не должно.
6) Бамп 2.8.y, changelog.

Не делать: as any, правки RLS, database.ts, i18n, jsonb-пейлоады.

DoD: .from() без union table|view; каскадные never ушли; tsc без TS2769/TS2589 и без TS2345 `.eq(..., never)` из этого класса; `.is("cancelled_at")` только на `personal_lessons`. Стоп.
```

---

#### P35 — Json vs доменные интерфейсы (OrgModules, TeacherScope, MemberMeta) ✅ выполнен 2026-08-20 (2.8.55)

**Закрывает:** п.1 (`useCompleteOrganizationOnboarding.ts`), п.25–27 (`useTeamInvites.ts`), п.34 списка (`SettingsProvider.tsx`; не промпт P34).

```
Задача: P35 из .cursor/docs/ai/p33_tsc_remaining.md. Только jsonb-аргументы с доменными интерфейсами. Не чинить Record-пейлоады аренды/арендаторов (это P36) и prices insert/update (P37). Union .from() не трогать (уже P34).

Предшественник: P34 закрыт. Если хелпер asJson уже есть и п.1/25–27/34 зелёные — остановись и скажи.

Прочитай сначала:
- .cursor/docs/ai/p33_tsc_remaining.md (класс 2, п.1, 25–27, 34)
- tangodb/src/types/database.ts — только тип Json (начало файла). Файл не редактировать.
- tangodb/src/types/organization.ts — OrgModules, TeacherScope, MemberMeta (интерфейсы не расширять index signature)
- tangodb/src/lib/teacherScope.ts — normalizeTeacherScope (уже есть)
- tangodb/src/hooks/useCompleteOrganizationOnboarding.ts (~20–28, p_modules)
- tangodb/src/hooks/useTeamInvites.ts (~40–50 select map; ~106–110 update_team_member p_scope/p_meta)
- tangodb/src/settings/SettingsProvider.tsx (~25–27 тип SettingsPatch; ~56–65 update, поле modules)

Шаги:
1) Добавь маленький хелпер, например tangodb/src/lib/json.ts:
   import type { Json } from "../types/database";
   export function asJson(value: unknown): Json { return value as Json; }
   Не any. Не класть хелпер в database.ts. Файла json.ts сейчас нет.
2) complete_organization_onboarding: p_modules: asJson(input.modules). Остальные поля RPC не менять (включая p_pair_cycle_enabled: false).
3) SettingsProvider: тип `SettingsPatch` уже `Partial<Omit<OrganizationSettings, "organization_id" | "updated_at">>` — **не переопределяй** его и не добавляй index signature в OrgModules. Нельзя `{ ...patch, modules: asJson(patch.modules) }`: `modules` уйдёт в `.update` даже если его не было в patch, а spread `SettingsPatch` оставляет `modules?: OrgModules` для RejectExcessProperties. Деструктурируй `const { modules, ...rest } = patch`, в `.update` клади `{ ...rest, ...(modules !== undefined ? { modules: asJson(modules) } : {}), updated_at }`. Не приводить весь patch к any.
4) useTeamInvites queryFn: сейчас `scope: (row.scope as TeacherScope) ?? EMPTY_TEACHER_SCOPE` (~46). Замени на `normalizeTeacherScope(row.scope)` (импорт из teacherScope.ts). tsc ругает только scope (п.25); `meta: (row.meta as MemberMeta) ?? {}` в списке нет, но это тот же jsonb — если raw объект и не массив, `as unknown as MemberMeta`, иначе `{}`. Импорт `EMPTY_TEACHER_SCOPE` из permissions.ts после замены скорее всего не нужен — убери, если не используется. Не склеивай два EMPTY_TEACHER_SCOPE (есть и в permissions.ts, и в types/organization.ts).
5) update_team_member: в Database `p_scope?` / `p_meta?` это Json (null входит в Json). Пиши p_scope: params.scope == null ? null : asJson(params.scope); p_meta: params.meta == null ? null : asJson(params.meta).
6) Не менять форму TeacherScope / OrgModules / MemberMeta (не добавлять `[key: string]: ...`).
7) npx tsc --noEmit. П.1, 25–27, 34 должны уйти. Оставшиеся — Record jsonb (P36), prices (P37), t() без locale (P38).
8) Бамп 2.8.y, changelog. Если полезно — одна строка в lessons.md: чтение jsonb scope через normalizeTeacherScope, запись через asJson.

Не делать: as any, RLS, database.ts, аренда/prices, правки i18n.

DoD: OrgModules/TeacherScope/MemberMeta проходят в Json без any; чтение scope через normalizeTeacherScope. Стоп.
```

---

#### P36 — Json vs Record на RPC `p_payload` ✅ выполнен 2026-08-20 (2.8.56)

**Закрывает:** п.8 (`usePersonalLessons.ts` ~530), п.11 (`useRentalBillingProfile.ts`), п.12–13 (`useRentalSeries.ts`), п.14 (`useRentalTariffs.ts`), п.15–20 (`useRenterCrm.ts`), п.21 (`useRenters.ts`), п.24 (`useTeacherPayRules.ts`), п.28 (`useVenueCosts.ts`), п.30 (`renterDocumentUpload.ts`).

```
Задача: P36 из .cursor/docs/ai/p33_tsc_remaining.md. Только RPC-аргументы типа Json (обычно p_payload), куда сейчас уходит Record<string, unknown>. Не трогать prices .insert/.update (P37). Не трогать union .from() и OrgModules/TeacherScope (P34/P35).

Предшественник: P35 закрыт, asJson уже в tangodb/src/lib/json.ts. Если файла нет — сначала P35, не изобретай второй хелпер.

Прочитай сначала:
- .cursor/docs/ai/p33_tsc_remaining.md (класс 3, п.8, 11–21, 24, 28, 30)
- tangodb/src/lib/json.ts (asJson)
- Места вызова (приводить к Json у RPC или сменить return type хелпера на Json):
  - usePersonalLessons.ts — rpc update_personal_lesson, локальный `const payload: Record<string, unknown>` (~505), p_payload (~530) — asJson на вызове, тип переменной не менять
  - useRentalBillingProfile.ts — update_rental_billing_profile, p_payload: rentalBillingProfileToPayload (~43)
  - src/lib/rentalBillingProfile.ts — rentalBillingProfileToPayload (~149), сейчас возвращает Record
  - useRentalSeries.ts — локальный `seriesPayloadToRpc` (~48), три разных вызова RPC, не один хелпер на все:
      preview (~81): `p_payload: seriesPayloadToRpc(...)` — в списке tsc; RPC `preview_rental_series`
      create (~128): `p_payload: { ...seriesPayloadToRpc(input), idempotency_key }` — RPC `create_rental_series`, Args тоже `p_payload: Json`, но tsc сейчас не ругает (spread в новый литерал). Хелпер `seriesPayloadToRpc` всё равно переведи на Json через asJson внутри, не пропускай create
      update (~220): `p_payload: input.payload`, где `payload: Record<string, unknown>` — RPC `update_rental_series`, в списке tsc, это **не** `seriesPayloadToRpc`. Фикс: `p_payload: asJson(input.payload)`. Публичный тип input не обязательно менять.
  - useRentalTariffs.ts — upsert_rental_tariff, локальный payload Record (~121–135), rpc (~137) — asJson на вызове
  - useRenterCrm.ts — шесть RPC, все `p_payload: Json`:
      check_renter_duplicates (~355–357): свой локальный `payload` Record (~349–353), **не** `upsertPayload` — asJson на вызове
      upsert_renter (~382) через локальный `upsertPayload` (~172, return Record) — предпочтительно asJson внутри upsertPayload / return Json
      upsert_renter_contact (~466), upsert_renter_contract (~552), create_renter_communication (~743) — локальный payload Record, asJson на вызове
      update_renter_communication (~786–789): ещё p_comm_id / p_reason, в Json уходит только p_payload
  - useRenters.ts — upsert_renter, локальный payload (~57–66), вызов (~68)
  - useTeacherPayRules.ts — save_teacher_pay_rule p_payload: teacherPayRuleToPayload (~62) + src/lib/teacherPayRules.ts (~59)
  - useVenueCosts.ts — save_venue_cost_rule_draft p_payload: venueCostDraftToPayload (~352) + src/lib/venueCostRules.ts (~487)
  - src/lib/renterDocumentUpload.ts — finalize_renter_document_upload, аргумент функции `payload: Record<string, unknown>` (~27), p_payload (~30) — asJson на вызове, сигнатуру функции не обязательно менять

Шаги:
1) Паттерн: либо хелпер `toPayload` возвращает Json (`asJson(...)` один раз вокруг готового объекта внутри хелпера), либо на вызове rpc `p_payload: asJson(payload)`. Предпочти хелпер, если Record собирается в одном месте и уходит в jsonb (`rentalBillingProfileToPayload`, `seriesPayloadToRpc`, `upsertPayload`, `teacherPayRuleToPayload`, `venueCostDraftToPayload`). Не меняй только return type на Json без asJson: вложенные литералы без index signature сами в Json не проходят. Для локальных `const payload: Record<string, unknown>` не меняй тип переменной (присваивания в Json-union ломаются) — `p_payload: asJson(payload)` на вызове rpc.
2) Не менять ключи/значения пейлоадов, имена RPC, бизнес-логику, RLS.
3) Не использовать as any. Не кастовать весь supabase.
4) npx tsc --noEmit. П.8, 11–21, 24, 28, 30 должны уйти. Остаётся P37 (usePrices TS2345 Record → prices Update/Insert) и P38 (t() без locale), если ещё не зелёные.
5) Бамп 2.8.y, changelog.

Не делать: правки цен (P37), SettingsProvider/onboarding/invites, database.ts, i18n.

DoD: все перечисленные p_payload имеют тип Json; tsc без этих TS2322. Стоп.
```

---

#### P37 — typed insert/update `prices` ✅ выполнен 2026-08-20 (2.8.57)

**Закрывает:** п.9–10 (`usePrices.ts` ~161 и ~396). После этого остаются только TS2554 из P38.

```
Задача: P37 из .cursor/docs/ai/p33_tsc_remaining.md. Только supabase.from("prices").update / .insert, где payload: Record<string, unknown>. Не jsonb. Не трогать остальные хуки и i18n.

Предшественник: P36 закрыт. Если п.9–10 уже зелёные — остановись, прогони полный tsc, скажи итог (ожидай TS2554 из P38).

Прочитай сначала:
- .cursor/docs/ai/p33_tsc_remaining.md (класс 4, п.9–10)
- tangodb/src/hooks/usePrices.ts — useUpdatePriceMeta (~130–162), useCreatePrice insert (~344–398)
- tangodb/src/types/database.ts — Tables.prices.Insert и Tables.prices.Update (искать prices, не редактировать файл)

Шаги:
1) Тип пейлоада: Database["public"]["Tables"]["prices"]["Update"] для update, ["Insert"] для insert. Импорт Database из types/database.ts (или Tables, если так принято в файле).
2) Собрать объект как Update/Insert, не Record<string, unknown>. Поля и те же if, что сейчас:
   - Update (useUpdatePriceMeta): всегда label, description; `if (durationMinutes !== undefined)` → duration_minutes (может быть null); `if (locationId !== undefined)` → location_id; `if (disciplineIds !== undefined)` → **колонка `discipline_id`**, не массив: `disciplineIds.length === 1 ? disciplineIds[0] : null`. Не класть disciplineIds/teacherMemberIds в row prices — junction по-прежнему через sync* после update.
   - Insert (useCreatePrice): organization_id, type, lessons, price, label, description, category, location_id, billing_model; discipline_id тем же правилом `disciplineIds?.length === 1 ? disciplineIds[0] : null`; duration_minutes только если `durationMinutes != null && durationMinutes > 0`. Не добавлять freeze_*/status — их нет в текущем insertPayload.
3) Не менять syncPriceDisciplines / syncPriceTeacherMembers / rollback deleteCreatedPrice / RPC list_archived_prices.
4) npx tsc --noEmit в tangodb/. Цель: 0 ошибок кроме TS2554 п.29/31–33 (P38). Если всплыло что-то вне п.1–34 — опиши, не засыпай any.
5) Бамп 2.8.y, changelog. Строка в lessons.md: после createClient<Database> insert/update таблиц — Tables.Insert/Update, не Record<string, unknown>; jsonb — asJson, не any.

Не делать: RLS, database.ts руками, массовый рефакторинг цен, любые as any, правки t().

DoD: tsc без ошибок P34–P37. Остаются только TS2554 из P38. Стоп.
```

---

#### P38 — module `t()` без locale ✅ выполнен 2026-08-20 (2.8.58)

**Закрывает:** п.29 (`personalLessonClients.ts`), п.31–33 (`scheduleLessonAccess.ts`). После этого `tsc` должен быть чистым.

```
Задача: P38 из .cursor/docs/ai/p33_tsc_remaining.md. Последний промпт. Только вызовы module-level t() с одним аргументом. Не jsonb, не prices, не union .from().

Предшественник: P37 закрыт. Если п.29/31–33 уже зелёные — прогони полный tsc, скажи итог.

Прочитай сначала:
- .cursor/docs/ai/p33_tsc_remaining.md (класс 5, п.29, 31–33)
- tangodb/src/lib/i18n/core.ts — сигнатура `t(locale: string | null | undefined, key, params?)` (~46–50) (файл не менять)
- tangodb/src/lib/personalLessonClients.ts (~24)
- tangodb/src/lib/scheduleLessonAccess.ts — maskClientDisplay (~66–78) и внутренняя (не экспортирована) isSpecifiedClientDisplay (~80–85)
- tangodb/src/lib/resolveMutationError.ts — resolveMutationErrorWithLocale как образец t(locale, key)

Шаги:
1) Не менять сигнатуру t() в core.ts и не добавлять одноаргументный overload.
2) В четырёх call sites передать locale первым аргументом. Импорт `t` из `./i18n` (реэкспорт core) можно не менять. Минимальный фикс: t(null, "common.client") и t(null, "schedule.lessonInfo.clientNotSpecified") — resolveLocale(null) даёт ru-RU. Ключи уже есть в keys.ts; словари не трогать.
3) Не расширять blast radius: не менять сигнатуру maskClientDisplay / personalLessonClientEntries, не экспортировать isSpecifiedClientDisplay, не трогать callers, если хватает t(null, key).
4) npx tsc --noEmit в tangodb/ — цель 0 ошибок. Если всплыло что-то вне п.1–34 — опиши, не засыпай any.
5) Бамп 2.8.y, changelog. Если в lessons.md ещё нет записи 2026-08-20 про module t() без locale — добавь: module t() всегда (locale, key); одноаргументный t("key") — это TS2554 и сломанный рантайм (строка ключа уходит в locale), не каскад TS2589.

Не делать: правки i18n-словарей, RLS, database.ts, jsonb/prices, любые as any.

DoD: tsc --noEmit без ошибок. P33 follow-up закрыт. Стоп.
```

