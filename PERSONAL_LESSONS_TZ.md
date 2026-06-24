# ТЗ: раздел «Персональные уроки»

Дата: 2026-06-24  
Обновлено: 2026-06-24 (Этап 0 выполнен — решения зафиксированы в decision_log PL-0)  
Статус: Этап 0 ✅ · Этапы 1–6 — в работе

## 1. Цель

Реализовать отдельный раздел «Персональные уроки», который отделяет операционную работу с индивидуальными занятиями от недельной сетки «Расписание», но использует те же источники данных, права, тарифы и платежные механики.

Раздел должен закрывать три рабочих сценария:

1. Просмотр всех персональных уроков по выбранной локации, дисциплине, преподавателю, клиенту, периоду и статусу оплаты/посещения.
2. Продажа одного или нескольких персональных уроков.
3. Продажа пакета персональных уроков и дальнейшее списание уроков из пакета.

## 2. Текущее состояние проекта

### 2.1. Что уже есть

В проекте уже существует рабочий контур персональных уроков:

- таблица `personal_lessons`;
- хук `tangodb/src/hooks/usePersonalLessons.ts`;
- форма записи `tangodb/src/components/schedule/AddPersonalLessonForm.tsx`;
- popup оплаты `tangodb/src/components/schedule/PayPersonalLessonModal.tsx`;
- модалка продажи пакета `tangodb/src/components/ui/SellPackageModal.tsx`;
- отображение персональных уроков внутри недельного расписания через `useScheduleForWeek()`;
- RLS-политики для owner/director/admin и scoped teacher;
- быстрый popup создания клиента через `ClientAutocomplete` + `AddClientModal`;
- устаревший раздел `PersonalLessonsPanel`, который сейчас помечен как deprecated (`tangodb/src/components/PersonalLessonsPanel.tsx`);
- устаревший `PersonalPage` (`tangodb/src/pages/PersonalPage.tsx`) — не в роутере;
- legacy routes `/personal`, `/personal/sell`, `/personal/book`, которые сейчас редиректят в `/schedule`.

Форма из popup «Персональный урок · Новая запись» уже умеет:

- выбирать клиента через autocomplete;
- быстро добавить нового клиента;
- добавить до 3 клиентов;
- выбрать дисциплину;
- выбрать преподавателя;
- использовать локацию из ячейки расписания;
- выбрать тариф за урок;
- вручную изменить стоимость;
- оформить урок с оплатой;
- оформить урок без оплаты;
- списать урок с персонального пакета;
- открыть продажу пакета;
- проверять пересечения с расписанием.

### 2.2. Что осталось от старого раздела

Старый `PersonalLessonsPanel` всё ещё есть в коде и содержит полезные части:

- вкладки просмотра и продажи;
- фильтр по месяцу;
- список персональных уроков;
- продажу урока на несколько дат;
- редактирование даты/времени;
- удаление будущих уроков;
- оплату/отмену оплаты;
- продажу пакета через `SellPackageModal`.

Но этот компонент нельзя возвращать без переработки:

- он помечен deprecated;
- маршруты `/personal*` уже намеренно заменены на `/schedule`;
- старая форма не требует `location_id` и `teacher_member_id`, а новая модель уже завязана на локацию и преподавателя;
- старая форма слабее интегрирована с новой недельной сеткой и текущими конфликтами расписания;
- нет поддержки 4 клиентов;
- нет статуса `excused` для персональных уроков;
- нет полноценного фильтра по локации/дисциплине/преподавателю;
- нет канонической модели повторений.

### 2.3. Результаты аудита кода (2026-06-24)

Подтверждено по репозиторию:

| Утверждение ТЗ | Факт в коде |
|----------------|-------------|
| До 3 клиентов в форме расписания | `AddPersonalLessonForm`: `bookingClients.length < 3` |
| Legacy `/personal*` → `/schedule` | `App.tsx`: `Navigate to="/schedule"` |
| Прямой `delete()` урока | `useDeletePersonalLesson()` без RPC и без проверки даты |
| Teacher без суммы | `usePersonalLessons`: view `personal_lessons_teacher_v`, `price = 0`; `paid` виден (миграция `20260711000001`) |
| Фильтры списка | `UsePersonalLessonsOptions`: только `yearMonth`, `dateRange`, `paidFilter` |
| Редактирование в расписании | `EditLessonPopup` + `useUpdatePersonalLesson`; прошлые даты блокирует `isPastDate()` (`date < today`) |
| Удаление в расписании | `LessonInfoPopup` → `useDeletePersonalLesson`; сегодняшний день **можно** удалить (нет guard на backend) |
| `useAddPersonalLessons` invalidation | Только `personalLessonsQueryKey` (не `schedule` / `subscriptions`) |
| `useUpdatePersonalLesson` invalidation | `personalLessons` + `schedule` |
| `personalFilter` в Zustand | Объявлен, не используется |

**Критический дефект (блокирует корректную работу пакетных уроков):**

1. `mark_personal_lesson_attendance` (v2) **отклоняет** уроки с `subscription_id` (`«Используйте отметку через абонемент»`).
2. Актуальный `mark_attendance` (миграция `20260715000001`) **требует** `p_schedule_group_id` и проверку `subscription_groups` — путь групповых абонементов.
3. `AttendancePanel` для урока с пакетом показывает абонемент, но `handleMark()` требует `scheduleGroupId` → отметка **не работает** для персонального пакета.
4. Триггер `validate_personal_lesson_subscription` при создании проверяет `lessons_left > 0`, но **не списывает** остаток.

Итог: разовые уроки (`subscription_id IS NULL`) отмечаются через `mark_personal_lesson_attendance`; уроки с пакетом сейчас **нельзя корректно отметить** — это нужно исправить в рамках Этапа 1, до UI раздела.

**Детали бага AttendancePanel (personal + пакет):**

- `isPersonalOneOffView` = `kind === "personal" && !subscriptionId` → урок с пакетом попадает в ветку списка абонементов (`modalSubs` по `subscriptionIds: [subscriptionId]`).
- `renderAttendanceRow(..., showExtendedMarks)` получает `showExtendedMarks = (kind === "group")` → для personal+пакет **нет** кнопки «Уважительный пропуск» даже после починки RPC.
- Кнопки «Пришёл»/«Не пришёл» в этой ветке вызывают `handleMark()` → требуют `scheduleGroupId` → toast «Не удалось определить групповой урок».

### 2.4. Дополнительные находки аудита v2

