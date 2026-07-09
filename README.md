## Devneya Playground

Non-commercial playground build of the Devneya frontend, deployed to `playground.devneya.com` via GitHub Pages.

License: [Business Source License 1.1](./LICENSE) — free for non-commercial use, converts to Apache License 2.0 on 2030-07-09.

## Installation

```bash
git clone https://github.com/Devneya/playground.git
npm install
```

## Local development

Create `.env.local`:

```env
VITE_SUPABASE_URL="..."
VITE_SUPABASE_PUBLIC_KEY="..."
VITE_PROXY_URL="..."
VITE_LITELLM_URL="..."
VITE_STORAGE_URL="..."
VITE_SENTRY_URL="..."
VITE_TEMPLATES_INDEX_URL="..."
```

```bash
npm run start-linux   # or start-windows
```

Open http://localhost:3001

## Deployment

`.github/workflows/deploy.yml` builds on every push to `main` and publishes to GitHub Pages. Required repo secrets (Settings → Secrets and variables → Actions):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLIC_KEY`
- `VITE_PROXY_URL` — `https://back.devneya.com`
- `VITE_LITELLM_URL` — `https://litellm.devneya.com`
- `VITE_STORAGE_URL`
- `VITE_SENTRY_URL`
- `VITE_TEMPLATES_INDEX_URL`

Custom domain is set via `public/CNAME` (`playground.devneya.com`) — requires a DNS CNAME record pointing to `devneya.github.io`, and GitHub Pages enabled on this repo with source set to "GitHub Actions".

This build points at the same production backend (`back.devneya.com`, `litellm.devneya.com`) as `devneya-space`, so it uses the same Supabase project — there is no separate playground-only backend.
