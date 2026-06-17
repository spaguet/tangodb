# v1 migrations (archived copy)

These migrations belong to the single-tenant v1 schema (`allowed_users`, TEXT PKs, no `organization_id`).

**For linked Supabase projects:** the same files must also exist in `../migrations/` so `supabase db push` can match remote migration history. This folder is a reference copy; do not delete the originals from `migrations/` while the remote DB has v1 applied.

Active v2 tenant migrations: `20260620000001` … `20260620000003` in `../migrations/`.
