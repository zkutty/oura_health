# Google Cloud deployment

The Oura export pipeline runs as two Cloud Run services:

- `oura-health-webhook` is public and exposes only Oura's verified GET/POST
  webhook route.
- `oura-health-worker` is private. Cloud Tasks invokes it for webhook work and
  Cloud Scheduler invokes it once daily for reconciliation.

Firestore stores webhook replay keys and per-day export state. Secret Manager
stores Oura credentials. The worker uses its attached Google service account
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

   The existing Oura and Google Doc variables must also be present. The Google
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

Run:

```bash
npm run deploy:gcp
```

The script enables the required APIs, creates the runtime service account,
Firestore database, Artifact Registry repository, Cloud Tasks queue, secrets,
two Cloud Run services, and the daily Cloud Scheduler job. It builds one image
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

## Operations

Cloud Scheduler runs reconciliation at 11:15 AM America/New_York and checks the
previous seven days. Complete days are skipped; missing, partial, and failed
days are fetched again.

To re-export one day manually through the private worker:

```bash
WORKER_URL="$(gcloud run services describe oura-health-worker --region=us-east1 --format='value(status.url)')"
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  "${WORKER_URL}/admin/reexport?date=YYYY-MM-DD"
```

To inspect logs:

```bash
gcloud run services logs read oura-health-webhook --region=us-east1 --limit=50
gcloud run services logs read oura-health-worker --region=us-east1 --limit=50
```
