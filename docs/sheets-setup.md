# Google Sheets Daily Export Setup

This module pulls your Oura data every morning and upserts it into a Google
Sheet in your Drive — structured tabs you can read at a glance plus a `Raw JSON`
tab that preserves the full Oura API responses. The sheet is designed so Claude
(or any analyst) can be pointed at it and immediately reason about your trends.

## What gets written

Each tab is upserted by key (most use `day`, workouts use `id`). Re-running on
the same day updates rows in place — no duplicates.

| Tab             | Key      | One row per                 | Notes                                   |
| --------------- | -------- | --------------------------- | --------------------------------------- |
| `Daily Summary` | `day`    | day                         | The view to share with Claude first.    |
| `Sleep`         | `id`     | sleep period                | Includes naps and short sleeps.         |
| `Readiness`     | `day`    | day                         | All readiness contributors broken out.  |
| `Activity`      | `day`    | day                         | All activity contributors broken out.   |
| `Resilience`    | `day`    | day                         | Sleep / daytime recovery + stress.      |
| `Workouts`      | `id`     | workout                     | Auto-detected + logged workouts.        |
| `Raw JSON`      | composite| record                      | Full-fidelity JSON per record.          |

## One-time setup

### 1. Create a Google Cloud service account

A service account is the easiest auth path for a headless cron job — no OAuth
refresh dance, just a JSON key that signs requests.

1. Go to https://console.cloud.google.com/ and create (or pick) a project.
2. **APIs & Services → Library**: enable **Google Sheets API** and **Google
   Drive API**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   Name it (e.g. `oura-sheets-sync`), no roles needed, finish.
4. Click the new service account → **Keys → Add key → JSON**. A JSON file
   downloads. Save it as `credentials/google-service-account.json` in this repo
   (the directory is gitignored).

### 2. Create the spreadsheet

1. In your Google Drive, **New → Google Sheets → blank**. Rename it (e.g.
   `Oura Health History`).
2. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`<THIS-IS-THE-ID>`**`/edit`.
3. Click **Share** and add the service account's `client_email` (visible in the
   JSON key file, ends in `@<project>.iam.gserviceaccount.com`) as **Editor**.

### 3. Configure environment

Add to `.env`:

```env
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/google-service-account.json
GOOGLE_SHEETS_SPREADSHEET_ID=<paste-id-here>
```

For serverless/Lambda you can instead set the entire JSON as one env var:
`GOOGLE_SERVICE_ACCOUNT_KEY_JSON='{"type":"service_account",...}'`.

### 4. Provision tabs and headers

```bash
npm install     # installs googleapis if you haven't yet
npm run setup-sheets
```

You should see "Provisioning tabs..." and a link to your sheet. Open it — each
tab should have its header row.

### 5. Backfill history

Pull the last 30 days (or whatever window you want) before letting the cron
take over:

```bash
npm run backfill-sheets                      # 30 days (default)
npm run backfill-sheets -- --days=180        # last 6 months
npm run backfill-sheets -- --start=2025-01-01 --end=2025-04-28
```

### 6. Run the daily sync

The Express app schedules a daily sync via cron. With the server running:

```bash
npm run build && npm start
```

You'll see `Sheets export: enabled` and the schedule on startup. The default is
**every day at 6:00 AM** (server local time), syncing the last 3 days so any
late-arriving data lands cleanly.

If you'd rather not run the Express server, point a system cron at the
standalone sync script instead:

```cron
0 6 * * *  cd /path/to/oura_health && /usr/local/bin/npm run sync-sheets
```

## Manual triggers

While the server is running:

```bash
# Sync last N days (defaults to dailySyncDays from config)
curl -X POST http://localhost:3000/sheets/sync

# Sync an explicit window
curl -X POST http://localhost:3000/sheets/sync-range \
  -H 'Content-Type: application/json' \
  -d '{"start":"2025-04-01","end":"2025-04-28"}'

# Re-run setup (creates any missing tabs)
curl -X POST http://localhost:3000/sheets/setup
```

## Configuration

`src/config/sheetsConfig.json`:

```json
{
  "enabled": true,
  "spreadsheetId": "",
  "schedule": "0 6 * * *",
  "dailySyncDays": 3,
  "defaultBackfillDays": 30,
  "tabs": {
    "dailySummary": true,
    "sleep": true,
    "readiness": true,
    "activity": true,
    "resilience": true,
    "workouts": true,
    "rawJson": true
  }
}
```

- **`schedule`** — any node-cron expression. Default 6 AM.
- **`dailySyncDays`** — how many days back the cron pulls each run. 3 is a good
  default because Oura sometimes finalizes the previous night's data hours
  later, and resilience scores often update a day after.
- **`tabs`** — toggle individual tabs off (e.g. set `rawJson: false` if you
  don't want the audit trail).

## Pointing Claude at the sheet

Once you have a few weeks of history, the simplest workflow is:

1. Open the sheet in your browser.
2. Select the `Daily Summary` tab.
3. **File → Download → CSV** (or copy/paste the cells) and drop into a Claude
   conversation with a question like *"What patterns do you see in my readiness
   scores after high-strain workouts?"*

The `Raw JSON` tab is your escape hatch when Claude needs a field the structured
tabs don't expose.

## Troubleshooting

- **`The caller does not have permission`** — you forgot to share the sheet
  with the service account email. Double-check the `client_email` from the JSON
  key.
- **`Spreadsheet ID is not configured`** — `GOOGLE_SHEETS_SPREADSHEET_ID` not in
  `.env`, or `.env` not loaded (the scripts call `dotenv.config()`).
- **Empty rows / missing days** — some Oura endpoints (resilience especially)
  publish a day late. The cron's `dailySyncDays: 3` window normally catches
  this; bump it higher if your data lands even later.
- **Values look like seconds, not hours** — durations in `Daily Summary` and
  the per-domain tabs are converted (hours for sleep durations, minutes for
  activity time bands). The exact raw values live in `Raw JSON`.
