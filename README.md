# 🏆 Family World Cup 2026 — Predictions

A private prediction game for up to ~7 family members (works for more too).
Everyone predicts match scores and the knockout bracket; the leaderboard
updates **automatically** as real results come in. Runs entirely on free tiers.

**Stack:** static site on **Netlify** · **Supabase** (Postgres + Auth) ·
one Netlify **scheduled function** that pulls results from **football-data.org**
(with an **openfootball** GitHub fallback). Total cost: **$0**.

---

## How it works (30-second version)

- The browser talks straight to Supabase for login + saving predictions. The
  database's Row Level Security guarantees nobody can edit someone else's picks,
  and picks for a match are frozen the moment it kicks off.
- A scheduled function runs every 30 minutes, fetches the latest fixtures and
  final scores, and writes them into the database. The leaderboard is computed
  from that — no manual score entry, ever.
- Scoring: **2 pts** exact score · **1 pt** correct result. Bonus (locks at the
  first kickoff): **champion 5**, each **finalist 3**, each **semifinalist 2**.

---

## Setup — do these once (about 20 minutes)

You'll create three free accounts: **Supabase**, **football-data.org**, **Netlify**.

### 1) Supabase (database + login)

1. Go to supabase.com → create a project (pick any name + a database password).
2. In the project, open **SQL Editor → New query**, paste the entire contents of
   `supabase/schema.sql`, and click **Run**. This builds all the tables and rules.
3. Open **Project Settings → API** and copy these three values:
   - **Project URL**
   - **anon public** key
   - **service_role** key  ← *secret, server-only*
4. *(Recommended for a family)* Open **Authentication → Providers → Email** and
   turn **OFF** "Confirm email." Now relatives can sign up and start immediately
   without an email confirmation step.

### 2) football-data.org (results feed)

1. Go to football-data.org → register for the free tier.
2. Copy your **API token** from your account page.
   *(Free-tier scores are slightly delayed — that's fine, we only need final scores.)*

### 3) Configure the site

Open **`assets/config.js`** and paste in your Supabase **Project URL** and
**anon public** key. (The anon key is meant to be public; RLS protects the data.)

### 4) Deploy to Netlify

The scheduled function needs a real deploy (not drag-and-drop), so use Git:

1. Push this folder to a GitHub repo.
2. In Netlify → **Add new site → Import from Git** → pick the repo. Leave the
   build command empty; publish directory is `.` (already set in `netlify.toml`).
3. In Netlify → **Site settings → Environment variables**, add:
   | Key | Value |
   |-----|-------|
   | `SUPABASE_URL` | your Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | your Supabase **service_role** key |
   | `FOOTBALL_DATA_TOKEN` | your football-data.org token |
4. Trigger a redeploy so the variables take effect.

*(Prefer the terminal? `npm i -g netlify-cli`, then `netlify deploy --prod`.)*

### 5) Load the fixtures (one click)

In Netlify → **Functions → `update-results`**, click to run it once (or with the
CLI: `netlify functions:invoke update-results`). Or just wait up to 30 minutes —
the cron runs it automatically. Once it runs, all 104 fixtures appear in the app
and the bonus lock time is set to the first kickoff.

### 6) Invite the family

Share your Netlify URL. Each person taps **Sign up**, enters a name + email +
password, and starts predicting. After everyone has joined, you can optionally
disable new signups in Supabase (**Authentication → Providers → Email →**
turn off "Allow new users to sign up").

---

## Tweaking the scoring

All point values live in one database row. To change them, run in the Supabase
SQL Editor, e.g.:

```sql
update app_config
set points_exact = 3, points_champion = 8
where id = 1;
```

The leaderboard recalculates from these instantly.

## Changing how often results refresh

Edit the cron in `netlify.toml` (and the `export const config` line at the bottom
of `netlify/functions/update-results.mjs`). `*/30 * * * *` = every 30 minutes;
`*/10 * * * *` = every 10. The football-data.org free tier allows 10 requests/min,
so don't go below a couple of minutes.

---

## Good to know

- **Predictions lock at kickoff.** Before kickoff you can change a pick as often
  as you like; it saves automatically a moment after you type. After kickoff the
  inputs disable and everyone's picks for that match become visible.
- **Knockout tab** is empty until the group stage ends — the bracket teams aren't
  known before then. Fixtures appear automatically as rounds are drawn.
- **Bonus picks** lock at the first kickoff (June 11). Pick your champion,
  finalists, and semifinalists before then.
- **Fallback:** if football-data.org is unreachable, the function falls back to the
  openfootball GitHub feed so fixtures/results still flow (team names there differ
  slightly, so the primary feed is preferred).

## Files

```
index.html                      app shell
assets/config.js                ← you edit: Supabase URL + anon key
assets/styles.css               theme
assets/app.js                   all front-end logic
supabase/schema.sql             ← run once in Supabase
netlify/functions/update-results.mjs   scheduled results fetcher
netlify.toml, package.json      Netlify config + the one dependency
.env.example                    documents the Netlify env vars
```
