import { AttributeValue, DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

export interface PlaylistGenerationState {
  date: string;
  status: 'pending' | 'generated';
  attempts: number;
  updatedAt: string;
  lastError?: string;
}

export interface PlaylistGenerationStateStore {
  get(date: string): Promise<PlaylistGenerationState | undefined>;
  recordAttempt(date: string, lastError?: string): Promise<void>;
  markGenerated(date: string): Promise<void>;
}

export class DynamoDbPlaylistGenerationStateStore implements PlaylistGenerationStateStore {
  constructor(
    private readonly tableName: string,
    private readonly client: DynamoDBClient = new DynamoDBClient({})
  ) {}

  async get(date: string): Promise<PlaylistGenerationState | undefined> {
    const result = await this.client.send(new GetItemCommand({
      TableName: this.tableName,
      Key: { date: { S: date } },
      ConsistentRead: true,
    }));
    const item = result.Item;
    if (!item) return undefined;
    return {
      date,
      status: item.status?.S === 'generated' ? 'generated' : 'pending',
      attempts: Number(item.attempts?.N || 0),
      updatedAt: item.updatedAt?.S || '',
      lastError: item.lastError?.S,
    };
  }

  async recordAttempt(date: string, lastError?: string): Promise<void> {
    const values: Record<string, AttributeValue> = {
      ':pending': { S: 'pending' },
      ':one': { N: '1' },
      ':updatedAt': { S: new Date().toISOString() },
    };
    let updateExpression = 'SET #status = if_not_exists(#status, :pending), updatedAt = :updatedAt ADD attempts :one';
    if (lastError) {
      values[':lastError'] = { S: lastError.slice(0, 1000) };
      updateExpression = 'SET #status = if_not_exists(#status, :pending), updatedAt = :updatedAt, lastError = :lastError ADD attempts :one';
    }
    await this.client.send(new UpdateItemCommand({
      TableName: this.tableName,
      Key: { date: { S: date } },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: values,
    }));
  }

  async markGenerated(date: string): Promise<void> {
    await this.client.send(new UpdateItemCommand({
      TableName: this.tableName,
      Key: { date: { S: date } },
      UpdateExpression: 'SET #status = :generated, updatedAt = :updatedAt REMOVE lastError',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':generated': { S: 'generated' },
        ':updatedAt': { S: new Date().toISOString() },
      },
    }));
  }
}

export class PlaylistGenerationGuard {
  constructor(
    private readonly store: PlaylistGenerationStateStore,
    private readonly maxAttempts: number
  ) {}

  async shouldAttempt(date: string): Promise<boolean> {
    const state = await this.store.get(date);
    return state?.status !== 'generated' && (state?.attempts || 0) < this.maxAttempts;
  }

  recordAttempt(date: string, error?: string): Promise<void> {
    return this.store.recordAttempt(date, error);
  }

  markGenerated(date: string): Promise<void> {
    return this.store.markGenerated(date);
  }
}
