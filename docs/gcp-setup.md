# Google Cloud deployment

The production runtime uses two Cloud Run services:

- `oura-health-webhook` is public and exposes Oura's verified webhook route and
  the Alexa skill endpoint.
- `oura-health-worker` is private. Cloud Tasks invokes it for webhook work and
  playlist generation; Cloud Scheduler invokes reconciliation and a playlist fallback.

Firestore stores webhook replay keys, per-day export state, and transactional
playlist generation state. Secret Manager stores Oura and Spotify credentials.
The worker uses its attached Google service account
to update the target Google Doc, so no private-key JSON is deployed.

## Prerequisites

1. Create or select a Google Cloud project with billing enabled.
2. Install the Google Cloud CLI: <https://cloud.google.com/sdk/docs/install>
3. Authenticate and select the project:

   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

4. Add the project configuration to `.env`:

   ```env
   GCP_PROJECT_ID=your-project-id
   GCP_REGION=us-east1
   GCP_FIRESTORE_LOCATION=us-east1
   ```

   The existing Oura, Spotify, and Google Doc variables must also be present. The Google
   service-account private key remains useful for local exports, but it is not
   deployed to Cloud Run.

5. Add the Oura application's client ID and client secret to `.env`. The Oura
   application must list `http://localhost:9876/callback` as a redirect URI:

   ```env
   OURA_CLIENT_ID=your-oura-client-id
   OURA_CLIENT_SECRET=your-oura-client-secret
   OURA_WEBHOOK_VERIFICATION_TOKEN=a-random-private-value
   ```

   Then authorize the application and obtain rotating OAuth tokens:

   ```bash
   npm run setup:oura-oauth
   ```

   The command opens Oura in a browser and stores `OURA_ACCESS_TOKEN` and
   `OURA_REFRESH_TOKEN` in `.env` after approval. It never prints either token.

## Deploy

Before the first production cutover, disable any legacy AWS schedules and add:

```env
GCP_ENABLE_AUTOMATION_CUTOVER=true
```

Then run:

```bash
npm run deploy:gcp
```

The script enables the required APIs, creates the runtime service account,
Firestore database, Artifact Registry repository, Cloud Tasks queue, secrets,
two Cloud Run services, and Cloud Scheduler jobs. It builds one image
and uses it for both services.

At the end, the script prints:

1. The runtime service-account email. Share the Oura Google Doc with this email
   as an Editor.
2. The public Oura callback URL. Add it to `.env` as
   `OURA_WEBHOOK_CALLBACK_URL`, then run:

   ```bash
   npm run manage:oura-webhooks
   ```

The subscription command is idempotent and creates missing update subscriptions
for sleep, readiness, activity, and resilience.

3. The public Alexa HTTPS endpoint. Select HTTPS in the Alexa developer console
   and use the printed `/alexa` URL.

## Operations

Cloud Scheduler runs reconciliation at 7:00, 8:00, 9:00, and 10:00 AM
America/New_York. Each run refreshes the current day and checks the previous
seven days; completed historical days are skipped while missing, partial, and
failed days are fetched again.

The normal playlist path is event driven. When a completed export is produced,
Cloud Tasks queues a separate playlist job. Firestore prevents concurrent or
duplicate generation for the same date and input fingerprint. A paired fallback
runs at 7:15, 8:15, 9:15, and 10:15 AM America/New_York, after each Oura check.
If the ring syncs late or the scores materially change, a later pair picks up
the new fingerprint; unchanged data does not rewrite the playlist.

To re-export one day manually through the private worker:

```bash
WORKER_URL="$(gcloud run services describe oura-health-worker --region=us-east1 --format='value(status.url)')"
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "${WORKER_URL}/admin/reexport?date=YYYY-MM-DD"
```

To force playlist regeneration for one day:

```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "${WORKER_URL}/admin/regenerate-playlist?date=YYYY-MM-DD"
```

See [GCP migration runbook](gcp-migration-runbook.md) for cutover, validation,
rollback, and legacy AWS teardown.

To inspect logs:

```bash
gcloud run services logs read oura-health-webhook --region=us-east1 --limit=50
gcloud run services logs read oura-health-worker --region=us-east1 --limit=50
```
