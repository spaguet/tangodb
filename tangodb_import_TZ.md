# TangoDB — Import Pipeline (v2)

**Версия:** 1.0  
**Дата:** 2026-06-18  
**Связанные документы:** [tangodb_saas_platform_TZ.md](./tangodb_saas_platform_TZ.md) §12, [tangodb_migration_TZ.md](./tangodb_migration_TZ.md) §13

---

## 1. Назначение

Импорт данных организации в greenfield v2 Supabase из внешней CRM. Скрипт `tangodb/scripts/import-org.mjs` запускается **локально или в CI** с `SUPABASE_SERVICE_KEY` — не из frontend.

Поддерживаемые форматы:

| Формат | Файл | Источник |
|--------|------|----------|
| **legacy-gas** | `tangodb_export.json` | Google Apps Script `exportAllData()` (v1 Sheets) |
| **v2-json** | `org_export.json` | Расширенный JSON с UUID-колонками (round-trip / будущий full export) |

---

## 2. CLI

```bash
cd tangodb

# Валидация без записи в БД
npm run import:org:dry-run -- --org-id <UUID> --input ./tangodb_export.json --slug my-school

# Запись в целевую org
npm run import:org -- --org-id <UUID> --input ./tangodb_export.json --slug my-school

# Продолжить после сбоя (mapping на диске)
npm run import:org -- --org-id <UUID> --input ./tangodb_export.json --slug my-school --resume-from subscriptions
```

**Env:** `SUPABASE_URL` (или `VITE_SUPABASE_URL`), `SUPABASE_SERVICE_KEY` (service role).

**Mapping file:** `.import-mappings/{slug}.json` — persistent `old_id → new_uuid` для resume.

---

## 3. Порядок импорта

1. `organization_settings` (только v2-json с блоком `settings`)
2. `locations`
3. `disciplines`
4. `classes` + `class_teachers`
5. `clients`
6. `prices`
7. `schedule_slots`
8. `subscriptions`
9. `attendance`
10. `personal_lessons`

Legacy GAS пропускает шаги 1–4 (нет данных); опционально `--default-discipline "Tango"` создаёт одну дисциплину для FK.

---

## 4. Mapping: legacy-gas → v2

### 4.1. Корневая структура JSON

```json
{
  "clients": [],
  "schedule": [],
  "prices": [],
  "subscriptions": [],
  "attendance": [],
  "personalLessons": []
}
```

### 4.2. clients

| GAS (PascalCase) | v2 column | Transform |
|------------------|-----------|-----------|
| `ID` | `id` | TEXT → новый UUID; ключ в mapping `clients.{oldId}` |
| `FirstName` | `first_name` | trim; default `—` |
| `LastName` | `last_name` | trim; default `—` |
| `Telegram` | `telegram` | default `''` |
| — | `organization_id` | CLI `--org-id` |
| — | `archived_at` | NULL (активный) |

**Stub clients:** если subscription/personal ссылается на ID, отсутствующий в листе Clients — создаётся stub «Удалён (ID …)» (как в v1 `migrate.mjs`).

### 4.3. prices

| GAS | v2 | Transform |
|-----|-----|-----------|
| `Type` | `type` | trim |
| `Lessons` | `lessons` | int ≥ 1 |
| `Price` | `price` | numeric |
| — | `category` | `group` если type ∈ `solo,pair_m1,pair_m2,pair_m3,pair_hm`; иначе `private` |
| — | `organization_id` | `--org-id` |

Mapping key: `{type}|{lessons}` → UUID.

**CHECK v2:** group types — `solo`, `pair_m1`…`pair_hm`; private — `personal_solo`, `personal_pair`, `personal_trio`.

### 4.4. schedule → schedule_slots

| GAS | v2 | Transform |
|-----|-----|-----------|
| `DayOfWeek` | `day_of_week` | 1–7 |
| `Time` | `time` | HH:MM |
| — | `time_end` | default `21:00` |
| — | `discipline_id` | NULL или `--default-discipline` UUID после создания discipline |
| — | `organization_id` | `--org-id` |

Unique: `(org, dow, time)` без discipline или `(org, dow, time, discipline_id)`.

### 4.5. subscriptions

| GAS | v2 | Transform |
|-----|-----|-----------|
| `ID` | `id` | TEXT → UUID mapping |
| `Type` | `type` | `solo` / `pair` / `pair_hm` |
| `ClientID1/2/3` | `client_id1/2/3` | remap через mapping clients |
| `LessonsTotal` | `lessons_total` | int ≥ 1 |
| `LessonsLeft` | `lessons_left` | int |
| `FreezeUsed` | `freeze_used` | int ≥ 0 |
| `ActivationDate` | `activation_date` | `formatDate()` → YYYY-MM-DD |
| `Status` | `status` | `active` / `finished` |
| `PairMonth` | `pair_month` | `m1`/`m2`/`m3` или `''` |
| — | `category` | always `group` для GAS |
| — | `discipline_id` | optional v2-json; legacy NULL |
| — | `price_id` | optional backfill по type+lessons_total |