| Тема | Факт в коде | Действие в ТЗ |
|------|-------------|---------------|
| `useAddPersonalLessons` invalidation | `onSuccess` — только `personalLessonsQueryKey` (не `schedule`, не `subscriptions`) | Расширить на Этапе 2 (§6.2) |
| `useMarkPersonalLessonAttendance` invalidation | Только `personalLessonsQueryKey`; при списании пакета `subscriptions` не обновляются | Добавить invalidation `subscriptions` |
| `useUpdatePersonalLesson` / delete guard | Прямой `.update()` / `.delete()`; дата на backend **не** проверяется | RPC или trigger (§3.10) |
| `buildQueryKeySuffix` | Ключ кэша — только `yearMonth` / `dateRange` / `paidFilter` | При новых фильтрах расширить ключ (§6.2) |
| Индексы БД | Есть `org_date`, `org_teacher`, `client_id1`; **нет** `discipline_id` | Фильтр по дисциплине через `.eq()`; при нагрузке — опциональный индекс |
| Teacher view | `personal_lessons_teacher_v` без fallback на полную таблицу | Сохранить; не добавлять fallback |
| `OrgModules` | `organization_settings.modules`: `personal_lessons`, `trio_lessons`, `pair_subscriptions` — **уже есть** (`types/organization.ts`, `lib/orgModules.ts`) | Пункт меню `/personal` скрывать при `!modules.personal_lessons` |
| `quad_lessons` module flag | **Нет** в `OrgModules` | Отдельный флаг — после `tangodb_modular_dance_crm_TZ.md`; MVP quad без gating |
| Zustand `personalFilter` | Объявлен в `store/ui.ts`, **нигде не читается** | Удалить вместе с deprecated panel (§6.0) |
| Zustand `personalTab` | Используется только `PersonalLessonsPanel` | Переиспользовать для вкладок нового раздела или удалить |
| `DashboardPage` | `personalView: { path: "/schedule" }` | Обновить на `/personal` (§6.3) |
| `SCHEDULE_TZ.md` | Промпт 7: redirect `/personal` → `/schedule` (**выполнено**) | Осознанный откат; обновить SCHEDULE_TZ на Этапе 6 (§3.9) |
| Должники | `ScheduleDebtorsBlock` + `useScheduleDebtors` на `/schedule` | Не дублировать блок; в `/personal` — фильтр «Долг» через тот же hook/данные (§3.11) |
| `EditLessonPopup` | Требует `scheduleSlots[]`, `personalLessons[]` для conflict-check | Из `/personal` передавать `useSchedule()` + `usePersonalLessons({ dateRange })` вокруг даты урока |

## 3. Несостыковки и ограничения

### 3.1. Максимум клиентов: требование 4, схема поддерживает 3

Текущее состояние:

- `personal_lessons.type` ограничен значениями `solo`, `pair`, `trio`;
- в таблице есть только `client_id1`, `client_id2`, `client_id3`;
- `Subscription` и персональные пакеты также поддерживают до 3 клиентов;
- тарифы знают `personal_pair` и `personal_trio`, но нет типа на 4 клиента.

Требование:

- персональный урок может быть оформлен на 1, 2, 3 или 4 клиентов.

Вывод:

- без изменения БД и типов нельзя корректно реализовать 4 клиента;
- нужно добавить четвертый формат, например `quad`, `client_id4`, тариф `personal_quad`, поддержку пакетов на 4 клиентов и module flag, если формат должен включаться отдельно.

### 3.2. «Уважительный пропуск» есть для групповой attendance, но не для `personal_lessons`

Текущее состояние:

- таблица `attendance` уже поддерживает `excused`;
- `personal_lessons.attendance_status` поддерживает только `present` и `absent`;
- `useMarkPersonalLessonAttendance()` принимает только `present | absent`;
- RPC `mark_personal_lesson_attendance` не принимает `excused`.

Требование:

- для персонального урока нужны статусы: пришёл, не пришёл, уважительный пропуск.

Вывод:

- нужна миграция constraints и обновление RPC/типов/UI;
- нужно отдельно решить, как `excused` влияет на пакет: не списывает урок или возвращает списание, если оно уже было сделано.

### 3.3. Повторения пока не являются сущностью

Текущее состояние:

- `useAddPersonalLessons()` принимает массив `dates`;
- старая панель позволяла вручную указать несколько дат;
- новая popup-форма из расписания создаёт только одну дату;
- нет серии/группы повторений, правила weekly recurrence или способа редактировать серию.

Требование:

- урок может повторяться еженедельно;
- в одной форме пользователь может оформить несколько разных дней/времён недели, которые повторяются еженедельно.

Вывод:

- для MVP можно генерировать набор отдельных `personal_lessons` на выбранный период без отдельной таблицы серии;
- для production-качества лучше добавить `personal_lesson_series` и `series_id`, иначе нельзя удобно отменять/редактировать серию и понимать происхождение повторов.

### 3.4. Прошедшие персональные уроки можно просмотреть, но не удалять

Текущее состояние:

- `useDeletePersonalLesson()` — hard delete без проверки даты;
- `PersonalLessonsPanel`: delete только для `date >= today` (включая сегодня);
- `scheduleLessonAccess.canWritePersonalLesson`: edit/delete блокируется для `date < today` (`isPastDate`), **сегодня разрешено**;
- на уровне БД delete не ограничен.

Целевое правило (MVP):

- удалять и редактировать можно только **`date > today`**;
- UI + RPC `delete_personal_lesson` + guard в `useUpdatePersonalLesson` / `canWritePersonalLesson` (явная проверка `date <= today`, **вариант A** — глобальный `isPastDate` не менять; см. §5.3, PL-0).

### 3.5. Списание с пакета: две модели посещаемости (исправить, не дублировать)

Текущее состояние (фактическое):

| Тип урока | Где отмечается | Списание `lessons_left` |
|-----------|----------------|-------------------------|
| Разовый (`subscription_id IS NULL`) | `mark_personal_lesson_attendance` → `personal_lessons.attendance_status` | Нет (разовая оплата / долг) |
| С пакетом (`subscription_id NOT NULL`) | **Сломано** — RPC блокирует или требует группу | **Не происходит** |

При создании урока с пакетом:

- `personal_lessons.subscription_id` заполняется сразу;
- `price = 0`, `paid = yes`;
- триггер `validate_personal_lesson_subscription` проверяет активность пакета и совпадение клиентов;
- остаток пакета **не уменьшается** при insert.

**Не использовать** таблицу `attendance` для персональных пакетных уроков:

