# Персональные тарифы: промпты для агента

Готовые к копированию промпты по `tangodb_personal_tariff_duration_payments.md` (§7 Этапы 0–3).

Каждый промпт — отдельный запуск в новом контексте. Перед каждым: прочитать `.cursor/docs/ai/AI_CONTEXT.md` и файлы из блока «Прочитай сначала». Спека — источник истины; при расхождении со спекой не «улучшать» модель.

Дата написания: 2026-08-16 (синхронизировано со спекой после ревью совместимости: пакет без `price_id`, сторно копирует снимок, S5c restate→касса, архивный тариф, выручка по снимку после DELETE прайса, кап RPC глобальный). Текущая CRM: `2.7.26`. Последняя миграция на эту дату: `20260916000001_restate_personal_lesson_amount.sql`. Если к моменту реализации появилась более поздняя миграция — брать следующий timestamp по факту, не зашитую дату.

Этап 1 = новая подверсия **`2.8.0`** (контур тарифа персонального). Бамп версии — только в Промпте 9, после закрытия этапа 1. Этапы 2–3 — микропатчи `2.8.y`, если split не расползётся (тогда отдельный `x`).

---

## Порядок и зависимости

| # | Промпт | Этап | Зависит от | Статус |
|---|--------|------|------------|--------|
| 0 | Decision log `PL-TARIFF-0` | 0 | — | ✅ |
| 1 | `personalTariffPricing.ts` + типы + unit-тесты | 1 | 0 | ✅ |
| 2 | SQL: duration / `price_id` / снимок платежа / `payer_client_id` / дебиторка | 1 | 0 | ✅ |
| 3 | RPC: одна сигнатура + хук оплаты + restate сбрасывает `price_id` | 1 | 2 | ✅ |
| 4 | UI прайса: длительность тарифа | 1 | 1, 2 | ✅ |
| 5 | Продажа / запись: billed, `price_id`, плательщик, фильтр педагога, warn | 1 | 1, 2, 3 | ✅ |
| 6 | Касса: режимы `tariff \| outstanding \| package` | 1 | 1, 3, 5 | ✅ |
| 7 | Дебиторка по плательщику | 1 | 2, 6 | ✅ |
| 8 | Журнал + edit-popup (S5/S5b/S6) | 1 | 3, 5, 6 | ✅ |
| 9 | Закрытие этапа 1: `2.8.0`, SQL-тесты, критерии 1–9 | 1 | 1–8 | |
| 10 | Charges, split «поровну» | 2 | 9 | |
| 11 | Выручка по тарифам | 3 | 9 | |

```
Промпт 0
   ↓
Промпт 1 (lib)     Промпт 2 (SQL)     ← можно параллельно после 0
   ↓                  ↓
   └──────→ Промпт 3 (RPC) ←────────┘
              ↓
Промпт 4 (прайс)     ← после 1+2; можно параллельно с 3
              ↓
Промпт 5 (продажа)   ← после 1+2+3
              ↓
Промпт 6 (касса)
              ↓
        ┌─────┴─────┐
        ↓           ↓
   Промпт 7     Промпт 8     ← можно параллельно после 6
   (дебиторка)  (журнал/edit)
        └─────┬─────┘
              ↓
         Промпт 9 (закрытие этапа 1)
              ↓
         Промпт 10 (этап 2, только если нужен split)
              ↓
         Промпт 11 (этап 3, когда price_id стабильно пишется)
```

Промпт **10** не запускать «на всякий случай»: спека требует confirmed потребность студий в 50/50.

---

## Общие правила для всех промптов с кодом

- Логика Supabase — только в `hooks/` и `lib/`, не в компонентах.
- Не дублировать компоненты и хуки.
- RLS не трогать, если промпт явно не просит.
- Не использовать таблицы аренды (`rental_tariffs.min_duration_minutes` и `roundMoney` из rental) для персональных.
- Формулы billed — только multiply-first / копейки (§3.2). Запрещено: `price × (minutes/duration)` в IEEE `number`, восстановление billed из `units_snap`.
- `personal_lesson_charge_id` в этапе 1 не добавлять (ни колонку, ни `p_charge_id`). NOT NULL — только этап 2.
- `tariff_units` без DEFAULT; не писать `×1` без тарифа.
- Не подбирать тариф по `price === lesson.price`.
- Select — через `AppSelect`.
- Строки UI — i18n (`ru.ts` / `en.ts` / `keys.ts`), не хардкод в JSX.
- После кода: `.cursor/docs/ai/changelog.md`. Архитектурное решение — только Промпт 0 (`decision_log.md`).
- Сначала `codegraph_explore` по символам задачи (`projectPath`: `D:\cursor_dev\TangoDB\tangodb`).

---

### Промпт 0 — decision log (этап 0)

