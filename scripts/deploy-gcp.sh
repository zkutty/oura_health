#!/usr/bin/env bash
set -euo pipefail

if ! command -v gcloud >/dev/null 2>&1 && [[ -x "${HOME}/google-cloud-sdk/bin/gcloud" ]]; then
  export PATH="${HOME}/google-cloud-sdk/bin:${PATH}"
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required. Install the Google Cloud CLI first: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID in .env or the shell.}"
: "${OURA_ACCESS_TOKEN:?OURA_ACCESS_TOKEN is required.}"
: "${OURA_REFRESH_TOKEN:?OURA_REFRESH_TOKEN is required.}"
: "${OURA_CLIENT_ID:?OURA_CLIENT_ID is required.}"
: "${OURA_CLIENT_SECRET:?OURA_CLIENT_SECRET is required.}"
: "${OURA_WEBHOOK_VERIFICATION_TOKEN:?OURA_WEBHOOK_VERIFICATION_TOKEN is required.}"
: "${GOOGLE_OURA_DOCUMENT_ID:?GOOGLE_OURA_DOCUMENT_ID is required.}"
: "${SPOTIFY_ACCESS_TOKEN:?SPOTIFY_ACCESS_TOKEN is required.}"
: "${SPOTIFY_REFRESH_TOKEN:?SPOTIFY_REFRESH_TOKEN is required.}"
: "${SPOTIFY_CLIENT_ID:?SPOTIFY_CLIENT_ID is required.}"
: "${SPOTIFY_CLIENT_SECRET:?SPOTIFY_CLIENT_SECRET is required.}"

GCP_REGION="${GCP_REGION:-us-east1}"
GCP_FIRESTORE_LOCATION="${GCP_FIRESTORE_LOCATION:-us-east1}"
GCP_RUNTIME_SERVICE_ACCOUNT_NAME="${GCP_RUNTIME_SERVICE_ACCOUNT_NAME:-oura-health-runtime}"
GCP_RUNTIME_SERVICE_ACCOUNT="${GCP_RUNTIME_SERVICE_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
GCP_BUILD_SERVICE_ACCOUNT_NAME="${GCP_BUILD_SERVICE_ACCOUNT_NAME:-oura-health-builder}"
GCP_BUILD_SERVICE_ACCOUNT="${GCP_BUILD_SERVICE_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
GCP_TASK_QUEUE="${GCP_TASK_QUEUE:-oura-webhook-events}"
GCP_WORKER_SERVICE="${GCP_WORKER_SERVICE:-oura-health-worker}"
GCP_WEBHOOK_SERVICE="${GCP_WEBHOOK_SERVICE:-oura-health-webhook}"
GCP_ARTIFACT_REPOSITORY="${GCP_ARTIFACT_REPOSITORY:-oura-health}"
GCP_IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GCP_ARTIFACT_REPOSITORY}/oura-health:latest"

gcloud config set project "${GCP_PROJECT_ID}" >/dev/null
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  cloudtasks.googleapis.com \
  cloudscheduler.googleapis.com \
  docs.googleapis.com \
  firestore.googleapis.com \
  iamcredentials.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com

GCP_DEPLOYER_ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
if [[ "${GCP_DEPLOYER_ACCOUNT}" == *".gserviceaccount.com" ]]; then
  GCP_DEPLOYER_MEMBER="serviceAccount:${GCP_DEPLOYER_ACCOUNT}"
else
  GCP_DEPLOYER_MEMBER="user:${GCP_DEPLOYER_ACCOUNT}"
fi

if ! gcloud iam service-accounts describe "${GCP_BUILD_SERVICE_ACCOUNT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${GCP_BUILD_SERVICE_ACCOUNT_NAME}" \
    --display-name="Oura health Cloud Build service account"
fi
gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${GCP_BUILD_SERVICE_ACCOUNT}" \
  --role="roles/cloudbuild.builds.builder" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${GCP_BUILD_SERVICE_ACCOUNT}" \
  --project="${GCP_PROJECT_ID}" \
  --member="${GCP_DEPLOYER_MEMBER}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

if ! gcloud iam service-accounts describe "${GCP_RUNTIME_SERVICE_ACCOUNT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${GCP_RUNTIME_SERVICE_ACCOUNT_NAME}" \
    --display-name="Oura health Cloud Run runtime"
