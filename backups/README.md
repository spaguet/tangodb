# Резервные копии production БД (tangodb / `gizfpiujqjwbjtqfstbj`)

## Статус на 2026-09-16

| Попытка | Результат |
|--------|-----------|
| `npx supabase db dump --linked` | Требует **Docker Desktop** (CLI гоняет `pg_dump` в контейнере). |
| `npx supabase backups list` | Платформенных снимков **нет** (`backups: null`, PITR выкл.). |
| **Локальный `pg_dump` (без Docker)** | **Готово:** `backups/production_2026-09-16_122949/` — `schema_public.sql` + `data_public.sql` (только схема `public`). См. `MANIFEST.md` в каталоге. |
| **Проход I (2026-09-16 ~13:38)** | **Снимок для восстановления:** `backups/production_2026-09-16_133806/` — байт-в-байт копия `122949` (см. `MANIFEST.md`). Перед крупными правками в БД после этого времени — повторить вариант B. |
| **Проход J (2026-09-16 ~13:46)** | **Свежий `pg_dump`:** `backups/production_2026-09-16_134640/` — `schema_public.sql` (~1.8 MB) + `data_public.sql` (~29.5 MB). |
| **Проход K (2026-09-16 ~15:34)** | Снимок: `backups/production_2026-09-16_153454/` — `schema_public.sql` (~1.8 MB) + `data_public.sql` (~29.0 MB). См. `MANIFEST.md`. |
| **Проход L (2026-09-16 ~15:55)** | Снимок: `backups/production_2026-09-16_155553/` — `schema_public.sql` (~1.8 MB) + `data_public.sql` (~31.0 MB). См. `MANIFEST.md`. |
| **Проход M (2026-09-16 ~17:01)** | **Актуальный снимок перед правками:** `backups/production_2026-09-16_170108/` — `schema_public.sql` (~1.8 MB) + `data_public.sql` (~31.0 MB). См. `MANIFEST.md`. |
| Черновые каталоги | `production_2026-09-16_121744/`, `122936/` — пустые попытки через CLI. |

## Как сделать полный дамп перед правками

### Вариант A — Docker + Supabase CLI

```powershell
cd tangodb
$ts = Get-Date -Format "yyyy-MM-dd_HHmmss"
$dir = "..\backups\production_$ts"
New-Item -ItemType Directory -Force -Path $dir
npx supabase db dump --linked -f "$dir\schema.sql"
npx supabase db dump --linked --data-only -f "$dir\data.sql"
```

### Вариант B — локальный `pg_dump` (Windows, без Docker)

Из `tangodb/`, пароль и хост **не коммитить** — возьмите из Dashboard или `npx supabase db dump --linked --dry-run` (только локально):

```powershell
cd tangodb
# задать PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE из dry-run
$ts = Get-Date -Format "yyyy-MM-dd_HHmmss"
$dir = "..\backups\production_$ts"
New-Item -ItemType Directory -Force -Path $dir
& "C:\pgsql\bin\pg_dump.exe" --schema-only --no-owner --no-acl -n public -f "$dir\schema_public.sql"
& "C:\pgsql\bin\pg_dump.exe" --data-only --no-owner --no-acl -n public -f "$dir\data_public.sql"
```

При циклических FK `pg_dump` предупредит — при восстановлении см. `MANIFEST.md` в снимке.

Альтернатива: **Database → Backups** в дашборде (если включите Pro / PITR).

## Восстановление (справочно)

1. Новая ветка / staging-проект Supabase.
2. `psql` или Supabase SQL Editor: сначала `schema.sql`, затем `data.sql` (или один объединённый файл).
3. Проверить RLS и Edge secrets отдельно — дамп `public` не включает `auth`/`storage` целиком (как у `supabase db dump` по умолчанию).

**Не коммитьте** файлы `*.sql` с production-данными в git.
