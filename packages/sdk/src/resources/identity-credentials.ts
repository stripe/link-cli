import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { LinkApiError } from '@/errors';
import { BaseResource } from '@/resources/base';
import { parseHolderPublicJwk } from '@/resources/holder-jwk';
import type {
  IIdentityCredentialsResource,
  IssueIdentityCredentialParams,
  IssueIdentityCredentialResponse,
} from '@/resources/interfaces';

const LINK_ISSUER = 'https://api.link.com';
const LINK_ISSUER_METADATA_URL = `${LINK_ISSUER}/.well-known/aap-issuer`;

const identityCredentialIssuerMetadataSchema = z.looseObject({
  issuer: z.literal(LINK_ISSUER),
  credential_endpoint: z.string(),
});

const issueIdentityCredentialResponseSchema = z.looseObject({
  credential: z.string(),
  issuer: z.literal(LINK_ISSUER),
  expires_at: z.string(),
});

/** Accepts a discovered endpoint only when it remains on api.link.com. */
function requireLinkEndpoint(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError(`${field} is not a valid URL`, { cause: error });
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== LINK_ISSUER ||
    url.username ||
    url.password
  ) {
    throw new TypeError(`${field} must be an HTTPS URL on ${LINK_ISSUER}`);
  }
  return url.href;
}

export class IdentityCredentialsResource
  extends BaseResource
  implements IIdentityCredentialsResource
{
  constructor(options: LinkOptions) {
    super(options, '');
  }

  private async discoverCredentialEndpoint(): Promise<string> {
    const { status, data, rawBody } = await this.rawFetch({
      method: 'GET',
      url: LINK_ISSUER_METADATA_URL,
      redirect: 'manual',
    });
    if (status >= 300 && status < 400) {
      throw new LinkApiError(
        `Refused redirect while fetching identity credential issuer metadata (${status})`,
        { status, rawBody },
      );
    }

    if (status < 200 || status >= 300) {
      this.throwApiError(
        'fetch identity credential issuer metadata',
        status,
        data,
        rawBody,
      );
    }

    const metadata = this.parseResponse(
      'parse identity credential issuer metadata',
      status,
      () => identityCredentialIssuerMetadataSchema.parse(data),
    );
    return this.parseResponse(
      'validate identity credential issuer metadata',
      status,
      () =>
        requireLinkEndpoint(
          metadata.credential_endpoint,
          'credential_endpoint',
        ),
    );
  }

  async issue(
    params: IssueIdentityCredentialParams,
  ): Promise<IssueIdentityCredentialResponse> {
    const publicJwk = parseHolderPublicJwk(params.cnf.jwk);
    const endpoint = await this.discoverCredentialEndpoint();
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: endpoint,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ cnf: { jwk: publicJwk } }),
    });

    if (status >= 300 && status < 400) {
      throw new LinkApiError(
        `Refused redirect while issuing identity credential (${status})`,
        { status, rawBody },
      );
    }

    if (status < 200 || status >= 300) {
      this.throwApiError('issue identity credential', status, data, rawBody);
    }

    return this.parseResponse('issue identity credential', status, () =>
      issueIdentityCredentialResponseSchema.parse(data),
    );
  }
}
