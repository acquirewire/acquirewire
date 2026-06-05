# Cutover — replace the live site, keep the same URL

Goal: deploy this new Astro site to your **existing** GitHub repo and **existing**
Vercel project, so `acquirewire.co.uk` keeps working with no DNS changes.

Strategy: push this project over your current repo's production branch. The
Vercel project already linked to that repo + domain redeploys automatically. The
only manual change is telling Vercel it's now an **Astro** project (the old site
was plain HTML).

---

## 0. Gather two facts

From the **Vercel** dashboard → your AcquireWire project → **Settings → Git**:
- **Repository** — e.g. `your-name/acquirewire` (the GitHub repo it deploys from)
- **Production Branch** — usually `main` (sometimes `master`)

Everything below assumes `main`. If yours is `master`, swap it in.

## 1. Back up the old site, then push the new one

Open a terminal in `C:\Users\henry\acquirewire` and run:

```bash
# Connect to your existing GitHub repo (use YOUR repo URL)
git remote add origin https://github.com/<your-name>/<your-repo>.git
git fetch origin

# Safety net: save the current live version on a branch you can return to
git branch legacy-html origin/main
git push origin legacy-html

# Replace the production branch with the new project
git push --force origin main
```

> The histories are unrelated (this is a fresh rebuild), so the `--force` is
> expected. The old site is preserved on the `legacy-html` branch — nothing is
> lost, and you can roll back by redeploying that branch in Vercel.

## 2. Tell Vercel it's now an Astro project

Vercel dashboard → project → **Settings → Build & Deployment** (a.k.a. General):
- **Framework Preset:** change from "Other"/static to **Astro**.
- **Build Command / Output Directory / Install Command:** clear any manual
  overrides — leave them on the Astro defaults. The `@astrojs/vercel` adapter
  produces Vercel's Build Output automatically (do NOT set an output dir).
- **Node.js Version:** set to **22.x** (Settings → Build & Deployment → Node).

No environment variables are needed on Vercel — the live site and the market
data (`/api/quotes`, `/api/board`, `/api/history`) use free public feeds with no
key.

## 3. Redeploy

The force-push in step 1 already triggered a deploy. After saving the Astro
settings in step 2, trigger a fresh one so the new settings apply:
- Vercel → **Deployments** → latest → **⋯ → Redeploy** (untick "use existing
  build cache").

When it's green, open `https://www.acquirewire.co.uk` — you should see the new
site. The custom domain + SSL are unchanged.

## 4. Turn on the daily auto-drafting (GitHub Actions)

This is the only place a key is required.

GitHub → your repo → **Settings → Secrets and variables → Actions**:
- **Secrets** tab → **New repository secret**: `ANTHROPIC_API_KEY` = `sk-ant-...`
- **Variables** tab (optional):
  - `ANTHROPIC_MODEL` = `claude-sonnet-4-6` (or another model)
  - `NTFY_TOPIC` = your ntfy topic (push alert when a draft PR opens)
  - `NTFY_SERVER` = `https://ntfy.sh` (only if self-hosted)

Then test it: repo → **Actions** → *Daily article draft* → **Run workflow**. It
fetches the wire, drafts an article with Claude, and opens a **pull request**.
Vercel builds a preview of that PR; review it, edit the `.md` if needed, and
**merge to publish** (or close to discard). The cron runs weekdays at 06:30 UTC.

## 5. Day-to-day

- **Auto draft** → you get a PR (and ntfy ping). Read the preview, tweak, merge.
- **Write one yourself** → add a `.md` to `src/content/articles/` (copy any
  existing file as a template), commit, push. Live in ~30s.
- **Add/track a deal manually** → edit `src/data/deals.json`.
- **Park a piece** → set `draft: true` in its frontmatter.
- **Roll back to the old site** (if ever needed) → Vercel → Deployments → find a
  `legacy-html` deploy, or `git push --force origin legacy-html:main`.

## Local development

```bash
npm install
npm run dev      # http://localhost:4321 (market APIs + search work here)
npm run build    # production build
npm run generate -- --dry-run   # test article generation (needs ANTHROPIC_API_KEY in .env)
```
