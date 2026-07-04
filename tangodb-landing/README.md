# TangoDB Landing

Marketing landing page for [TangoDB](https://tangodb.vercel.app) — a CRM for dance schools and studios.

- Bilingual: English / Russian (auto-detect from browser, stored in `localStorage`)
- Interactive read-only demo with **Studio Ritmo** sample data
- Static site — no backend, no API keys

## Local development

```bash
cd tangodb-landing
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bash
npm run build
npm run preview
```

Output: `dist/`

## Deploy to Cloudflare Pages (free)

GitHub Actions workflow `.github/workflows/deploy-landing.yml` deploys on push to `main` when `tangodb-landing/**` changes.

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|--------|
| `CLOUDFLARE_API_TOKEN` | API token with **Account → Cloudflare Pages → Edit** (scoped to this account) |
| `CLOUDFLARE_ACCOUNT_ID` | `7629e83b82917f3be3175c6f4bf3fed4` |

Wrangler is pinned in `package.json`; set `CLOUDFLARE_ACCOUNT_ID` in GitHub secrets so CI does not need User Details Read on the token.

Manual deploy (after `npm run build`):

```bash
cd tangodb-landing
npx wrangler pages deploy dist --project-name=tangodb-landing --branch=main
```

### First-time setup (Cloudflare Dashboard)

1. Push this folder to your GitHub repo (monorepo root: `tangodb-landing/`).
2. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** (optional; CI deploy uses Wrangler API).
3. Select the TangoDB repository.
4. Build settings:

   | Setting | Value |
   |---------|--------|
   | Root directory | `tangodb-landing` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Node.js version | 22 (or latest LTS) |

5. Deploy. You will get a URL like `https://tangodb-landing.pages.dev`.

SPA routing is handled by `public/_redirects` (`/* /index.html 200`).

### Optional: custom domain later

In Pages → **Custom domains** → add your domain when ready.

## Landing analytics (Dev Console)

Backend for click/pageview tracking (prompt 6):

| Artifact | Location |
|----------|----------|
| Migration `landing_events` | `tangodb/supabase/migrations/20260818000001_landing_events.sql` |
| Edge Function | `tangodb/supabase/functions/landing-track-event` |

Deploy (when ready, not part of Pages CI):

```bash
cd tangodb
supabase db push
supabase functions deploy landing-track-event
```

Дополните **существующий** Supabase secret `ALLOWED_ORIGINS` (тот же, что для CRM и Dev Console): добавьте `https://tangodb-landing.pages.dev` и `http://localhost:5173` (и custom domain, когда подключите). После изменения — redeploy Edge Functions.

Client tracker (`src/lib/landingAnalytics.ts`) and env `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — prompt 7.

## Links

- CRM sign-in: https://tangodb.vercel.app/login
- CRM registration: https://tangodb.vercel.app/register
- Contact: omowdance@gmail.com · [@omow_second](https://t.me/omow_second)
