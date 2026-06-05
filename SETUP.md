# Cutover checklist

Do these once to take the new site live on `acquirewire.co.uk` and turn on automation.

## 1. Local dry-run (optional but recommended)

```bash
cd C:\Users\henry\acquirewire
copy .env.example .env       # then edit .env: ANTHROPIC_API_KEY=sk-ant-...
npm install
npm run generate -- --dry-run   # writes _migration/draft-preview.md
npm run dev                      # eyeball the site at http://localhost:4321
```

## 2. Create the GitHub repo and push

```bash
cd C:\Users\henry\acquirewire
git init
git add .
git commit -m "AcquireWire: Astro rebuild + automated drafting"
# create an empty repo on github.com first (e.g. acquirewire), then:
git remote add origin https://github.com/<you>/acquirewire.git
git branch -M main
git push -u origin main
```

> `.env`, `node_modules/`, `dist/`, and `_migration/` are gitignored — your API key is never committed.

## 3. Point Vercel at the new repo

1. Vercel dashboard → your existing AcquireWire project → **Settings → Git**.
2. Disconnect the old repo, **connect** the new `acquirewire` repo.
   - (Or create a new Vercel project from the repo, then move the `acquirewire.co.uk`
     domain to it under **Settings → Domains**.)
3. Framework preset **Astro** is auto-detected. Leave the build/output settings
   on their defaults — the `@astrojs/vercel` adapter writes Vercel's Build Output
   automatically (you do NOT need to set an output directory). The live price
   tape (`/api/quotes`) deploys as a serverless function with no extra config.
4. Redeploy. The custom domain + SSL carry over.

## 4. Turn on the daily drafts

Repo → **Settings → Secrets and variables → Actions**:

- **Secrets** tab → New secret: `ANTHROPIC_API_KEY` = `sk-ant-...`
- **Variables** tab (optional):
  - `ANTHROPIC_MODEL` = `claude-sonnet-4-6` (or another model)
  - `NTFY_TOPIC` = your ntfy topic (reuses your ticket-bot ntfy setup for push alerts)
  - `NTFY_SERVER` = `https://ntfy.sh` (only if self-hosted)

Then: **Actions** tab → *Daily article draft* → **Run workflow** to test now. It opens a
PR with a Vercel preview deploy. Review → merge to publish, or close to discard.

The cron runs **06:30 UTC, Mon–Fri**. Change the schedule in
`.github/workflows/generate.yml` if you want a different time/frequency.

## Day-to-day

- **New auto draft** → you get a PR (and ntfy ping). Read the preview, tweak the `.md`
  if needed, merge.
- **Write one yourself** → add a `.md` to `src/content/articles/` (copy any existing one
  as a template), commit, push. Live in ~30s.
- **Park a piece** → set `draft: true` in its frontmatter.
