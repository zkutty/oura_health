import { CloudTasksClient } from '@google-cloud/tasks';
import { PlaylistTaskQueue } from '../services/playlistGenerationWorkflow';

export class GcpPlaylistTaskQueue implements PlaylistTaskQueue {
  constructor(private readonly client = new CloudTasksClient()) {}

  async enqueue(date: string, force = false): Promise<void> {
    const projectId = required('GCP_PROJECT_ID');
    const location = required('GCP_LOCATION');
    const queue = required('GCP_TASK_QUEUE');
    const workerUrl = required('GCP_WORKER_URL');
    const serviceAccountEmail = required('GCP_TASK_OIDC_SERVICE_ACCOUNT');

    await this.client.createTask({
      parent: this.client.queuePath(projectId, location, queue),
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: `${workerUrl}/tasks/generate-playlist`,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify({ date, force })),
          oidcToken: { serviceAccountEmail, audience: workerUrl },
        },
        dispatchDeadline: { seconds: 300 },
      },
    });
    console.log(JSON.stringify({ event: 'playlist_generation_queued', date, force }));
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