```
Задача: зафиксировать продуктовые решения перед реализацией длительности персонального тарифа и раздельных платежей.

Прочитай tangodb_personal_tariff_duration_payments.md целиком (особенно §2 инварианты, §7 Этап 0, §8, §9) и добавь в .cursor/docs/ai/decision_log.md запись PL-TARIFF-0.

Зафиксируй как принятые (рекомендации по умолчанию из §8, если пользователь не сказал иначе):

1. Несовпадение длительности урока и тарифа — предупреждение, не hard-block. Можно продолжить с уже пересчитанной суммой.
2. Pair/trio/quad по умолчанию: один плательщик, select обязателен при 2+ клиентах. Режим «поровну» — этап 2, не v1.
3. Backfill duration_minutes существующих персональных тарифов: NULL = legacy fixed. Не ставить авто-60.
4. Отчёт «персональные по тарифам» — Финансы → Выручка, шт. = нетто-операции (сторно −1), не сумма tariff_units и не «уроки». На дашборд разбивку не тащить.
5. Billed = multiply-first (SQL numeric ROUND / JS копейки). Не IEEE number «price × (minutes/duration)».
6. На уроке хранить price_id с продажи, чтобы пересчитывать billed при смене слота до оплаты.
7. Restate обнуляет price_id; дальше автопересчёт по слоту выключен.
8. Удаление прайса: price_id SET NULL; на платеже оставить снимки tariff_label / tariff_price / tariff_duration_minutes / tariff_units.
9. Этап 1 включает payer_client_id (S12–S13, S18). Таблицы charges — этап 2.
10. Dual overload record_personal_lesson_payment схлопывается в одну публичную сигнатуру (venue ack + partial/top-up).
11. Подверсия этапа 1: 2.8.0 (новый контур), не микропатч внутри 2.7.
12. Пакетный урок: price_id NULL; автопересчёт не трогает price = 0.
13. Сторно и correct_payment копируют снимок тарифа с исходного платежа.
14. Restate без платежей + выбор тарифа в кассе = явный пересчёт (S5c). Restate после частичной оплаты — только режим B.
15. Выручка этапа 3: ключ строки = price_id ?? снимок tariff_label/price/duration, не только price_id.
16. Кап amount ≤ remaining — в RPC для всех вызовов.

Не менять код. Не создавать миграции. Только decision_log.md.
```

---

### Промпт 1 — слой расчёта (этап 1)

```
Задача: чистые функции пересчёта персонального тарифа + типы Price/Payment/PersonalLesson под длительность. Без UI и без SQL.

Контекст: tangodb_personal_tariff_duration_payments.md §3.1–§3.4, §6.2, инварианты §2.

Что сделать:

1. Новый модуль tangodb/src/lib/personalTariffPricing.ts (без Supabase):
   - lessonDurationMinutes(start, end) — через timeToMinutes из scheduleWeek.ts; ≤ 0 = нельзя тарифицировать
   - durationParts(minutes) → { hours, minutes } для i18n; сами строки «1ч.» / «45 мин.» в этот модуль не хардкодить
   - formatLessonDuration(minutes, translate) — тонкая обёртка над durationParts + ключи i18n, не хардкод в JSX
   - tariffUnitsExact(lessonMinutes, tariffMinutes)
   - tariffUnitsSnapshot(lessonMinutes, tariffMinutes) — round_half_up до 4 знаков; только UI/снимок
   - billedFromTariff(price, lessonMinutes, tariffMinutes) — multiply-first в копейках:
       billed = round_half_up( (price × lesson_minutes) / duration_minutes , 2)
     Никогда не считать price * (lesson/duration) в number и не восстанавливать billed из snapshot.
     round_half_up как PostgreSQL ROUND(numeric, 2) (половину от нуля вверх по модулю).
   - roundMoney(n) — half-up 2 знака только для уже посчитанного decimal; не замена billedFromTariff
   - durationWarning(...) — один код по приоритету §3.4:
       legacy_no_duration | shorter | longer_not_multiple | longer_multiple
     Случай «равно и не кратно» не кодировать. Hard-block условия (§3.4) — отдельные коды/ошибки, не warn.
   - splitBilledEqually(total, n) — реализовать сейчас (нужен этапу 2), в UI этапа 1 не звать.
     round_half_up(total/n, 2), остаток копеек на индекс 0.

2. Типы (tangodb/src/types/index.ts), в той же поставке:
   - Price.durationMinutes?: number | null
   - PersonalLesson.priceId?: string | null
   - PersonalLesson.payerClientId?: string | null
   - Payment: priceId, tariffDurationMinutes, tariffUnits, tariffPrice, tariffLabel, lessonDurationMinutes — все nullable

3. tangodb/src/hooks/usePrices.ts — mapPrice читает duration_minutes → durationMinutes (null если нет колонки ещё можно не ждать: после Промпта 2 колонка будет; здесь маппить поле, отсутствие в select не ронять).

4. Тесты: tangodb/scripts/personal-tariff-pricing-check.mjs
   Импортировать реальный модуль через tsx (как rental-tariff-archive-check.mjs), не копировать формулы в скрипт.
   Обязательные кейсы §3.2: 45/45/300 → 300; 90/45/300 → 600; 60/45/300 → 400.00 (не 399.99); 30/45/300 → 200; 90/60/300 → 450; 45/60/300 → 225.
   Warn: один код; 60 vs 45 → longer_not_multiple, не стопка.
   durationParts: 45 → 0ч 45м; 60 → 1ч 0м; 90 → 1ч 30м.
   Скрипт в package.json: "test:personal-tariff-pricing": "tsx scripts/personal-tariff-pricing-check.mjs"
   Прогнать и убедиться, что падает, если подставить IEEE 300*(60/45).

Не делать: UI, миграции, RPC, charges, отчёт выручки, правки JSX кроме типов/mapPrice.
Не копировать roundMoney из rentalBillingProfile на промежуточное price*(a/b).

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §2 инварианты, §3, §6.2
- tangodb/src/lib/scheduleWeek.ts (timeToMinutes)
- tangodb/src/lib/scheduleTime.ts (validateTimeRange)
- tangodb/src/types/index.ts (Price, PersonalLesson, Payment)
- tangodb/src/hooks/usePrices.ts (mapPrice)
- tangodb/scripts/rental-tariff-archive-check.mjs (образец tsx-импорта)
- tangodb/scripts/finance-reports-check.mjs (образец assert)

После изменений: .cursor/docs/ai/changelog.md. Версию 2.8.0 не бампать (это Промпт 9).
```

