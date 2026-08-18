# Импорт индивидуальных занятий из Google Calendar

Источник: `albertkoall@gmail.com.ics`  
Период: с **2025-09-01** (Asia/Bangkok, UTC+7)

## Сводка

| Категория | Занятий |
|-----------|--------:|
| Бальные индивидуальные | 1131 |
| Танго индивидуальные | 146 |
| Биомеханика танца (вкл. сальса индив с Лизой) | 246 |
| — из них «Сальса - индив Лиза» | 13 |
| СФП | 111 |
| **Итого к импорту** | **1626** |

Дисциплина **Сальса** отдельно не создаётся: индивы с Лизой идут под **Биомеханика танца**.

## Конфликты расписания

| Статус | Кол-во |
|--------|-------:|
| Авто-разрешено (дубли одного клиента / UID) | 7 |
| Ручные решения (`calendar_manual_resolutions.json`) | 8 убрано, 5 сдвигов времени |
| **Нерешённых** | **0** |

Файлы: `calendar_manual_resolutions.json`, `calendar_overlap_resolved.json`, `calendar_conflicts.json`

## Дисциплины для CRM (4)

1. Танго  
2. Бальные танцы  
3. Биомеханика танца  
4. СФП  

## Команды

```bash
cd tangodb
node scripts/ics-to-personal-lessons.mjs "path/to/calendar.ics" \
  --since 2025-09-01 --out data/import/albertkoall/calendar_personal_lessons.json

npm run import:calendar:dry-run -- \
  --org-id <ORG_UUID> \
  --input data/import/albertkoall/calendar_personal_lessons.json \
  --default-location-name "Miami studio"
```

UUID организации — см. [IMPORT.md](./IMPORT.md).