- после миграции групп `mark_attendance` завязан на `schedule_group_id`;
- у private-пакета нет группы;
- ключ `(date, subscription_id)` не однозначен при нескольких персональных уроках в один день.

Целевая модель (единый RPC, без второго контура):

- расширить **`mark_personal_lesson_attendance(p_lesson_id, p_new_status)`** для **всех** персональных уроков;
- убрать блок `subscription_id IS NOT NULL`;
- если `subscription_id` задан — списывать/возвращать `lessons_left` по правилам §8;
- всегда писать `personal_lessons.attendance_status` (источник истины для UI раздела);
- `AttendancePanel` для урока с пакетом должен вызывать **тот же** RPC/hook, а не `handleMark` + `mark_attendance`.

UI-формулировки:

- «Оплачено пакетом» = урок привязан к абонементу;
- «Списано с пакета» = отмечено `present` / `absent` (остаток изменён);
- `excused` = урок не списывается.

Риск перебронирования (см. §3.8): при создании нескольких будущих уроков на один пакет триггер проверяет `lessons_left > 0` на момент insert, но не резервирует место — до внедрения reservation это принимаемое ограничение MVP.

### 3.6. Локация и преподаватель обязательны для нового раздела

Текущее состояние:

- в popup из расписания локация берётся из свободной ячейки;
- старая панель продажи не требовала локацию и преподавателя;
- `useAddPersonalLessons()` уже умеет `requireScope`, `locationId`, `teacherMemberId`.

Вывод:

- новый раздел не должен использовать старую форму без доработки;
- форма продажи в разделе должна иметь явный выбор локации, преподавателя и дисциплины до выбора дат/времени.

### 3.7. Навигация уже намеренно убрала `/personal`

Текущее состояние:

- `/personal`, `/personal/sell`, `/personal/book` редиректят на `/schedule` (sell/book → `?action=sell`);
- `?action=sell` в `SchedulePageContainer` открывает только `SellPackageModal`, не форму урока;
- `permissions.ts`: panel ids `personal` / `personal_sell` сохранены; `PANEL_FALLBACK_PATHS` указывает на `/schedule`;
- `architecture.md` фиксирует `PersonalLessonsPanel` как deprecated;
- `PersonalPage.tsx` и `PersonalLessonsPanel.tsx` **не подключены** к роутеру — мёртвый код (~1200 строк).

Вывод:

- возврат раздела — осознанное архитектурное решение;
- после миграции **удалить** deprecated-файлы, не оставлять параллельно с новым разделом;
- обновить `architecture.md`, `decision_log.md`, `permissions.ts` (`PANEL_FALLBACK_PATHS`, навигация).

Решение (зафиксировано для MVP):

- канонический route **`/personal`** (не `/personal-lessons`);
- **`/personal/sell`** — вкладка продажи;
- **`/personal/book`** — permanent redirect на `/personal/sell` (обратная совместимость);
- **`/schedule?action=sell`** — только быстрая продажа пакета из расписания (без дублирования всей вкладки «Продажа»).

### 3.8. Перебронирование пакета при нескольких будущих уроках

Триггер `validate_personal_lesson_subscription` проверяет `lessons_left > 0` в момент INSERT, но не уменьшает остаток и не учитывает уже созданные, но не отмеченные уроки на тот же пакет.

Пример: в пакете 3 урока → можно создать 5 будущих записей, пока `lessons_left` не изменился.

Для MVP:

- принять ограничение и показывать в UI предупреждение, если число будущих уроков с `subscription_id` превышает `lessons_left`;
- полноценный reservation — отдельный этап (не блокирует MVP раздела).

### 3.9. Конфликт с `SCHEDULE_TZ.md` (намеренный откат)

`SCHEDULE_TZ.md` (Промпт 7, выполнен) зафиксировал:

- redirect `/personal*` → `/schedule`;
- deprecated `PersonalLessonsPanel` / `PersonalPage`;
- `DashboardPage.personalView` → `/schedule`;
- `PANEL_FALLBACK_PATHS.personal` → `/schedule`.

Это ТЗ **возвращает** отдельный раздел `/personal` без удаления недельной сетки `/schedule`. Разделение обязанностей:

| Маршрут | Назначение |
|---------|------------|
| `/schedule` | Недельная сетка, CRUD из ячеек, `ScheduleDebtorsBlock`, `?action=sell` → только `SellPackageModal` |
| `/personal` | Список + фильтры + вкладка продажи (standalone) |
| `/attendance` | Журнал дня; после починки RPC — отметка personal (разовые и пакетные) |

**Не ломать расписание:** не переносить сетку в `/personal`, не дублировать `useScheduleForWeek` в новом разделе.

После реализации обновить `SCHEDULE_TZ.md` §Промпт 7 и таблицу маршрутов — указать, что `/personal` снова каноничен для списка/продажи.

### 3.10. Guard редактирования: только UI недостаточно

Сейчас `useUpdatePersonalLesson()` и `useDeletePersonalLesson()` — прямой PostgREST `.update()` / `.delete()` без проверки даты на backend.

Целевое правило «редактировать/удалять только `date > today`» должно соблюдаться на **трёх** уровнях:

1. UI — `canWritePersonalLesson` с явной проверкой `lesson.date <= today` (вариант A из §5.3, **не** менять глобальный `isPastDate`).
2. Hook — отклонять мутацию до запроса, если дата не проходит guard.
3. Backend — RPC `delete_personal_lesson` (§5.3) + **`update_personal_lesson`** или `BEFORE UPDATE` trigger с тем же правилом `date > current_date`.

Без пункта 3 teacher/admin с прямым API или старый клиент смогут менять прошедшие уроки в обход UI.

Рекомендуемая сигнатура update-RPC (минимальный набор полей, как в `useUpdatePersonalLesson`):

```sql
update_personal_lesson(p_lesson_id uuid, p_payload jsonb)
```

Проверки: org, role, teacher scope, **`date > current_date`** (и новая дата, если меняется), overlap-триггеры остаются на таблице.

### 3.11. Должники и пересечение с `/schedule`

На `/schedule` уже есть `ScheduleDebtorsBlock` (`useScheduleDebtors` → `usePersonalLessons({ paidFilter: "no" })` с окном дат).

В `/personal` фильтр «Долг» (`paidFilter: "no"`) решает ту же задачу для **полного списка**, а не только недели.

**Не создавать** третий hook или компонент списка должников. Переиспользовать:

