# Stack It Up Live Scoring

Judges enter scores on an iPad. A public, read-only scoreboard runs on the TV. Each score flashes full-screen with the team name, then the full board comes back. Awards (1st / 2nd / 3rd per event plus overall) are tabulated automatically.

| Page | Address | Who |
|---|---|---|
| Scoring desk | `https://your-site.vercel.app/` | Judges + meet host (login) |
| Live display | `https://your-site.vercel.app/display` | TV, cast screen, parents (no login) |

Built with plain JavaScript + Vite, **Supabase** (login, database, live updates) and **Vercel** (hosting). Everything below uses the free tiers.

---

## 1. Supabase (about 10 minutes)

1. Go to <https://supabase.com>, sign in, and click **New project**. Pick any name and a database password (you won't need that password again).
2. When it's ready, open **SQL Editor → New query**. Paste in everything from `supabase/schema.sql` and click **Run**. This creates the tables, the security rules, live updates, and your 2025 meet setup.
3. Create the shared login: **Authentication → Users → Add user → Create new user**
   - Email: `judges@stackitup.local`
   - Password: whatever you want the judges and host to type
   - Tick **Auto Confirm User**
   
   On the login screen, people type the username **`judges`** and that password.
4. Turn off public sign-ups: **Authentication → Sign In / Providers → Email**, then switch off **Allow new users to sign up**. (Even if this is on, only emails listed in the `staff` table can change scores.)
5. Copy two values from **Project Settings → API** (or **Connect**). You'll need them for Vercel:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (the long one marked *anon* / *publishable*. Never use the *service_role* key.)

## 2. GitHub

1. Go to <https://github.com/new>, name the repo (e.g. `stackitup-scoring`), and click **Create repository**.
2. Click **uploading an existing file** and drag in **everything inside this folder** (`index.html`, `display.html`, `package.json`, the `src` and `supabase` folders, and the rest). Then click **Commit changes**.

   Or, from a terminal:
   ```bash
   git init && git add . && git commit -m "Live scoring"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/stackitup-scoring.git
   git push -u origin main
   ```

## 3. Vercel

1. Go to <https://vercel.com/new> and import the GitHub repo. Vercel detects **Vite** automatically, so leave the build settings alone.
2. Open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
3. Click **Deploy**. Your site will be at `https://<project>.vercel.app`.
   If you add or change the variables later, use **Deployments → ⋯ → Redeploy**.

## 4. Meet day

- **Judges' iPad:** open the site and sign in. Tap a team's box for an event, key in the score, and tap **Save & show on screen**.
  - **Save without flashing** fixes a typo quietly.
  - **Flash again** re-shows a score.
  - Solo tumbles ask for the athlete's name.
- **TV:** sign in on another device and open **Cast & QR**, or scan its QR code. That opens `/display`, which you can then cast:
  - **Chrome:** ⋮ → Cast → choose the TV, then press **Full screen**.
  - **iPad or Mac:** Control Center → Screen Mirroring to an Apple TV or AirPlay TV.
  - **HDMI:** plug the laptop into the TV.
- **Parents:** print the QR code (**Save QR image**). The TV display also shows the QR in the corner. On a phone, the display switches to a scrollable layout.
- **Results tab:** awards update live and show **Final** when every score for a level is in. **Download CSV** gives you a spreadsheet, and **Copy awards** gives you a list to read out.
- **Setup tab:** meet name, levels, teams, and events. Events that share an *award group* add together, like Compulsory and Optional Acro → Acro. Use **Clear all scores** after a practice run.

Tip: use a separate device for the display so the judges' iPad stays free.

## Extra logins

To give the host a separate login, add another user in Supabase (for example `host@stackitup.local`). Then run this in the SQL Editor:
```sql
insert into public.staff (email) values ('host@stackitup.local');
```
To change the password: **Authentication → Users → ⋯ → Reset / update password**.

## Run it on your own computer (optional)

```bash
cp .env.example .env.local   # then paste your two Supabase values in
npm install
npm run dev
```

## Troubleshooting

- **"This site isn't connected to Supabase yet"**: the Vercel environment variables are missing or misspelled. Fix them and redeploy.
- **"Can't load the meet"**: `supabase/schema.sql` wasn't run, or only part of it ran. Run the whole file again; it's safe to repeat.
- **"This login isn't allowed to enter scores"**: that login's email isn't in the `staff` table. See *Extra logins*.
- **Display doesn't flash**: the display only flashes scores saved with **Save & show on screen**. It also re-syncs every 30 seconds, so the board corrects itself if the Wi-Fi blips.
- **Supabase free projects pause after a week with no activity.** Open the site a day or two before the meet, or click **Restore** in the Supabase dashboard.
