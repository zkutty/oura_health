# Google Cloud migration runbook

## Runtime inventory and disposition

| Legacy AWS function | Google Cloud disposition |
| --- | --- |
| Alexa HTTP handler | `/alexa` on the public `oura-health-webhook` Cloud Run service |
| Oura webhook verification/receiver | `/oura-webhook` on the public service |
| Oura SQS processor | Cloud Tasks to private `oura-health-worker` |
| Oura reconciliation schedule | Cloud Scheduler to `/tasks/reconcile` |
| Playlist generation and retry schedules | Event-driven Cloud Task plus 8:15 AM Eastern fallback |
| Morning and evening lighting schedules | Decommissioned: the configured Alexa routine provider is a stub; ZK-65 tracks a real provider |

The AWS Lambda handler, Serverless configuration, DynamoDB/SQS/SSM clients, and
AWS deployment dependencies have been removed. Local `node-cron` routes remain
for development only and are not a production runtime.

## Safe cutover

1. Disable any deployed EventBridge schedules before enabling GCP jobs. This
   avoids duplicate exports and playlist writes.
2. Set `GCP_ENABLE_AUTOMATION_CUTOVER=true` in `.env`.
3. Run `npm run deploy:gcp`.
4. Set the Oura webhook callback and run `npm run manage:oura-webhooks`.
5. Change the Alexa custom skill endpoint to the printed Cloud Run `/alexa` URL.
6. Trigger `/admin/reexport?date=YYYY-MM-DD`, then verify:
   - the Google Doc entry is current;
   - a separate playlist task ran;
   - Firestore `playlistGenerationState/YYYY-MM-DD` is `generated` with a
     fingerprint, attempt count, and Spotify snapshot ID;
   - repeating the same event does not update Spotify again.
7. Observe Cloud Run, Cloud Tasks, Scheduler, Firestore, and Secret Manager for
   at least one normal overnight cycle before deleting legacy AWS resources.

## Rollback

Pause the two GCP jobs immediately:

```bash
gcloud scheduler jobs pause oura-export-reconciliation --location=us-east1
gcloud scheduler jobs pause oura-playlist-fallback --location=us-east1
```

Point the Oura subscription and Alexa endpoint back to the last known-good
runtime only if that runtime still exists. Cloud Run revisions can be rolled
back without changing Firestore state. Do not run two scheduled systems at once.

## AWS teardown

After parity is confirmed, delete the old CloudFormation stack or its Lambda,
EventBridge, SQS, DynamoDB, SSM, API Gateway, and log resources in the AWS
account. This repository no longer contains tooling that performs that deletion,
so verify the exact stack and account in the AWS console before removal.