---

### Промпт 2 — SQL-схема этапа 1

```
Задача: миграция длительности тарифа, price_id на уроке, снимка на платеже, payer_client_id и дебиторки по плательщику. Без UI и без переписывания тела RPC оплаты (это Промпт 3).

Контекст: tangodb_personal_tariff_duration_payments.md §6.1 этап 1 (одна миграция), §4.2 поля платежа, §4.3 один плательщик.

Что сделать:

1. Файл tangodb/supabase/migrations/<NEXT_TIMESTAMP>_personal_tariff_duration.sql
   NEXT_TIMESTAMP — следующий после последней существующей миграции (на 2026-08-16 последняя — 20260916000001).

2. prices.duration_minutes INT NULL
   CHECK (duration_minutes IS NULL OR duration_minutes > 0)
   Backfill не делать (NULL = legacy). Group / single_visit остаются NULL.

3. personal_lessons.price_id UUID NULL
   FK (organization_id, price_id) → prices (organization_id, id) ON DELETE SET NULL
   Не RESTRICT.

4. personal_lessons.payer_client_id UUID NULL
   NULL = client_id1 (legacy)
   CHECK нельзя как payer IN (client_id1..4): NULL-слоты делают IN неизвестным, CHECK пропустит чужого клиента.
   Нужно:
     payer_client_id IS NULL
     OR payer_client_id = client_id1
     OR (client_id2 IS NOT NULL AND payer_client_id = client_id2)
     OR (client_id3 IS NOT NULL AND payer_client_id = client_id3)
     OR (client_id4 IS NOT NULL AND payer_client_id = client_id4)

5. payments (снимок, та же миграция). Колонки payments.price_id сейчас НЕТ (у разовых визитов price_id в single_visits) — это новая колонка, не reuse:
   - price_id UUID NULL, FK (organization_id, price_id) → prices ON DELETE SET NULL
   - tariff_duration_minutes INT NULL
   - tariff_units NUMERIC(12,4) NULL CHECK (tariff_units IS NULL OR tariff_units > 0)
     БЕЗ DEFAULT
   - tariff_price NUMERIC NULL CHECK (tariff_price IS NULL OR tariff_price >= 0)
   - tariff_label TEXT NULL
   - lesson_duration_minutes INT NULL CHECK (lesson_duration_minutes IS NULL OR lesson_duration_minutes > 0)
   Колонку personal_lesson_charge_id в этапе 1 НЕ добавлять (нет таблицы charges). Этап 2 / Промпт 10.
   Тело сторно/correct не переписывать здесь — Промпт 3 обязан скопировать новые колонки в INSERT.

6. Пересоздать/заменить financial_debtors_v (актуальный текст — 20260915000001 + teacher из 20260914000001; сверить оба и взять фактический CREATE OR REPLACE):
   - personal: client_display = имя payer (payer_client_id ?? client_id1), не concat «A & B»
   - добавить payer_client_id, client_id4 в view
   - детали: остальные участники справочно, включая 4-го (quad)
   - долг по-прежнему один на урок (charges нет)
   Исторический pair без payer: долг на client_id1 — ожидаемо, описать в комментарии миграции.

7. Типы/хуки чтения (без новой бизнес-логики кассы):
   - usePrices select включает duration_minutes (mapPrice уже из Промпта 1)
   - usePersonalLessons / map урока: price_id, payer_client_id
   - usePayments PAYMENTS_SELECT: новые колонки снимка
   - DebtorEntry + FINANCIAL_DEBTORS_SELECT: payerClientId, clientId4
   Не менять openPersonalPayment и popup — это Промпты 6–7.

Не делать: тело record_personal_lesson_payment, charges-таблицу, колонку personal_lesson_charge_id, UI форм, отчёт выручки, RLS.
Не пересчитывать исторические personal_lessons.price и не backfill duration_minutes.

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §6.1, §6.5
- tangodb/supabase/migrations/20260915000001_financial_debtors_billed_paid.sql
- tangodb/supabase/migrations/20260914000001_financial_debtors_teacher.sql
- tangodb/supabase/migrations/20260916000001_restate_personal_lesson_amount.sql
- tangodb/src/hooks/useFinancialDebtors.ts
- tangodb/src/lib/financeReports.ts (DebtorEntry)
- tangodb/src/hooks/usePayments.ts (PAYMENTS_SELECT)
- tangodb/src/hooks/usePersonalLessons.ts (map insert/select)

После изменений: changelog.md. Версию не бампать.
```

---

### Промпт 3 — RPC оплаты и restate (этап 1)

