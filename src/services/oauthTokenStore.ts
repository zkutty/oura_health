import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface OAuthTokenStore {
  load(): Promise<OAuthTokens | undefined>;
  save(tokens: OAuthTokens): Promise<void>;
}

type OAuthProvider = 'OURA' | 'SPOTIFY';

class GcpSecretManagerTokenStore implements OAuthTokenStore {
  private readonly client = new SecretManagerServiceClient();

  constructor(
    private readonly projectId: string,
    private readonly accessSecretId: string,
    private readonly refreshSecretId: string
  ) {}

  async load(): Promise<OAuthTokens> {
    const [accessVersion, refreshVersion] = await Promise.all([
      this.client.accessSecretVersion({
        name: `projects/${this.projectId}/secrets/${this.accessSecretId}/versions/latest`,
      }),
      this.client.accessSecretVersion({
        name: `projects/${this.projectId}/secrets/${this.refreshSecretId}/versions/latest`,
      }),
    ]);

    const accessToken = accessVersion[0].payload?.data?.toString();
    const refreshToken = refreshVersion[0].payload?.data?.toString();
    if (!accessToken || !refreshToken) {
      throw new Error('Secret Manager returned an empty OAuth token');
    }
    return { accessToken, refreshToken };
  }

  async save(tokens: OAuthTokens): Promise<void> {
    await Promise.all([
      this.client.addSecretVersion({
        parent: `projects/${this.projectId}/secrets/${this.accessSecretId}`,
        payload: { data: Buffer.from(tokens.accessToken, 'utf8') },
      }),
      this.client.addSecretVersion({
        parent: `projects/${this.projectId}/secrets/${this.refreshSecretId}`,
        payload: { data: Buffer.from(tokens.refreshToken, 'utf8') },
      }),
    ]);
  }
}

class AwsSsmTokenStore implements OAuthTokenStore {
  private readonly client = new SSMClient({});

  constructor(
    private readonly accessParameter: string,
    private readonly refreshParameter: string
  ) {}

  async load(): Promise<OAuthTokens | undefined> {
    try {
      const [accessResult, refreshResult] = await Promise.all([
        this.client.send(new GetParameterCommand({ Name: this.accessParameter, WithDecryption: true })),
        this.client.send(new GetParameterCommand({ Name: this.refreshParameter, WithDecryption: true })),
      ]);
      const accessToken = accessResult.Parameter?.Value;
      const refreshToken = refreshResult.Parameter?.Value;
      return accessToken && refreshToken ? { accessToken, refreshToken } : undefined;
    } catch (error: any) {
      if (error?.name === 'ParameterNotFound') return undefined;
      throw error;
    }
  }

  async save(tokens: OAuthTokens): Promise<void> {
    await Promise.all([
      this.client.send(new PutParameterCommand({
        Name: this.accessParameter,
        Value: tokens.accessToken,
        Type: 'SecureString',
        Overwrite: true,
      })),
      this.client.send(new PutParameterCommand({
        Name: this.refreshParameter,
        Value: tokens.refreshToken,
        Type: 'SecureString',
        Overwrite: true,
      })),
    ]);
  }
}

export function createOAuthTokenStore(provider: OAuthProvider): OAuthTokenStore | undefined {
  const persistence = process.env[`${provider}_TOKEN_PERSISTENCE`];
  if (!persistence || persistence === 'none') return undefined;

  if (persistence === 'gcp-secret-manager') {
    const projectId = process.env.GCP_PROJECT_ID;
    const accessSecretId = process.env[`${provider}_ACCESS_TOKEN_SECRET_ID`];
    const refreshSecretId = process.env[`${provider}_REFRESH_TOKEN_SECRET_ID`];
    if (!projectId || !accessSecretId || !refreshSecretId) {
      throw new Error(`${provider} Secret Manager token persistence is missing required configuration`);
    }
    return new GcpSecretManagerTokenStore(projectId, accessSecretId, refreshSecretId);
  }

  if (persistence === 'aws-ssm') {
    const stage = process.env.AWS_STAGE || process.env.STAGE || 'dev';
    const basePath = `/oura-health/${stage}/${provider.toLowerCase()}`;
    return new AwsSsmTokenStore(
      process.env[`${provider}_ACCESS_TOKEN_PARAMETER`] || `${basePath}/access-token`,
      process.env[`${provider}_REFRESH_TOKEN_PARAMETER`] || `${basePath}/refresh-token`
    );
  }

  throw new Error(`Unsupported ${provider} token persistence backend: ${persistence}`);
}