- `usePersonalLessons({ paidFilter: "no", dateRange, ...filters })` на вкладке списка;
- `PayPersonalLessonModal` для оплаты из строки;
- при необходимости ссылку «Открыть в расписании» на `/schedule` с неделей урока (deep link опционален).

### 3.12. Редактирование из `/personal` и `EditLessonPopup`

`EditLessonPopup` не привязан к сетке, но **зависит** от массивов `scheduleSlots` и `personalLessons` для `findBookingScheduleConflict` / overlap.

При открытии edit из `/personal`:

- загрузить `useSchedule()` (или срез по `dayOfWeek` урока);
- загрузить `usePersonalLessons({ dateRange: weekAround(lesson.date) })`;
- передать те же props, что `SchedulePageContainer` — **не** форкать edit-форму.

Если урок `date <= today` — popup read-only или не открывать (согласно §5.3).

## 4. Целевая структура раздела

### 4.1. Название и маршрут

Рекомендуемый маршрут:

- `/personal` — раздел «Персональные уроки»;
- `/personal/sell` — вкладка «Продажа».

> **Не в MVP:** отдельный маршрут `/personal/history` — история и будущие уроки в **одном** списке с фильтром периода (§9 Этап 0).

Рекомендуемые вкладки:

1. `Персональные уроки` — единый список с фильтром периода (будущие + прошедшие);
2. `Продажа`.

> **Решение зафиксировано (§9 Этап 0):** вкладка «История» — **не создаётся**. Один список с фильтром периода. Разделение на две вкладки (будущие / прошедшие) откладывается до появления явного запроса.

Так как пользователь просит «вторая вкладка продажа персональных уроков и продажа пакета», минимальный вариант:

- вкладка 1: «Персональные уроки»;
- вкладка 2: «Продажа».

Внутри вкладки «Продажа»:

- карточка/сегмент «Продать урок»;
- карточка/сегмент «Продать пакет».

### 4.2. Вкладка «Персональные уроки»

Функции:

- просмотр будущих и прошедших персональных уроков;
- фильтр периода: неделя, месяц, произвольный диапазон;
- фильтр по локации;
- фильтр по дисциплине;
- фильтр по преподавателю;
- фильтр по клиенту;
- фильтр по оплате: все, оплачено, долг;
- фильтр по посещению: не отмечено, пришёл, не пришёл, уважительный пропуск;
- быстрые действия для будущих уроков: редактировать, удалить, оплатить;
- для прошедших уроков: просмотр, отметка посещения, оплата долга, но без удаления.

Рекомендуемое отображение:

- таблица или карточный список с виртуализацией при большом количестве записей;
- группировка по дате;
- явные бейджи: `Оплачено`, `Долг`, `Пакет` (привязан), `Списано` (attendance present/absent при subscription), `Не отмечено`, `Пришёл`, `Не пришёл`, `Уважительный пропуск`;
- для teacher скрывать суммы, если текущая RBAC-модель оставляет финансовое маскирование.

Колонки:

- дата;
- время;
- локация;
- дисциплина;
- преподаватель;
- клиенты;
- формат: solo/pair/trio/quad;
- источник оплаты: разовая оплата / пакет / долг;
- стоимость;
- статус оплаты;
- статус посещения;
- действия.

### 4.3. Вкладка «Продажа»

Вкладка должна покрывать две операции:

1. Продать и записать персональный урок.
2. Продать пакет персональных уроков.

Форма продажи урока должна быть выделена из `AddPersonalLessonForm` в переиспользуемый компонент, который умеет работать в двух режимах:

- `schedule-cell` — открыта из свободной ячейки расписания, локация/дата/время предзаполнены;
- `standalone` — открыта из раздела «Персональные уроки», все поля выбираются вручную.

Поля формы:

- локация;
- дисциплина;
- преподаватель;
- клиенты от 1 до 4;
- дата/время или расписание повторений;
- тариф за урок;
- ручная стоимость;
- способ оплаты:
  - оплатить один урок;
  - оформить в долг;
  - списать с пакета;
- кнопка «Продать пакет уроков»;
- комментарий/заметка — опционально, если понадобится позже.

### 4.4. Повторения

Минимальный MVP:

- режим «Одна дата»;
- режим «Несколько дат»;
- режим «Еженедельно»:
  - дата начала;
  - дата окончания или количество недель;
  - до нескольких weekly rows: **день недели, начало, окончание** (локация и преподаватель — из общих полей формы §4.3, не дублировать в каждой строке, если не нужен явный multi-location сценарий);
  - генерация массива `dates` перед вызовом мутации.

Рекомендуемый production-вариант:

```sql
personal_lesson_series
- id uuid primary key
- organization_id uuid not null
- created_by uuid
- client_ids uuid[] not null
- discipline_id uuid not null
- teacher_member_id uuid not null
- location_id uuid not null
- recurrence_rule jsonb not null
- starts_on date not null
- ends_on date
- created_at timestamptz not null
```

```sql
personal_lessons
- series_id uuid null references personal_lesson_series(id)
```

Для первого этапа можно не вводить `personal_lesson_series`, если команда готова принять ограничение: редактирование/удаление серии будет недоступно, а каждое повторение будет отдельным уроком.

## 5. Целевая модель данных

### 5.1. Изменения для 4 клиентов

Нужно добавить поддержку четвертого клиента во всех связанных сущностях.

БД:

```sql
ALTER TABLE personal_lessons
  ADD COLUMN client_id4 uuid;
-- + FK, type check ('quad'), validate_personal_lesson_subscription (ветка quad)
```

Также потребуется аналогичное расширение:

- `subscriptions.client_id4` и CHECK `type IN (..., 'quad')` для `category = 'private'`;
- `prices`: тип `personal_quad` в CHECK для `category = 'private'`;
- типов `Subscription`, `PersonalLesson`, `PersonalDisplayLesson`;
- `getSubscriptionClientIds()`, `bookingClientsMatchSubscription()`;
- `SellPackageModal`, `PricesPanel`;
- тарифов и labels в `utils.ts` (`filterPrivateLessonTariffsForSale`, `filterPrivatePackageTariffsForSale`, `tariffParticipantType` и т.д.);
- CSV/export/debtors;
- RLS/functions, `personal_lessons_teacher_v` (добавить `client_id4` в SELECT при необходимости отображения);
- триггер `validate_personal_lesson_subscription`: ветка `quad` + `client_id4` в `UPDATE OF` trigger.