```
Задача: одна публичная record_personal_lesson_payment (venue ack + partial/top-up) со снимком тарифа, явным плательщиком и капом остатка; restate обнуляет price_id.

Контекст: tangodb_personal_tariff_duration_payments.md §3.3, §4.4 A/B, §6.1 RPC, «Чего не делать» dual overload.

As-is: UI шлёт p_venue_rule_acknowledged → 5-param wrapper из 530 → _record_personal_lesson_payment_before_venue_rules без partial из 780. 4-param из 780 с partial не получает venue ack.

Что сделать:

1. Миграция <NEXT>_record_personal_lesson_payment_tariff.sql (следующий timestamp после Промпта 2).
   Одна публичная сигнатура:
     p_lesson_id, p_amount, p_method, p_idempotency_key,
     p_venue_rule_acknowledged boolean DEFAULT false,
     p_price_id uuid DEFAULT NULL,
     p_tariff_units numeric DEFAULT NULL,
     p_tariff_duration_minutes int DEFAULT NULL,
     p_tariff_price numeric DEFAULT NULL,
     p_tariff_label text DEFAULT NULL,
     p_lesson_duration_minutes int DEFAULT NULL,
     p_client_id uuid DEFAULT NULL   -- NULL = client_id1 legacy; этап 1 передавать явно
   Без p_charge_id (charges — этап 2).
   Тело: merge venue guard из 530 + partial/top-up/paid_amount из 780 + новое.
   DROP stale 4-param overload и/или _record_personal_lesson_payment_before_venue_rules после того как wrapper вызывает новое тело (как follow-up у record_single_visit). Не оставлять два живых overload.

2. Логика billed (§3.3) внутри RPC:
   - Если у урока уже есть price_id — касса billed НЕ перебивает (платить остаток).
   - Если price_id IS NULL и передан p_price_id (legacy или S5c после restate без платежей) — записать price_id + billed по формуле §3.2 (SQL ROUND numeric, multiply-first), затем платёж.
   - Пакет (subscription_id задан): billed не пересчитывать, price_id не ставить.
   - Режим без тарифа: p_price_id NULL, p_tariff_units NULL; billed не пересчитывать.
   - Кап: p_amount > 0 и p_amount ≤ remaining после синка billed — в RPC для ВСЕХ вызовов, не только UI. Переплату запретить (as-is RPC пропускал). Существующие paid_amount > price не пересчитывать.
   - already_fully_paid — сохранить поведение, если нетто ≥ price.
   - Плательщик: p_client_id, иначе client_id1. Клиент должен быть участником урока (id1…id4). Не игнорировать p_client_id.

3. Снимок на INSERT payments: price_id, tariff_*, lesson_duration_minutes, client_id = плательщик.
   Без тарифа: все tariff_* и price_id NULL, не писать tariff_units = 1.
   Колонки personal_lesson_charge_id нет — не заполнять.
   Обязательно обновить _storno_payment_impl и correct_payment: копировать price_id + tariff_* + lesson_duration_minutes с исходного платежа (сейчас явный INSERT без этих колонок).

3b. update_personal_lesson: принять price_id и payer_client_id в payload; при смене слота пересчитать billed в RPC по §3.3 (не пакет, price_id задан, платежей нет); пакетный путь обнуляет price_id.

4. Идемпотентный fingerprint: lesson, amount, method, venue_ack, price_id, units, client. Charge — в этапе 2. Не сужать старый ключ так, чтобы сломать уже отправленные UUID с клиента.

5. restate_personal_lesson_amount: при успехе обнулить personal_lessons.price_id. Нельзя опустить ниже уже оплаченного (как сейчас). Не смешивать с оплатой по тарифу.

6. tangodb/src/hooks/usePayments.ts — useRecordPersonalLessonPayment:
   передавать p_client_id (сейчас clientId в хуке есть, в RPC не уходит),
   p_price_id, snapshot-поля, p_venue_rule_acknowledged как сейчас.
   Не добавлять прямой insert в payments из клиента.

Не делать: UI popup, charges-таблицу, колонку/параметр personal_lesson_charge_id, отчёт выручки, фильтр педагога.
Не копировать только 4-param из 780 без venue ack.

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §3.2–§3.3, §4.4, §6.1 RPC, §7 «Чего не делать»
- tangodb/supabase/migrations/20260853000001_internal_venue_cost_rules.sql (5-param wrapper)
- tangodb/supabase/migrations/20260878000001_custom_amount_payments.sql (4-param partial)
- tangodb/supabase/migrations/20260840000001_payment_attendance_corrections.sql (_storno_payment_impl, correct_payment)
- tangodb/supabase/migrations/20260846000001_can_edit_past_schedule.sql (update_personal_lesson)
- tangodb/supabase/migrations/20260916000001_restate_personal_lesson_amount.sql
- tangodb/src/hooks/usePayments.ts (useRecordPersonalLessonPayment)
- follow-up record_single_visit (как образец схлопывания overload) — найди актуальное определение через codegraph / миграции

После изменений: changelog.md. Версию не бампать.
```

---

### Промпт 4 — UI прайса: длительность (этап 1)