fi

gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${GCP_RUNTIME_SERVICE_ACCOUNT}" \
  --role="roles/datastore.user" >/dev/null
gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${GCP_RUNTIME_SERVICE_ACCOUNT}" \
  --role="roles/cloudtasks.enqueuer" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${GCP_RUNTIME_SERVICE_ACCOUNT}" \
  --member="serviceAccount:${GCP_RUNTIME_SERVICE_ACCOUNT}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database='(default)' \
    --location="${GCP_FIRESTORE_LOCATION}" \
    --type=firestore-native
fi

if ! gcloud artifacts repositories describe "${GCP_ARTIFACT_REPOSITORY}" --location="${GCP_REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${GCP_ARTIFACT_REPOSITORY}" \
    --repository-format=docker \
    --location="${GCP_REGION}" \
    --description="Oura health Cloud Run images"
fi

put_secret() {
  local secret_id="$1"
  local secret_value="$2"
  if ! gcloud secrets describe "${secret_id}" >/dev/null 2>&1; then
    gcloud secrets create "${secret_id}" --replication-policy=automatic >/dev/null
  fi
  printf '%s' "${secret_value}" | gcloud secrets versions add "${secret_id}" --data-file=- >/dev/null
  gcloud secrets add-iam-policy-binding "${secret_id}" \
    --member="serviceAccount:${GCP_RUNTIME_SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
}

put_rotating_secret() {
  local secret_id="$1"
  local initial_value="$2"
  if ! gcloud secrets describe "${secret_id}" >/dev/null 2>&1; then
    gcloud secrets create "${secret_id}" --replication-policy=automatic >/dev/null
    printf '%s' "${initial_value}" | gcloud secrets versions add "${secret_id}" --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding "${secret_id}" \
    --member="serviceAccount:${GCP_RUNTIME_SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
}

# These values rotate at runtime. Only seed them during the first deployment;
# later deployments must retain the newest versions written by OuraService.
if [[ "${GCP_SYNC_OURA_TOKENS:-false}" == "true" ]]; then
  put_secret oura-access-token "${OURA_ACCESS_TOKEN}"
  put_secret oura-refresh-token "${OURA_REFRESH_TOKEN}"
else
  put_rotating_secret oura-access-token "${OURA_ACCESS_TOKEN}"
  put_rotating_secret oura-refresh-token "${OURA_REFRESH_TOKEN}"
fi
put_secret oura-client-id "${OURA_CLIENT_ID}"
put_secret oura-client-secret "${OURA_CLIENT_SECRET}"
put_secret oura-webhook-verification-token "${OURA_WEBHOOK_VERIFICATION_TOKEN}"
put_secret google-oura-document-id "${GOOGLE_OURA_DOCUMENT_ID}"

if [[ "${GCP_SYNC_SPOTIFY_TOKENS:-false}" == "true" ]]; then
  put_secret spotify-access-token "${SPOTIFY_ACCESS_TOKEN}"
  put_secret spotify-refresh-token "${SPOTIFY_REFRESH_TOKEN}"
else
  put_rotating_secret spotify-access-token "${SPOTIFY_ACCESS_TOKEN}"
  put_rotating_secret spotify-refresh-token "${SPOTIFY_REFRESH_TOKEN}"
fi
put_secret spotify-client-id "${SPOTIFY_CLIENT_ID}"
put_secret spotify-client-secret "${SPOTIFY_CLIENT_SECRET}"

for token_secret in oura-access-token oura-refresh-token spotify-access-token spotify-refresh-token; do
  gcloud secrets add-iam-policy-binding "${token_secret}" \
    --member="serviceAccount:${GCP_RUNTIME_SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretVersionAdder" >/dev/null
done

gcloud builds submit \
  --region="${GCP_REGION}" \
  --service-account="projects/${GCP_PROJECT_ID}/serviceAccounts/${GCP_BUILD_SERVICE_ACCOUNT}" \
  --default-buckets-behavior=regional-user-owned-bucket \
  --tag "${GCP_IMAGE}" .