Если 4 клиента не критичны для MVP, можно явно зафиксировать ограничение MVP: до 3 клиентов, а 4 клиента отдельным эпиком. **По умолчанию MVP включает 4 клиентов** (см. §12).

### 5.2. Изменения для `excused` и единого RPC посещаемости

БД — constraint:

```sql
ALTER TABLE personal_lessons
  DROP CONSTRAINT IF EXISTS personal_lessons_attendance_status_check;

ALTER TABLE personal_lessons
  ADD CONSTRAINT personal_lessons_attendance_status_check
  CHECK (attendance_status IS NULL OR attendance_status IN ('present', 'absent', 'excused'));
```

RPC `mark_personal_lesson_attendance(p_lesson_id, p_new_status)` — **единая точка** для всех персональных уроков:

1. Убрать запрет на `subscription_id IS NOT NULL`.
2. Принимать `present | absent | excused`.
3. Для урока **без** пакета: только обновлять `attendance_status` (как сейчас для разовых).
4. Для урока **с** пакетом (`subscription_id`):
   - `present` / `absent` → списать 1 урок (`lessons_left - 1`), с компенсацией при смене статуса;
   - `excused` → не списывать;
   - смена `present|absent` → `excused` → вернуть списание;
   - смена `excused|null` → `present|absent` → списать;
   - повторная установка того же статуса → idempotent, без изменения остатка;
   - использовать `PERFORM set_config('app.allow_subscription_counter_update', 'true', true)` по аналогии с `mark_attendance`.
5. Проверки: org, role, teacher scope, `date <= current_date`, org not read-only.

**Не дублировать** логику списания в `mark_attendance` для private — иначе два источника истины.

Синхронизация UI:

- `AttendancePanel`: добавить ветку **`isPersonalPackageView`** (`kind === "personal" && subscriptionId`) — те же кнопки, что у разового (`handleMarkPersonal` + `excused`), **не** список `modalSubs` + `handleMark`;
- для personal с пакетом заменить ошибочную ветку `handleMark` на `useMarkPersonalLessonAttendance`;
- новый раздел `/personal`: те же actions через тот же hook.

Типы:

- `PersonalLesson.attendanceStatus?: "present" | "absent" | "excused" | null`;
- `useMarkPersonalLessonAttendance.status: "present" | "absent" | "excused"`.

> **Дополнительно:** в `useMarkPersonalLessonAttendance` → `onMutate` optimistic update сейчас пишет `attendanceStatus: status` с типом `"present" | "absent"`. После добавления `excused` тип должен быть расширен до `"present" | "absent" | "excused"` как в мутации, так и в `PersonalLesson` interface. Иначе TypeScript выдаст ошибку при передаче `"excused"` в оптимистичный апдейт.

### 5.3. Удаление и история

Правило:

- удалять можно только уроки с **`date > current_date`** (строго будущие; сегодняшний — нельзя);
- сегодняшние и прошедшие уроки нельзя удалять;
- прошедшие уроки можно смотреть и отмечать посещение;
- редактирование прошедших (`date < today`) и сегодняшних — запретить.

> **Внимание — `isPastDate` глобальна.** Функция `isPastDate(date)` в `lib/scheduleWeek.ts` возвращает `date < today` (сегодня ≠ прошлое). Она используется не только в `canWritePersonalLesson`, но и в `canManageGroupLesson`. **Зафиксировано (PL-0, Этап 0):**
>
> - **Вариант A (принят)** — не менять `isPastDate` глобально; в `canWritePersonalLesson` и в RPC `delete_personal_lesson`/`update` использовать явную проверку `lesson.date <= current_date`. Групповые уроки — без изменений.
> - ~~Вариант B~~ — отклонён: сегодняшние групповые уроки стали бы нередактируемыми без отдельного бизнес-решения.

Рекомендуемая мутация:

```sql
delete_personal_lesson(p_lesson_id uuid)
```

Проверки внутри RPC:

- организация совпадает;
- роль имеет право (в т.ч. teacher scope);
- **`date > current_date`**;
- если урок с пакетом и уже списан (`attendance_status IN ('present','absent')`) — ошибка «сначала смените отметку»;
- если есть payment (`payments.personal_lesson_id`) — ошибка «сначала отмените оплату» или soft-delete policy (отдельное решение; для MVP — запрет).

**Редактирование (дополнение к §3.10):**

- RPC `update_personal_lesson` с guard `date > current_date` **до** применения изменений;
- если меняется `date` — новая дата тоже должна быть `> current_date`;
- при уроке с пакетом и `attendance_status IN ('present','absent')` — запрет смены клиентов/пакета без предварительного сброса отметки (согласовать с бизнес-правилом §8).

## 6. Архитектура UI и кода

### 6.0. Принципы: не ломать расписание, без дублирования

1. **Один источник формы продажи** — `PersonalLessonSaleForm`; `AddPersonalLessonForm` остаётся тонкой обёрткой (`schedule-cell`).
2. **Один hook посещаемости** — `useMarkPersonalLessonAttendance` для раздела, расписания и `AttendancePanel`.
3. **Переиспользовать существующие модалки**, не копировать логику:
   - оплата → `PayPersonalLessonModal`;
   - продажа пакета → `SellPackageModal`;
   - редактирование из расписания → `EditLessonPopup` (в разделе `/personal` — тот же popup или общий edit-компонент, не третья копия).
4. **Не трогать** `useScheduleForWeek`, overlap-триггеры, RLS шире необходимого.
5. **Удалить мёртвый код** после Этапа 4:
   - `tangodb/src/components/PersonalLessonsPanel.tsx` (~1200 строк, deprecated, не в роутере);
   - `tangodb/src/pages/PersonalPage.tsx` (не в роутере);
   - `store/ui.ts`: поле `personalFilter` / `setPersonalFilter` (**нигде не используется**); `personalTab` — либо переиспользовать в новом контейнере, либо удалить.
6. **Invalidation** при мутациях: `personalLessonsQueryKey`, `["schedule"]`, `subscriptions`, `payments` — расширить `useAddPersonalLessons` и `useMarkPersonalLessonAttendance` (сейчас add — только personal; mark — только personal).
7. **Module gate:** пункт навигации «Персональные уроки» показывать только если `organization_settings.modules.personal_lessons === true` (как тарифы фильтруются через `orgModules.ts`).
8. **Не дублировать** `ScheduleDebtorsBlock` — фильтр «Долг» на вкладке списка (§3.11).

### 6.1. Компоненты

Рекомендуемая новая структура:

```text
tangodb/src/components/personal-lessons/
  PersonalLessonsPageContainer.tsx
  PersonalLessonsToolbar.tsx
  PersonalLessonsList.tsx
  PersonalLessonRow.tsx
  PersonalLessonFilters.tsx
  PersonalLessonSalePanel.tsx
  PersonalLessonSaleForm.tsx
  PersonalLessonAttendanceActions.tsx   ← thin wrapper над useMarkPersonalLessonAttendance
```

Не создавать `PersonalLessonPaymentActions.tsx`, если достаточно переиспользования `PayPersonalLessonModal`.

Переиспользование:

- вынести общую форму из `components/schedule/AddPersonalLessonForm.tsx` в `PersonalLessonSaleForm`;
- `AddPersonalLessonForm` оставить тонкой обёрткой для режима `schedule-cell`;
- новый раздел использовать тот же `PersonalLessonSaleForm` в режиме `standalone`;
- `SellPackageModal` — переиспользовать; inline-card только если UX того требует (без дублирования полей продажи пакета).

### 6.2. Хуки

Расширить `usePersonalLessons()`:

```ts
export interface UsePersonalLessonsOptions {
  yearMonth?: string;
  dateRange?: { start: string; end: string };
  paidFilter?: "yes" | "no";
  locationId?: string;
  disciplineId?: string;
  teacherMemberId?: string;
  clientId?: string; // match client_id1 OR client_id2 OR client_id3 OR client_id4
  attendanceStatus?: "unmarked" | "present" | "absent" | "excused";
  enabled?: boolean;
}
```

Реализация фильтров:

- `locationId`, `teacherMemberId`, `dateRange` — **на стороне Supabase** (есть индексы `idx_personal_lessons_org_date`, `idx_personal_lessons_org_teacher`);
- `disciplineId`, `clientId`, `attendanceStatus` — в query через `.eq()` / `.or()`; при сложном `clientId` допустим client-side filter **после** fetch по периоду (не загружать всю историю org);
- `attendanceStatus: "unmarked"` → `.is("attendance_status", null)`.

**Кэш TanStack Query:** расширить `buildQueryKeySuffix()` — включить все новые фильтры, иначе смена фильтра вернёт stale data из кэша с другим набором опций.

Добавить/обновить мутации:

- `useAddPersonalLessons()` — standalone recurrence rows, `clientId4`, `quad`; invalidation schedule + subscriptions;
- `useDeletePersonalLesson()` — заменить прямой delete на RPC `delete_personal_lesson`;
- `useUpdatePersonalLesson()` — guard даты в hook + переход на RPC `update_personal_lesson` (§3.10);
- `useMarkPersonalLessonAttendance()` — `excused` + invalidation subscriptions при package lesson;
- отдельный `usePersonalLessonFiltersData()` **не нужен**, если справочники уже есть в `useLocations`, `useDisciplines`, `useTeamMembers`, `useClientDirectory`.

### 6.3. Маршруты и навигация

Изменения:

- вернуть routes `/personal`, `/personal/sell`;
- `/personal/book` → redirect `/personal/sell`;
- добавить секцию навигации «Персональные уроки» в `NAV_SECTIONS` (отдельно от «Расписание и журнал») и при необходимости в `MOBILE_TABS` — с `canAccessPanel('personal')` и `modules.personal_lessons`;
- обновить `PANEL_FALLBACK_PATHS`: `{ panel: "personal", path: "/personal" }`, `{ panel: "personal_sell", path: "/personal/sell" }`;
- panel id `personal` — read; `personal_sell` — вкладка продажи;
- убрать redirect `/personal` → `/schedule`;
- **`/schedule?action=sell`** оставить для быстрого `SellPackageModal`;
- **`DashboardPage`:** `personalView.path` → `/personal` (сейчас `/schedule`);
- **`AttendancePanel`:** ссылку «Расписание» оставить на `/schedule`; опционально добавить «Все персональные» → `/personal` (не заменять расписание).

Важно:

- после реализации обновить `.cursor/docs/ai/architecture.md` (убрать legacy redirect, описать `components/personal-lessons/`);
- после архитектурного решения обновить `.cursor/docs/ai/decision_log.md`;
- после изменения кода обновить `.cursor/docs/ai/changelog.md`.

### 6.4. Права

Базово:

- owner/director/admin: просмотр и продажа всех персональных уроков в организации;
- teacher: просмотр/продажа только в своём scope (`teacher_member_id`, discipline/location scope);
- accountant: **нет** доступа (`canReadScopedCrm` → false для accountant);
- reception (restricted admin): **нет** доступа к `personal_lessons.*` (только attendance/subscriptions/payments).

Особенно важно:

- teacher: **`price` скрыт** (`personal_lessons_teacher_v`), статус **`paid` виден** — не ломать при доработках;
- оплата разового урока teacher → RPC `record_personal_lesson_payment`;
- RLS — источник истины, UI guards (`RequirePermission`, `canAccessPanel`) — UX.

## 7. Тарифы и пакеты

### 7.1. Разовый персональный урок

Использовать существующие тарифы категории `private`, которые соответствуют разовой продаже урока.

Правила:

- тариф фильтруется по дисциплине и локации;
- пользователь может вручную изменить стоимость;
- при оплате создаётся payment;
- при долге `paid = no`;
- при оплате `paid = yes`;
- teacher может иметь ограниченный путь оплаты через RPC.

### 7.2. Пакет персональных уроков

Использовать существующую модель private subscriptions:

- `subscriptions.category = private`;
- `lessons_total`;
- `lessons_left`;
- `discipline_id`;
- `price_id`;
- клиенты пакета должны совпадать с клиентами урока.

**Решение зафиксировано (§9 Этап 0, PL-0):**

- пакет действует только на дисциплину `subscriptions.discipline_id` — урок с тем же `discipline_id` (UI-фильтр при выборе пакета; проверка в trigger `validate_personal_lesson_subscription` на Этапе 1);
- локация определяется тарифом пакета (`prices.location_id` через `subscriptions.price_id`): глобальный тариф (`location_id IS NULL`) — урок в любой локации; локальный тариф — урок только в этой локации (UI + trigger на Этапе 1).

### 7.3. Формат на 4 клиентов

Если требование 4 клиентов входит в MVP, добавить:

- `quad` в `personal_lessons.type` и `subscriptions.type` (private);
- `personal_quad` в `prices.type`;
- label «Индивидуальный урок на 4 клиента» (или «Квартет»);
- флаг модуля `quad_lessons` в `OrgModules` — **после** расширения модельной схемы в `tangodb_modular_dance_crm_TZ.md` (сейчас есть `personal_lessons`, `trio_lessons`, `pair_subscriptions`, но **нет** `quad_lessons`; MVP quad — без module gating, только CHECK в БД и тарифы);
- поддержку в пакетах и разовых уроках.