```
Задача: при создании/правке тарифа персонального урока обязательно указать длительность. Пакетный private — то же поле = длительность одного занятия пакета, в кассу пакета не входит.

Контекст: tangodb_personal_tariff_duration_payments.md §6.1 этап 1 prices, §6.3 строка «Прайс», критерии этапа 1 п.1.

Что сделать:

1. Форма создания/правки personal lesson (разовый, lessons = 1) в tangodb/src/components/PricesPanel.tsx:
   - поле «Длительность тарифа»: пресеты 30 / 45 / 60 / 90 + своё целое > 0
   - AppSelect + i18n
   - нельзя сохранить новый персональный тариф без duration_minutes > 0
   - legacy (duration NULL): в редакторе явно «указать длительность»; сохранение без длительности для СТАРОГО тарифа допустимо (остаётся legacy), но UI рекомендует заполнить. Новый — обязателен.
   - предупреждение, если по этому price_id есть неоплаченные уроки: «N неоплаченных уроков»; платежи и неоплаченные billed при правке тарифа НЕ пересчитывать и не batch-update

2. tangodb/src/components/ui/CreatePrivatePackageTariffModal.tsx:
   то же поле duration_minutes = длительность одного занятия пакета (для слота списания / warn). Не в кассу пакета.
   Форматы пакета: solo / pair / trio (PrivatePackageFormat). Quad только у разового personal_quad — не добавлять quad в пакет.

3. useCreatePrice / useUpdatePrice — писать duration_minutes. Group / single_visit не отправлять длительность (NULL).

4. Подпись тарифа в списках: где уместно показать длительность через i18n durationParts из Промпта 1 (не хардкод «45 мин» в JSX).

Не делать: кассу, продажу, дебиторку, charges, автоподгон слота под тариф.
Не использовать rental_tariffs.

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §6.1 prices, §6.3, §5 S7
- tangodb/src/components/PricesPanel.tsx (создание personal_solo/pair/trio/quad ~строка 480)
- tangodb/src/components/ui/CreatePrivatePackageTariffModal.tsx
- tangodb/src/hooks/usePrices.ts
- tangodb/src/lib/orgModules.ts (PrivatePackageFormat)
- tangodb/src/lib/personalTariffPricing.ts
- .cursor/docs/ai/design_system.md (если меняешь отступы/поля)

После изменений: changelog.md. Версию не бампать.
```

---

### Промпт 5 — продажа и запись урока (этап 1)

```
Задача: при создании персонального урока сразу писать price_id и billed из слота; select плательщика при 2+; прокинуть teacherMemberId в фильтр тарифов; баннер длительности.

Контекст: tangodb_personal_tariff_duration_payments.md §3.3, §3.4, §4.3, §5 S1–S5 S11, S12–S13, §6.3 SaleForm.

As-is: customPrice редактируется; filterPrivateLessonTariffsForSale не принимает teacherMemberId; формы зовут обёртку только с площадкой + дисциплиной; при открытии ячейки computeAutoTimeEnd(prefill.timeStart, []) — всегда +60, без обрезки; обрезка до следующего урока площадки только при смене timeStart. Не подгонять конец слота под тариф в v1.

Что сделать:

1. tangodb/src/lib/utils.ts — filterPrivateLessonTariffsForSale: добавить teacherMemberId?: string | null в options и прокинуть в filterTariffsForSale. То же для вызовов в SaleForm и (если уже есть) PayPersonalLessonModal — педагог обязан участвовать в фильтре.

2. tangodb/src/components/personal-lessons/PersonalLessonSaleForm.tsx и обёртка AddPersonalLessonForm:
   - основа суммы = billedFromTariff(tariff.price, lessonMinutes, tariff.durationMinutes), поле суммы по тарифу не редактируемое как основа (не customPrice)
   - писать price_id на каждую создаваемую запись
   - серия «повторять еженедельно»: КАЖДАЯ запись — свой price_id и billed из ДЛИТЕЛЬНОСТИ ЭТОГО слота (S11). Не одна сумма на серию
   - баннер durationWarning — одно сообщение по приоритету §3.4, не три баннера. Warn, не hard-block (кроме §3.4 hard-block)
   - при 2+ клиентах обязательный select плательщика (дефолт — первый выбранный клиент). Писать payer_client_id. Не молчать в client_id1, если выбран B (S13)
   - solo: UI режима скрыт, payer = единственный клиент
   - пакет: как сейчас price = 0 / paid = yes, cash-строки нет; price_id на уроке NULL (не писать тариф). Гибрид пакет+cash не делать (S17)
   - legacy-тариф без duration: billed = prices.price, warn legacy_no_duration (S7)
   - слот из ячейки при открытии всегда 60 мин (потолок 23:45), даже при тарифе 45 — warn «длиннее тарифа» это норма, не баг; computeAutoTimeEnd не менять под тариф

3. useAddPersonalLessons: INSERT price_id, payer_client_id, price = billed. Не считать billed в JSX — только из lib.

4. Смена времени в этой форме до сохранения — пересчёт billed (платежей ещё нет).

5. i18n длительности и warn-текстов. Плательщик остаётся в карточке урока как участник; второго не скрывать из расписания / посещаемости / Google Calendar.

Не делать: третий popup оплаты; charges/split поровну; hard-block на любую длительность ≠ тарифу; пакет из дебиторки; автоподгон time_end под duration тарифа.

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §3, §4.3, §5.1 S1–S5 S7 S11, §5.2 S12–S13 S17, §6.3
- tangodb/src/components/personal-lessons/PersonalLessonSaleForm.tsx
- tangodb/src/components/schedule/AddPersonalLessonForm.tsx
- tangodb/src/hooks/usePersonalLessons.ts (useAddPersonalLessons)
- tangodb/src/lib/utils.ts (filterPrivateLessonTariffsForSale, filterTariffsForSale)
- tangodb/src/lib/personalTariffPricing.ts
- tangodb/src/lib/scheduleTime.ts (computeAutoTimeEnd)

После изменений: changelog.md. Версию не бампать.
```

---

### Промпт 6 — касса: два денежных режима (этап 1)

