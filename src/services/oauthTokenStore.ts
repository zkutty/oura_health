import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

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

  throw new Error(`Unsupported ${provider} token persistence backend: ${persistence}`);
}