COMMON_ENV="GCP_PROJECT_ID=${GCP_PROJECT_ID},GCP_LOCATION=${GCP_REGION},GOOGLE_USE_APPLICATION_DEFAULT_CREDENTIALS=true,OURA_TOKEN_PERSISTENCE=gcp-secret-manager,OURA_ACCESS_TOKEN_SECRET_ID=oura-access-token,OURA_REFRESH_TOKEN_SECRET_ID=oura-refresh-token,SPOTIFY_TOKEN_PERSISTENCE=gcp-secret-manager,SPOTIFY_ACCESS_TOKEN_SECRET_ID=spotify-access-token,SPOTIFY_REFRESH_TOKEN_SECRET_ID=spotify-refresh-token"
WORKER_SECRETS="OURA_ACCESS_TOKEN=oura-access-token:latest,OURA_REFRESH_TOKEN=oura-refresh-token:latest,OURA_CLIENT_ID=oura-client-id:latest,OURA_CLIENT_SECRET=oura-client-secret:latest,GOOGLE_OURA_DOCUMENT_ID=google-oura-document-id:latest,SPOTIFY_ACCESS_TOKEN=spotify-access-token:latest,SPOTIFY_REFRESH_TOKEN=spotify-refresh-token:latest,SPOTIFY_CLIENT_ID=spotify-client-id:latest,SPOTIFY_CLIENT_SECRET=spotify-client-secret:latest"

gcloud run deploy "${GCP_WORKER_SERVICE}" \
  --image="${GCP_IMAGE}" \
  --region="${GCP_REGION}" \
  --service-account="${GCP_RUNTIME_SERVICE_ACCOUNT}" \
  --no-allow-unauthenticated \
  --set-env-vars="GCP_SERVICE_MODE=worker,${COMMON_ENV}" \
  --set-secrets="${WORKER_SECRETS}" \
  --memory=512Mi \
  --timeout=300

GCP_WORKER_URL="$(gcloud run services describe "${GCP_WORKER_SERVICE}" --region="${GCP_REGION}" --format='value(status.url)')"

gcloud run services update "${GCP_WORKER_SERVICE}" \
  --region="${GCP_REGION}" \
  --update-env-vars="GCP_TASK_QUEUE=${GCP_TASK_QUEUE},GCP_WORKER_URL=${GCP_WORKER_URL},GCP_TASK_OIDC_SERVICE_ACCOUNT=${GCP_RUNTIME_SERVICE_ACCOUNT}" \
  --quiet >/dev/null

gcloud run services add-iam-policy-binding "${GCP_WORKER_SERVICE}" \
  --region="${GCP_REGION}" \
  --member="serviceAccount:${GCP_RUNTIME_SERVICE_ACCOUNT}" \
  --role="roles/run.invoker" >/dev/null

if gcloud tasks queues describe "${GCP_TASK_QUEUE}" --location="${GCP_REGION}" >/dev/null 2>&1; then
  gcloud tasks queues update "${GCP_TASK_QUEUE}" \
    --location="${GCP_REGION}" \
    --max-attempts=5 \
    --min-backoff=60s \
    --max-backoff=3600s \
    --max-doublings=4 >/dev/null
else
  gcloud tasks queues create "${GCP_TASK_QUEUE}" \
    --location="${GCP_REGION}" \
    --max-attempts=5 \
    --min-backoff=60s \
    --max-backoff=3600s \
    --max-doublings=4
fi

WEBHOOK_ENV="GCP_SERVICE_MODE=webhook,${COMMON_ENV},GCP_TASK_QUEUE=${GCP_TASK_QUEUE},GCP_WORKER_URL=${GCP_WORKER_URL},GCP_TASK_OIDC_SERVICE_ACCOUNT=${GCP_RUNTIME_SERVICE_ACCOUNT}"
WEBHOOK_SECRETS="OURA_ACCESS_TOKEN=oura-access-token:latest,OURA_REFRESH_TOKEN=oura-refresh-token:latest,OURA_CLIENT_ID=oura-client-id:latest,OURA_CLIENT_SECRET=oura-client-secret:latest,OURA_WEBHOOK_VERIFICATION_TOKEN=oura-webhook-verification-token:latest"

gcloud run deploy "${GCP_WEBHOOK_SERVICE}" \
  --image="${GCP_IMAGE}" \
  --region="${GCP_REGION}" \
  --service-account="${GCP_RUNTIME_SERVICE_ACCOUNT}" \
  --allow-unauthenticated \
  --set-env-vars="${WEBHOOK_ENV}" \
  --set-secrets="${WEBHOOK_SECRETS}" \
  --memory=256Mi \
  --timeout=15