```
Задача: PayPersonalLessonModal — режимы tariff | outstanding | package вместо смешанного single | package. Не плодить третий popup: те же режимы из расписания, журнала посещений, /personal, дебиторки.

Контекст: tangodb_personal_tariff_duration_payments.md §4.4 A/B, §5 S8 S10 S10b S10c, §6.3 modal, критерии 6–7.

As-is: режимы single/package; outstanding ставит presetPaymentAmount + режим single (сумма = остаток). tariff preset не ставит, режим null; клик «разовый» → applyLessonTariff перебивает сумму tariff.price, не остатком. Подбор тарифа find(t => t.price === lesson.price). В target нет teacherMemberId / clientId4 / payerClientId / priceId; paidAmount уже опционален — финансы (2.7.25+) передают billed+paidAmount, расписание нет. ScheduleDebtorsBlock передаёт price = остаток (или 0 у teacher), без paidAmount. DebtorEntry.teacherMemberId уже есть — прокинуть.

Что сделать:

1. PayPersonalLessonTarget:
   - teacherMemberId, clientId4, payerClientId, priceId (урока)
   - явный paymentMode: 'tariff' | 'outstanding' | 'package' (package только не из дебиторки)
   Callers обновить: FinanceDebtorsPage, ScheduleDebtorsBlock (сейчас price = остаток, без paidAmount), AttendancePanel, PersonalLessonsPageContainer, LessonInfoPopup и остальные из blast radius codegraph.
   В target также paidAmount (нетто), не подменять billed остатком.

2. Режим A «оплата по тарифу»:
   - плательщик: select если 2+ участников; значение по умолчанию = payerClientId ?? clientId1
   - тариф: показывать из price_id урока, если задан; не подбирать по price === lesson.price
   - если прайс архивный — всё равно показать по price_id (usePrices = только active)
   - LOCK смены тарифа — только если по уроку уже есть платежи (S10c); price_id без платежей — тариф можно сменить
   - если price_id нет и платежей нет — оператор выбирает тариф; billed пишется по §3.3 (в т.ч. S5c после restate)
   - если price_id нет и платежи есть (restate после частичной оплаты) — режим A скрыть, только B
   - сумма LOCK = остаток долга (не всегда полный billed: топ-ап = остаток, S10b)
   - пакета нет
   - баннер длительности (один, §3.4)
   - снимки на платеже: price_id, units_snap, duration, tariff_price, tariff_label, lesson_duration_minutes
   - сумма > 0 и ≤ остатка, hard-block переплаты
   - bookingClientsMatchSubscription: передать clientId4 (поле в target; пакет quad в v1 всё равно нет)

3. Режим B «оплата текущей суммы»:
   - пакета нет, тарифа нет: price_id и tariff_units NULL
   - начисление не пересчитывать
   - сумма из остатка, можно уменьшить, нельзя > остатка и нельзя ≤ 0
   - способ оплаты есть
   - в UI не показывать «×1»

4. Режим package — только из расписания / персональных, скрыть если открыто из дебиторки.

5. filterPrivateLessonTariffsForSale(..., { locationId, disciplineId, teacherMemberId }).

6. Хук useRecordPersonalLessonPayment — все новые поля RPC (Промпт 3), включая p_client_id = выбранный плательщик.

Не делать: charges; открытие пакета из дебиторки; свободный коэффициент; новый третий modal-файл; переплату.

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §3.3, §4.4, §5 S6 S8 S10* S18
- tangodb/src/components/schedule/PayPersonalLessonModal.tsx
- tangodb/src/hooks/usePayments.ts
- tangodb/src/pages/FinanceDebtorsPage.tsx (openPersonalPayment)
- tangodb/src/lib/utils.ts (bookingClientsMatchSubscription, filterPrivateLessonTariffsForSale)
- tangodb/src/lib/personalTariffPricing.ts

После изменений: changelog.md. Версию не бампать.
```

---

### Промпт 7 — дебиторка по плательщику (этап 1)

```
Задача: строка дебиторки персонального урока — на плательщике, не «A & B». Оплата из дебиторки открывается на должнике. Длительность слота видна. Две кнопки оплаты + переоценка как сейчас.

Контекст: tangodb_personal_tariff_duration_payments.md §4.1, §5 S12–S13 S16 S18, критерии 5–7.

As-is: openPersonalPayment требует clientId1 и не знает payer; FINANCIAL_DEBTORS_SELECT без client_id4 / payer (teacher_member_id уже есть); tariff не ставит preset — после клика «разовый» сумма = цена тарифа; outstanding ставит preset. ScheduleDebtorsBlock: price = остаток, без paidAmount.

Что сделать:

1. View уже из Промпта 2. Добить UI:
   - DebtorEntry / mapFinancialDebtor: payerClientId, clientId4 (если ещё не дотянуто)
   - client_display уже имя payer — проверить, что страница не склеивает id1–id3 поверх view
   - детали персонального: «с Петровым» / остальные участники, включая 4-го

2. FinanceDebtorsPage.openPersonalPayment:
   - не требовать, чтобы payer == clientId1
   - передавать payerClientId, clientId4, teacherMemberId (уже на DebtorEntry), priceId, billed (не остаток как price), paidAmount, timeStart/timeEnd
   - mode tariff → PayPersonalLessonModal paymentMode='tariff' (сумма lock = остаток внутри modal, не «забыть preset»)
   - mode outstanding → paymentMode='outstanding'
   - пакет из дебиторки не открывать

3. Длительность урока в строке/деталях дебиторки через i18n durationParts (из слота time_start/time_end, колонки минут на уроке нет).

4. AdjustDebtorAmountDialog остаётся переоценкой (C), не кассой. После restate (Промпт 3) price_id уже NULL — UI не должен снова включать тарифный пересчёт.

5. ScheduleDebtorsBlock — тот же контракт target: billed + paidAmount, не price = entry.amount; прокинуть teacherMemberId / clientId4 / payerClientId.

Не делать: split charges; менять payroll; блок выручки по тарифам.

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §4, §5.2, §6.3 дебиторка
- tangodb/src/pages/FinanceDebtorsPage.tsx
- tangodb/src/hooks/useFinancialDebtors.ts
- tangodb/src/lib/financeReports.ts (DebtorEntry, formatDebtorDetail)
- tangodb/src/components/schedule/ScheduleDebtorsBlock.tsx
- tangodb/src/components/finance/AdjustDebtorAmountDialog.tsx
- tangodb/src/components/schedule/PayPersonalLessonModal.tsx (контракт из Промпта 6)

После изменений: changelog.md. Версию не бампать.
```