## 8. Посещаемость и списания

Два типа уроков — **один RPC**, разная логика внутри:

| | Разовый (`subscription_id IS NULL`) | С пакетом (`subscription_id NOT NULL`) |
|---|-------------------------------------|----------------------------------------|
| Поле статуса | `personal_lessons.attendance_status` | то же |
| Списание пакета | нет | да, через RPC |
| Разовая оплата | `paid` / `payments` не меняются от attendance | n/a |

Статусы:

- `null` — не отмечено;
- `present` — пришёл;
- `absent` — не пришёл;
- `excused` — уважительный пропуск.

Логика списания пакета (в `mark_personal_lesson_attendance`):

- `present` списывает 1 урок;
- `absent` списывает 1 урок;
- `excused` не списывает;
- смена статуса компенсирует прошлое списание;
- повторная установка того же статуса не меняет остаток.

Для разовой оплаты:

- attendance не меняет `price` или `paid`;
- долг остаётся долгом, пока не вызван `record_personal_lesson_payment` / `PayPersonalLessonModal`.

## 9. План реализации

### Этап 0. Уточнение решений ✅ (2026-06-24)

Перед кодом подтвердить (часть решений зафиксирована в этом документе):

| Вопрос | Решение для MVP |
|--------|-----------------|
| 4-й клиент | Да, в MVP |
| Route | `/personal`, `/personal/sell` |
| Длина повторов | До даты окончания **или** N недель (оба варианта в UI) |
| Списание пакета | При attendance через единый `mark_personal_lesson_attendance` |
| Teacher суммы | `price` скрыт, `paid` виден |
| Ручной тариф при продаже | Да (как в `AddPersonalLessonForm`) |
| History tab | Нет — один список с фильтром периода |
| Удаление | Только `date > today` (RPC + UI) |
| Редактирование | Только `date > today` (унифицировать с удалением) |

**Дополнительно зафиксировано (PL-0 в `decision_log.md`):**

| Вопрос | Решение для MVP |
|--------|-----------------|
| `isPastDate` | Вариант A — не менять глобально; персональные через `date <= today` |
| Пакет — дисциплина | Только `subscriptions.discipline_id` (§7.2) |
| Пакет — локация | Через `prices.location_id` тарифа (глобальный / локальный) |
| Delete с оплатой | Запрет (сначала отменить оплату) |
| Edit с пакетом + attendance | Запрет смены клиентов/пакета без сброса отметки |
| `personal_lesson_series` | Не в MVP — отдельные строки |
| `personalTab` (Zustand) | Переиспользовать в новом контейнере |
| Приоритет | Этап 1 (RPC attendance) до UI раздела |

### Этап 1. БД и типы

Задачи (порядок важен):

1. **Исправить `mark_personal_lesson_attendance`** — package deduction + `excused` (§5.2, §3.5).
2. Добавить `delete_personal_lesson` RPC (§5.3).
3. Добавить `update_personal_lesson` RPC с guard даты (§3.10, §5.3).
4. Добавить `client_id4` / `quad` / `personal_quad` (§5.1); trigger `personal_lesson_subscription_guard` — `UPDATE OF client_id4`.
5. Обновить `personal_lessons_teacher_v` (колонки при необходимости).
6. Обновить TS-типы и utils.
7. SQL/RPC тесты — если контур есть в проекте.

**Не менять** `mark_attendance` для private-пакетов.

### Этап 2. Хуки

Задачи:

- расширить `usePersonalLessons()` фильтрами (§6.2);
- обновить mapping `clientId4`;
- обновить `useAddPersonalLessons()` + invalidation schedule/subscriptions;
- обновить `useUpdatePersonalLesson()` — guard даты;
- заменить direct delete на RPC;
- обновить `useMarkPersonalLessonAttendance()` — `excused`, invalidation subscriptions;
- **исправить `AttendancePanel`** — отдельная ветка `personal + subscriptionId`: `handleMarkPersonal` / `useMarkPersonalLessonAttendance`, **не** `handleMark`; кнопка `excused` (§2.4);
- расширить `buildQueryKeySuffix` под новые фильтры.

### Этап 3. Выделение формы продажи

Задачи:

- создать `PersonalLessonSaleForm`;
- перенести туда общую логику из `AddPersonalLessonForm`;
- добавить режимы `schedule-cell` и `standalone`;
- для standalone добавить явный выбор локации, даты, времени и преподавателя;
- добавить режим повторений;
- оставить текущую popup-форму расписания рабочей через wrapper.

### Этап 4. Новый раздел

Задачи:

- создать `PersonalLessonsPageContainer`;
- добавить вкладки;
- filters toolbar;
- список/таблица уроков;
- actions: `PayPersonalLessonModal`, `useMarkPersonalLessonAttendance`, edit через `EditLessonPopup` или shared edit;
- `SellPackageModal` на вкладке продажи;
- routes + навигация (§6.3) + `DashboardPage.personalView`;
- **удалить** `PersonalLessonsPanel.tsx`, `PersonalPage.tsx`, мёртвый `personalFilter` в `store/ui.ts`;
- убрать legacy redirects в `App.tsx`.

### Этап 5. Проверка прав и edge cases

Проверить сценарии:

- owner/director/admin видит все уроки;
- teacher видит только свой scope;
- teacher не видит **суммы** (`price`), видит **paid**;
- accountant / reception не видят раздел;
- нельзя удалить урок с `date <= today` (RPC);
- нельзя редактировать урок с `date <= today`;
- нельзя создать пересечение по локации/времени;
- нельзя привязать чужой пакет / другую дисциплину;
- **урок с пакетом**: отметка через `mark_personal_lesson_attendance`, `lessons_left` меняется;
- `excused` не списывает; `present → excused` возвращает урок;
- расписание (`/schedule`) без регрессий после выделения формы;
- `/personal/sell`, `/schedule?action=sell` (только пакет) работают;
- после миграции нет импортов `PersonalLessonsPanel` / `PersonalPage`.

### Этап 6. Документация

После реализации обновить:

- `.cursor/docs/ai/changelog.md`;
- `.cursor/docs/ai/architecture.md`;
- `.cursor/docs/ai/decision_log.md` (вариант A для `isPastDate`, откат SCHEDULE_TZ §7);
- `SCHEDULE_TZ.md` — маршруты `/personal`, статус Промпта 7;
- `.cursor/docs/ai/lessons.md`, если в процессе будет найден и исправлен баг.

## 10. Рекомендации

1. Не копировать `PersonalLessonsPanel` — только идеи UX; после миграции **удалить** файл.
2. Одна форма продажи (`PersonalLessonSaleForm`), одна мутация attendance, одна мутация delete.
3. **Сначала** починить RPC посещаемости для пакетных уроков (§2.3), потом UI раздела.
4. Явно различать в UI: «оплачено пакетом» vs «списано с пакета» (badges §4.2).
5. Повторения MVP — отдельные строки `personal_lessons`; `personal_lesson_series` — следующий этап.
6. Delete только через RPC `delete_personal_lesson`, не прямой `.delete()`.
7. RLS не расширять без review; reception/accountant вне scope.
8. Не создавать параллельные payment/attendance компоненты — `PayPersonalLessonModal`, `EditLessonPopup`.
9. При выделении формы прогнать регрессию `/schedule`: создание из ячейки, conflicts, оплата, delete.
10. Backend guard для update/delete — не полагаться только на UI (§3.10).
11. Расширять `buildQueryKeySuffix` при добавлении фильтров — иначе баги кэша.
12. Не создавать отдельный список должников — фильтр `paidFilter: "no"` + `PayPersonalLessonModal`.

## 11. Промпты для ИИ

### Промпт 1. БД и типы персональных уроков

```text
Прочитай .cursor/docs/ai/AI_CONTEXT.md и PERSONAL_LESSONS_TZ.md §5.1–5.3, §3.10.
Реализуй подготовку модели персональных уроков:
- ПРИОРИТЕТ: перепиши mark_personal_lesson_attendance — единый RPC для разовых и пакетных уроков;
  убери блок subscription_id; present/absent списывают lessons_left private-пакета; excused не списывает;
  компенсация при смене статуса; НЕ дублируй логику в mark_attendance;
- добавь delete_personal_lesson RPC (date > current_date, проверки payment/attendance);
- добавь update_personal_lesson RPC (date > current_date, role/scope);
- добавь client_id4, type quad, personal_quad, subscriptions quad;
- constraint excused на attendance_status; trigger subscription guard + client_id4;
- обнови personal_lessons_teacher_v, TS-типы, utils;
- не трогай RLS шире необходимого;
- changelog.md + decision_log.md при архитектурных решениях.
```

### Промпт 2. Расширение хуков

```text
Расширь usePersonalLessons.ts по PERSONAL_LESSONS_TZ.md §6.2:
- фильтры locationId, disciplineId, teacherMemberId, clientId, attendanceStatus;
- buildQueryKeySuffix — все новые фильтры в queryKey;
- clientId4 в маппинг и useAddPersonalLessons;
- delete через RPC delete_personal_lesson; update через RPC update_personal_lesson;
- useMarkPersonalLessonAttendance: excused + invalidate subscriptions;
- исправь AttendancePanel: ветка personal+subscriptionId → handleMarkPersonal (не handleMark); excused для personal+пакет;
- invalidation: personalLessons, schedule, subscriptions, payments;
- Supabase только в hooks/lib.
Обнови changelog.
```

### Промпт 3. Выделение формы продажи

```text
Переработай форму персонального урока:
- вынеси общую логику из components/schedule/AddPersonalLessonForm.tsx в новый components/personal-lessons/PersonalLessonSaleForm.tsx;
- поддержи два режима: schedule-cell и standalone;
- schedule-cell должен сохранить текущий UX popup "Персональный урок · Новая запись";
- standalone должен позволять выбрать локацию, дисциплину, преподавателя, клиентов, даты/повторения и оплату;
- поддержи до 4 клиентов;
- сохрани быстрый popup добавления клиента через ClientAutocomplete;
- не дублируй SellPackageModal, переиспользуй существующий компонент;
- проверь отсутствие регрессий в расписании.
```

### Промпт 4. Новый раздел `/personal`

```text
Создай раздел /personal по PERSONAL_LESSONS_TZ.md:
- routes /personal, /personal/sell; redirect /personal/book → /personal/sell;
- NAV + permissions PANEL_FALLBACK_PATHS + modules.personal_lessons gate;
- DashboardPage personalView → /personal;
- вкладки: список с фильтрами, продажа (PersonalLessonSaleForm + SellPackageModal);
- PayPersonalLessonModal, EditLessonPopup (с useSchedule + dateRange personalLessons) — переиспользовать;
- attendance present/absent/excused через useMarkPersonalLessonAttendance;
- delete/edit только date > today;
- УДАЛИ PersonalLessonsPanel.tsx, PersonalPage.tsx, personalFilter из store/ui.ts;
- убери redirects /personal → /schedule в App.tsx;
- architecture.md, decision_log.md, SCHEDULE_TZ.md, changelog.md.
```

### Промпт 5. QA и регрессия

```text
Регрессия по PERSONAL_LESSONS_TZ.md §Этап 5:
- разовый урок: оплата, долг, attendance без списания пакета;
- урок с пакетом: create → mark present/absent → lessons_left; excused; present→excused;
- /schedule: popup из ячейки, conflicts, PayPersonalLessonModal;
- /personal: фильтры, sell, 1–4 клиента;
- delete RPC: только date > today;
- teacher scope + masked price;
- accountant/reception: нет доступа к /personal;
- нет импортов PersonalLessonsPanel.
lessons.md — только при реальном баге.
```

## 12. Итоговый рекомендуемый MVP

- отдельный **`/personal`** + вкладка **`/personal/sell`**; **`/schedule`** — только недельная сетка;
- **`PersonalLessonSaleForm`** — общая форма; **`AddPersonalLessonForm`** — wrapper для расписания;
- **Этап 1 обязателен до UI**: attendance для пакетных + RPC delete/update с guard даты;
- фильтры просмотра; 4-й клиент + `excused`; `buildQueryKeySuffix` под фильтры;
- повторения — генерация отдельных уроков;
- delete/edit только **`date > today`** (RPC + UI, вариант A для `isPastDate`);
- списание пакета — только через **`mark_personal_lesson_attendance`**;
- удалить deprecated UI и **`personalFilter`** из store;
- **`/schedule?action=sell`** — только `SellPackageModal`;
- не дублировать должников — фильтр «Долг» на списке;
- обновить **`SCHEDULE_TZ.md`** после отката redirect.
