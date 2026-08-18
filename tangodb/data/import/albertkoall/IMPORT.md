# Импорт данных albertkoall@gmail.com

Файл `tangodb_export.json` — legacy GAS / Google Sheets, готов к `import-org.mjs`.

## Сводка

| Сущность | Строк |
|----------|------:|
| clients | 10 (+4 stub при импорте) |
| schedule | 4 |
| prices | 9 |
| subscriptions | 10 |
| attendance | 58 |
| personalLessons | 33 |

## Что такое UUID организации

**UUID** — уникальный идентификатор вашей CRM-базы в Supabase. Выглядит так:

`a1b2c3d4-e5f6-7890-abcd-ef1234567890`

Он нужен скрипту импорта, чтобы записать клиентов и абонементы **в вашу** студию, а не в чужую.

### Где взять (3 способа)

**1. Dev Console (проще всего, если есть доступ)**

1. Откройте [tangodb-dev-console](https://tangodb-dev-console.vercel.app) и войдите как `albertkoall@gmail.com`.
2. Раздел **Tenants** (Orgs).
3. В поиске введите `albertkoall@gmail.com` → **Search**.
4. UUID org — поле `id` в ответе API (в таблице пока не выводится; можно открыть DevTools → Network → запрос `dev-console-list-tenants` → в JSON у tenant `id`).

**2. Supabase Dashboard**

1. [supabase.com](https://supabase.com) → ваш проект → **SQL Editor**.
2. Выполните:

```sql
SELECT o.id, o.name, o.status, u.email
FROM auth.users u
JOIN organization_members om ON om.user_id = u.id AND om.role = 'owner'
JOIN organizations o ON o.id = om.organization_id
WHERE u.email = 'albertkoall@gmail.com';
```

3. Скопируйте значение колонки `id` — это и есть `--org-id`.

**3. Если org ещё нет**

Зарегистрируйтесь в CRM (`albertkoall@gmail.com`), пройдите verify-email / demo onboarding — создастся организация. Затем UUID возьмите способом 1 или 2.

## Импорт

1. `SUPABASE_URL` и `SUPABASE_SERVICE_KEY` в `tangodb/.env.local` или `.env.migrate`.
2. Dry-run:

```bash
cd tangodb
npm run import:org:dry-run -- --org-id <ORG_UUID> --input data/import/albertkoall/tangodb_export.json --slug albertkoall --default-discipline "Танго"
```

3. Запись:

```bash
npm run import:org -- --org-id <ORG_UUID> --input data/import/albertkoall/tangodb_export.json --slug albertkoall --default-discipline "Танго" --default-location-name "Miami studio"
```

## Принятые решения

- Дисциплина для расписания: **Танго**
- 4 клиента без листа Clients → заглушки «Удалён (ID …)»
- Фамилии «Неизвестно» → пустая строка в JSON
- Абонемент `177946661635351` — оставлен как в исходной таблице

## Повторная конвертация из xlsx

```bash
py scripts/xlsx-to-export.py "path/to/TangoDB.xlsx" --output data/import/albertkoall/tangodb_export.json
```

## Импорт из Google Calendar (ICS)

См. [CALENDAR_IMPORT.md](./CALENDAR_IMPORT.md) — индивидуальные занятия (бальные + танго) с 2025-09-01.

```bash
node scripts/ics-to-personal-lessons.mjs "path/to/calendar.ics" --since 2025-09-01 --out data/import/albertkoall/calendar_personal_lessons.json
npm run import:calendar:dry-run -- --org-id <ORG_UUID> --input data/import/albertkoall/calendar_personal_lessons.json --default-location-name "Miami studio"
npm run import:calendar -- --org-id <ORG_UUID> --input data/import/albertkoall/calendar_personal_lessons.json --default-location-name "Miami studio"
```