---

### Промпт 8 — журнал и смена времени (этап 1)

```
Задача: в журнале платежей у персонального видны длительность, тариф/единицы; смена слота пересчитывает billed только по §3.3; после оплаты — warn без автопересчёта.

Контекст: tangodb_personal_tariff_duration_payments.md §3.3, §5 S5 S5b S6 S20, §6.3 журнал / редактирование.

Что сделать:

1. Журнал tangodb/src/pages/FinancePaymentsPage.tsx (раскрытая строка персонального):
   - клиент = чей долг (payments.client_id)
   - длительность урока: снимок lesson_duration_minutes, иначе из слота
   - тариф или «без тарифа»
   - единицы «×2» ТОЛЬКО если есть тариф и tariff_units; legacy без price_id — «без тарифа», без выдуманного ×1
   - tooltip единиц (клик сразу, hover ~0.5 с): «сколько квантов тарифа в длительности урока; задаётся длительностью тарифа в прайсе, не вручную»
   - i18n, не хардкод

2. PAYMENTS_SELECT / тип Payment — поля снимка (если Промпт 2 ещё не дотянул в журнал).

3. Edit popup персонального урока (EditLessonPopup / связанный поток):
   - смена time_start/time_end при заданном price_id и отсутствии платежей: пересчитать billed (S5) — в RPC update_personal_lesson, не только в JSX
   - после restate price_id NULL: billed не трогать при смене слота (S5b)
   - платежи уже есть: billed не трогать, warn в edit-popup (S6). Длительность слота менять можно
   - пакет (subscription_id): billed не трогать, price_id не ставить
   - эвристика price === tariff.price ЗАПРЕЩЕНА
   - payload update_personal_lesson: price_id, payer_client_id

4. Смена состава урока: payer обязан остаться в {client_id1…4}. Если плательщика убрали — потребовать нового, не молча падать на client_id1.

Не делать: batch-update неоплаченных при правке тарифа; суммирование tariff_units; charges; отчёт выручки.

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §3.3, §5 S5 S5b S6 S20, инвариант 4
- tangodb/src/pages/FinancePaymentsPage.tsx
- tangodb/src/hooks/usePayments.ts
- tangodb/src/components/schedule/EditLessonPopup.tsx
- tangodb/src/hooks/usePersonalLessons.ts (useUpdatePersonalLesson)
- tangodb/src/lib/personalTariffPricing.ts

После изменений: changelog.md. Версию не бампать.
```

---

### Промпт 9 — закрытие этапа 1

```
Задача: зафиксировать подверсию 2.8.0, SQL-тесты RPC/view, прогнать JS-тесты формул, сверить критерии готовности этапа 1.

Контекст: tangodb_personal_tariff_duration_payments.md §7 Тесты, §9 этап 1 п.1–9, VER-1 в decision_log.md.

Что сделать:

1. Версия: tangodb/src/lib/appVersion.ts и tangodb/package.json → 2.8.0 (одинаково). Строка в changelog.md: подверсия 2.8 = персональный тариф с длительностью, автосумма, два режима кассы, payer. В decision_log.md — короткая запись к VER-1 / PL-TARIFF-0 что 2.8 открыта.

2. JS: npm run test:personal-tariff-pricing (Промпт 1). Обязательно 60/T45/300 → 400.00.

3. SQL-тесты (как принято в проекте для RPC — отдельный sql/скрипт или существующий harness; не полагаться только на UI):
   - record_personal_lesson_payment с price_id, units, client_id ≠ client_id1
   - already_fully_paid
   - кап остатком (amount > remaining → ошибка)
   - venue ack по-прежнему работает на той же функции
   - debtor view: client_display = payer, не concat, если payer задан
   - quad: 4-й клиент виден в деталях, не теряется

4. Чеклист §9 этапа 1 (проставь явно в changelog или в ответе, что закрыто / что дырка):
   1. Новый персональный тариф нельзя сохранить без длительности
   2. 90 мин + T45/300 → price_id, в дебиторке 600
   3. 30 мин + тот же тариф → warn и 200.00, оплату не блокирует
   4. 60 мин + T45/300 → 400.00 не 399.99
   5. Pair+: плательщик A → в дебиторке только A; оплата из дебиторки на A, даже если A не client_id1
   6. «По тарифу»: сумма lock = остаток, нет пакета, price_id на платеже, тариф не по равенству цены
   7. «Текущая сумма»: нет пакета и тарифа, сумма из долга вниз, есть способ оплаты
   8. Журнал: длительность и тариф/единицы; legacy — «без тарифа»
   9. Формулы в lib/, SQL-тесты RPC

5. Если нашёл дырку этапа 1 — исправь точечно, не начинай этап 2.

Не делать: charges, выручку по тарифам, гибрид пакет+cash, RLS.

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §7 Тесты, §9 этап 1, «Чего не делать»
- tangodb/src/lib/appVersion.ts
- tangodb/package.json
- .cursor/docs/ai/decision_log.md (VER-1)
- .cursor/docs/ai/changelog.md
```

---