GCP_WEBHOOK_URL="$(gcloud run services describe "${GCP_WEBHOOK_SERVICE}" --region="${GCP_REGION}" --format='value(status.url)')"
GCP_RECONCILIATION_URI="${GCP_WORKER_URL}/tasks/reconcile"
GCP_PLAYLIST_FALLBACK_URI="${GCP_WORKER_URL}/tasks/playlist-fallback"

if gcloud scheduler jobs describe oura-export-reconciliation --location="${GCP_REGION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http oura-export-reconciliation \
    --location="${GCP_REGION}" \
    --schedule='15 11 * * *' \
    --time-zone='America/New_York' \
    --uri="${GCP_RECONCILIATION_URI}" \
    --http-method=POST \
    --update-headers='Content-Type=application/json' \
    --message-body='{"days":7}' \
    --oidc-service-account-email="${GCP_RUNTIME_SERVICE_ACCOUNT}" \
    --oidc-token-audience="${GCP_WORKER_URL}" >/dev/null
else
  gcloud scheduler jobs create http oura-export-reconciliation \
    --location="${GCP_REGION}" \
    --schedule='15 11 * * *' \
    --time-zone='America/New_York' \
    --uri="${GCP_RECONCILIATION_URI}" \
    --http-method=POST \
    --headers='Content-Type=application/json' \
    --message-body='{"days":7}' \
    --oidc-service-account-email="${GCP_RUNTIME_SERVICE_ACCOUNT}" \
    --oidc-token-audience="${GCP_WORKER_URL}"
fi

if gcloud scheduler jobs describe oura-playlist-fallback --location="${GCP_REGION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http oura-playlist-fallback \
    --location="${GCP_REGION}" \
    --schedule='15 8 * * *' \
    --time-zone='America/New_York' \
    --uri="${GCP_PLAYLIST_FALLBACK_URI}" \
    --http-method=POST \
    --update-headers='Content-Type=application/json' \
    --message-body='{}' \
    --oidc-service-account-email="${GCP_RUNTIME_SERVICE_ACCOUNT}" \
    --oidc-token-audience="${GCP_WORKER_URL}" >/dev/null
else
  gcloud scheduler jobs create http oura-playlist-fallback \
    --location="${GCP_REGION}" \
    --schedule='15 8 * * *' \
    --time-zone='America/New_York' \
    --uri="${GCP_PLAYLIST_FALLBACK_URI}" \
    --http-method=POST \
    --headers='Content-Type=application/json' \
    --message-body='{}' \
    --oidc-service-account-email="${GCP_RUNTIME_SERVICE_ACCOUNT}" \
    --oidc-token-audience="${GCP_WORKER_URL}"
fi

if [[ "${GCP_ENABLE_AUTOMATION_CUTOVER:-false}" == "true" ]]; then
  gcloud scheduler jobs resume oura-export-reconciliation --location="${GCP_REGION}" >/dev/null || true
  gcloud scheduler jobs resume oura-playlist-fallback --location="${GCP_REGION}" >/dev/null || true
else
  gcloud scheduler jobs pause oura-export-reconciliation --location="${GCP_REGION}" >/dev/null || true
  gcloud scheduler jobs pause oura-playlist-fallback --location="${GCP_REGION}" >/dev/null || true
fi

echo
echo "Google Cloud deployment complete."
echo "Share the Google Doc with this Editor account: ${GCP_RUNTIME_SERVICE_ACCOUNT}"
echo "Set this callback URL in .env:"
echo "OURA_WEBHOOK_CALLBACK_URL=${GCP_WEBHOOK_URL}/oura-webhook"
echo "Then run: npm run manage:oura-webhooks"
echo "Set the Alexa skill endpoint to: ${GCP_WEBHOOK_URL}/alexa"
if [[ "${GCP_ENABLE_AUTOMATION_CUTOVER:-false}" != "true" ]]; then
  echo "Schedulers are paused. Set GCP_ENABLE_AUTOMATION_CUTOVER=true and redeploy after confirming AWS schedules are disabled."
fi