**Constraints:** `pair` требует `pair_month ∈ {m1,m2,m3}` и `client_id2`; `pair_hm` → `pair_month=''`.

### 4.6. attendance

| GAS | v2 | Transform |
|-----|-----|-----------|
| `Date` | `date` | YYYY-MM-DD |
| `SubscriptionID` | `subscription_id` | remap subscriptions |
| `ClientDisplay` | `client_display` | as-is |
| `AttendanceStatus` | `attendance_status` | `present` / `absent` / `freeze` |

Unique: `(organization_id, date, subscription_id)`.

### 4.7. personalLessons

| GAS | v2 | Transform |
|-----|-----|-----------|
| `ID` | `id` | TEXT → UUID |
| `Type` | `type` | `solo` / `pair` / `trio` |
| `Client1` или `ClientID1` | `client_id1` | remap (оба варианта поля) |
| `Client2` / `ClientID2` | `client_id2` | |
| `Client3` / `ClientID3` | `client_id3` | |
| `Date` | `date` | YYYY-MM-DD |
| `Price` | `price` | numeric |
| `Paid` | `paid` | `yes` / `no` |
| — | `time_start` / `time_end` | default `14:00` / `15:00` (legacy без времени) |
| — | `subscription_id` | NULL (legacy) |

---

## 5. Mapping: v2-json (round-trip)

Расширенный формат для полного экспорта org (будущий `exportOrgJson`):

```json
{
  "version": 2,
  "settings": { "locale": "ru-RU", "currency_code": "VND", ... },
  "locations": [{ "externalId": "loc1", "name": "Зал A", "address": "" }],
  "disciplines": [{ "externalId": "d1", "name": "Tango" }],
  "classes": [{ "externalId": "c1", "name": "Beginners", "disciplineExternalId": "d1" }],
  "clients": [{ "externalId": "x", "first_name": "...", "last_name": "..." }],
  "prices": [{ "externalId": "p1", "type": "solo", "lessons": 8, "price": 2100000, "category": "group" }],
  "schedule_slots": [{ "externalId": "s1", "day_of_week": 1, "time": "19:00", "disciplineExternalId": "d1" }],
  "subscriptions": [{ "externalId": "sub1", "type": "solo", "clientExternalIds": ["x"], ... }],
  "attendance": [...],
  "personal_lessons": [...]
}
```

Поля `externalId` — stable keys для mapping; snake_case для v2 columns.

---

## 6. Validation report (dry-run)

Скрипт выводит JSON-отчёт:

| Check | Severity |
|-------|----------|
| attendance → unknown subscription | error |
| subscription → unknown client | error (stub создаётся — info) |
| duplicate attendance (date+sub) | error |
| invalid subscription type/status/lessons | error |
| invalid personal lesson type/paid | error |
| duplicate active client name (last+first) | error |
| unknown price type for category | error |
| invalid date format | error |
| numeric ID precision loss | warning |
| org not found in DB | error (при подключении) |

Exit code: `0` если нет errors, иначе `1`.

---

## 7. Rollback plan

1. **До apply:** `--dry-run` + сохранить отчёт.
2. **После частичного apply:** mapping содержит `completedSteps` — не повторять успешные шаги при `--resume-from`.
3. **Полный откат:** `DELETE FROM organizations WHERE id = :org_id` cascade удалит tenant data (только на staging/test org).
4. **Prod:** импорт только в новую org; не перезаписывать существующую без бэкапа.

---

## 8. Checksums (post-apply)

Сравнить counts источника и БД:

```sql
SELECT 'clients' AS t, count(*) FROM clients WHERE organization_id = :org
UNION ALL SELECT 'subscriptions', count(*) FROM subscriptions WHERE organization_id = :org
-- ...
```

Скрипт при `--apply` печатает итоговые counts.

---

## 9. Файлы

| Path | Назначение |
|------|------------|
| `tangodb/scripts/import-org.mjs` | Orchestrator |
| `tangodb/scripts/lib/import-mapping.mjs` | Persistent ID map |
| `tangodb/scripts/lib/import-validate.mjs` | Dry-run validation |
| `tangodb/scripts/lib/import-common.mjs` | Env, dates, batch upsert |
| `tangodb/scripts/fixtures/minimal-export.json` | CI/staging dry-run fixture |
| `.import-mappings/*.json` | Per-org maps (gitignored) |