### Промпт 10 — этап 2: charges и split «поровну»

```
Задача: несколько начислений на один урок (personal_lesson_charges). Режим «поровну». Платёж A не закрывает charge B.

Запускать ТОЛЬКО если студии реально делят пару 50/50. Иначе остановиться и написать это в ответе, код не менять.

Контекст: tangodb_personal_tariff_duration_payments.md §4.2–§4.3, §5 S14–S15, §6.1 этап 2, §9 п.10.

Что сделать:

1. Таблица personal_lesson_charges по §4.2:
   UNIQUE (organization_id, id), UNIQUE (organization_id, personal_lesson_id, client_id)
   paid_amount не хранить — считать из payments
   client_id — участник урока
   RLS как у personal_lessons/payments: organization_id, business_row_readable, write через SECURITY DEFINER RPC. SELECT — operational + financial read. Суммы — как payments. Прямой insert из клиента запрещён.

2. FK payments.personal_lesson_charge_id → charges. Для НОВЫХ персональных платежей после этого этапа — NOT NULL. Старые строки остаются NULL. Не backfill-ить NOT NULL на историю без charge.

3. RPC создания урока создаёт 1..N charge:
   - solo / «один плательщик»: один charge на payer
   - «поровну»: splitBilledEqually, остаток копеек на первого выбранного плательщика
   Тариф считает урок, split только режет. Не пересчитывать «долю A» отдельно от длительности.

4. sync_personal_lesson_paid_status — по сумме charge. personal_lessons.price = сумма billed всех charge (денормализация), синхронизировать RPC. Не единственный источник долга.

5. financial_debtors_v: UNION personal из charges с остатком > 0. Одна строка на unpaid charge, client_display = должник.

6. Оплата: один платёж не закрывает чужой charge. «A принёс за B» → платёж на charge B, в журнале клиент B, комментарий «оплатил Иванов» (S15).

7. Сторно — с привязкой к charge.

8. restate: только если charge один. Split+restate не смешивать (отдельное решение, не в этом промпте).

9. payer_client_id не держать как второй источник истины: один charge из payer, затем колонку не использовать как источник (кэш или drop в follow-up). Не параллелить payer и charges.

10. Payroll не менять: по-прежнему % от строк payments, не от price урока (S21).

11. Версия: микропатч 2.8.y (следующий после текущего 2.8.x). Если split расползся на payroll/restatement — остановиться и спросить, не маскировать отдельным x молча.

12. Критерий: поровну → две строки дебиторки; платёж A не закрывает charge B.

Не делать: гибрид пакет+cash (этап 3+ / S17); свободные ручные доли, если не понадобились отдельно; отчёт выручки (Промпт 11).

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §4.2–§4.4, §5.2 S14–S17, §6.1 этап 2, §6.4, §8 Restate+split
- актуальные RPC создания урока и record_personal_lesson_payment (после этапа 1)
- tangodb/src/lib/personalTariffPricing.ts (splitBilledEqually)
- tangodb/src/lib/payrollAccrual.ts
```

---

### Промпт 11 — этап 3: выручка по тарифам

```
Задача: блок «Персональные: по тарифам» в Финансы → Выручка за выбранный месяц.

Запускать после того как price_id стабильно пишется на новых платежах (этап 1 закрыт). Иначе месяц будет весь «без тарифа».

Контекст: tangodb_personal_tariff_duration_payments.md §5.3 S19, §6.1 этап 3, §6.3 Выручка, §9 п.11.

Что сделать:

1. Агрегация в tangodb/src/lib/financeReports.ts и/или view personal_tariff_sales_v:
   period,
   ключ строки = price_id ?? снимок (tariff_label + tariff_price + tariff_duration_minutes) ?? «без тарифа»
   (не группировать только по price_id: после DELETE прайса колонка SET NULL, снимок на платеже жив),
   count_payments_net — операции нетто (сторно уменьшает count на 1),
   sum_net — amount со знаком по operation_kind
   Только personal_lesson_id IS NOT NULL. Пакеты не попадают (нет payment row).
   Абонементы, разовые, аренда в этот блок не входят.
   Сторно без скопированного снимка сломает S19 — снимок должен уже копироваться с этапа 1.

2. НЕ суммировать tariff_units. Топ-ап 400+200 по одному уроку = 2 платежа; оба могут нести units_snap = 2 — в агрегат единиц не складывать.

3. UI: tangodb/src/pages/FinanceRevenuePage.tsx — таблица тарифов + строка «без тарифа» (платежей нетто и сумма нетто) за выбранный месяц.
   На FinancialDashboard достаточно текущего personalTotal, без разбивки.

4. S19 как приёмочный пример:
   3 платежа T45 на 600+300+300, 1 без тарифа 500, 1 сторно T45 −300
   → T45: count 2, sum 900; без тарифа: count 1, sum 500.

5. Тест: расширить finance-reports-check.mjs или отдельный personal-tariff-sales-check.mjs (предпочтительно импорт реальной функции).

6. Версия: микропатч 2.8.y. changelog.md.

Не делать: тащить разбивку на дашборд; считать «уроки» вместо нетто-операций; включать пакеты.

Прочитай сначала:
- tangodb_personal_tariff_duration_payments.md §5.3 S19, §6.1 этап 3, инварианты 2–3
- tangodb/src/pages/FinanceRevenuePage.tsx
- tangodb/src/lib/financeReports.ts
- tangodb/src/components/FinancialDashboard.tsx (не добавлять туда таблицу)
- tangodb/scripts/finance-reports-check.mjs
```
