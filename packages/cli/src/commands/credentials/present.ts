import { createHash, sign } from 'node:crypto';
import path from 'node:path';
import { holderJwksEqual, parseHolderPublicJwk } from '@stripe/link-sdk';
import { z } from 'incur';
import { readArtifact } from '../identity/artifact-reader';
import { loadHolderKey } from './holder-key';
import { presentOptions } from './schema';
import { getOutputDirectory } from './storage';

const artifactSchema = z.object({
  version: z.literal(1),
  credential: z.string().min(1),
  holder: z.object({ path: z.string().min(1) }),
});

// Link's flat SD-JWT profile. Unknown plaintext claims cannot be hidden when
// forwarding the issuer JWT, so reject them rather than disclose them silently.
const payloadSchema = z
  .object({
    iss: z.literal('https://api.link.com'),
    vct: z.string().min(1),
    exp: z.number().int(),
    iat: z.number().int().optional(),
    nbf: z.number().int().optional(),
    aud: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    cnf: z.object({ jwk: z.unknown() }).strict(),
    _sd: z.array(z.string()).default([]),
    _sd_alg: z.literal('sha-256').default('sha-256'),
    status: z.unknown().optional(),
    'vct#integrity': z.string().optional(),
  })
  .strict();

const disclosureSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.unknown(),
]);

function decodeJson(segment: string): unknown {
  try {
    const bytes = Buffer.from(segment, 'base64url');
    if (!segment || bytes.toString('base64url') !== segment) throw new Error();
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    // JSON parse errors may quote personal information from the credential.
    throw new Error('Saved credential contains invalid base64url JSON.');
  }
}

function hasNestedDisclosure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, '_sd') || Object.hasOwn(value, '...')) return true;
  return Object.values(value).some(hasNestedDisclosure);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export async function presentIdentityCredential(
  input: z.infer<typeof presentOptions>,
) {
  const options = presentOptions.parse(input);
  const file = path.join(getOutputDirectory(), 'current.json');
  let artifact: z.infer<typeof artifactSchema>;
  try {
    artifact = await readArtifact(file, artifactSchema);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'No saved identity credential. Run identity credentials request first.',
      );
    }
    throw error;
  }

  const [issuerJwt, ...disclosures] = artifact.credential.split('~');
  if (!issuerJwt || disclosures.pop() !== '') {
    throw new Error(
      'Saved credential must be an SD-JWT without a Key Binding JWT.',
    );
  }
  const segments = issuerJwt.split('.');
  if (
    segments.length !== 3 ||
    segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    throw new Error('Saved credential has an invalid issuer JWT.');
  }
  const header = z
    .object({ typ: z.enum(['dc+sd-jwt', 'vc+sd-jwt']) })
    .safeParse(decodeJson(segments[0]));
  const parsed = payloadSchema.safeParse(decodeJson(segments[1]));
  if (!header.success || !parsed.success) {
    throw new Error(
      'Saved credential does not use the supported Link SD-JWT profile (flat disclosures, SHA-256, no plaintext user claims).',
    );
  }
  const payload = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error(
      'Saved identity credential has expired. Run identity credentials request again.',
    );
  }
  if (payload.nbf !== undefined && payload.nbf > now) {
    throw new Error('Saved identity credential is not yet valid.');
  }
  if (
    payload.aud !== undefined &&
    !(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(
      options.aud,
    )
  ) {
    throw new Error('Saved credential is restricted to a different audience.');
  }
  const committed = new Set(payload._sd);
  if (committed.size !== payload._sd.length) {
    throw new Error(
      'Saved credential contains duplicate disclosure commitments.',
    );
  }
  for (const [name, value] of Object.entries(payload)) {
    if (name !== '_sd' && hasNestedDisclosure(value)) {
      throw new Error('Nested selective disclosure is not supported.');
    }
  }

  const available = new Map<string, string>();
  for (const disclosure of disclosures) {
    const decoded = disclosureSchema.safeParse(decodeJson(disclosure));
    if (!decoded.success || !committed.has(digest(disclosure))) {
      throw new Error(
        'Saved credential contains an invalid or uncommitted disclosure.',
      );
    }
    const [, name, value] = decoded.data;
    if (
      name === '...' ||
      Object.hasOwn(payloadSchema.shape, name) ||
      available.has(name)
    ) {
      throw new Error(
        'Saved credential contains a reserved or duplicate disclosure claim.',
      );
    }
    if (hasNestedDisclosure(value)) {
      throw new Error('Nested selective disclosure is not supported.');
    }
    available.set(name, disclosure);
  }
  const selected = [...new Set(options.claim)].map((name) => {
    const disclosure = available.get(name);
    if (!disclosure)
      throw new Error(
        `Requested claim is not available for selective disclosure: ${name}`,
      );
    return disclosure;
  });

  let holder: ReturnType<typeof loadHolderKey>;
  try {
    holder = loadHolderKey(artifact.holder.path);
  } catch (error) {
    throw new Error(
      'Unable to load the saved holder key. It must exist, contain a valid private JWK, and not be a symbolic link.',
      { cause: error },
    );
  }
  if (
    !holderJwksEqual(holder.publicJwk, parseHolderPublicJwk(payload.cnf.jwk))
  ) {
    throw new Error(
      'Saved holder key does not match the credential cnf.jwk. Request a new credential.',
    );
  }

  // Keep the issuer JWT and encoded disclosures byte-for-byte. RFC 9901 hashes
  // the selected SD-JWT including the final tilde immediately before the KB-JWT.
  const sdPart = `${[issuerJwt, ...selected].join('~')}~`;
  const kbInput = `${encodeJson({ typ: 'kb+jwt', alg: 'EdDSA' })}.${encodeJson({
    aud: options.aud,
    nonce: options.nonce,
    iat: now,
    sd_hash: digest(sdPart),
  })}`;
  const signature = sign(
    null,
    Buffer.from(kbInput),
    holder.privateKey,
  ).toString('base64url');
  return { presentation: `${sdPart}${kbInput}.${signature}` };
}
