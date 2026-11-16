import path from 'node:path';
import {
  createPresentation,
  LinkConfigurationError,
  LinkPresentationError,
  type LinkPresentationErrorCode,
} from '@stripe/link-sdk';
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

const holderKeyError =
  'Unable to load the saved holder key. It must exist, contain a valid private JWK, and not be a symbolic link.';

const errorMessages: Record<
  Exclude<LinkPresentationErrorCode, 'claim_unavailable'>,
  string
> = {
  invalid_credential:
    'Saved credential must be an SD-JWT without a Key Binding JWT.',
  invalid_issuer_jwt: 'Saved credential has an invalid issuer JWT.',
  invalid_base64url_json: 'Saved credential contains invalid base64url JSON.',
  unsupported_profile:
    'Saved credential does not use the supported Link SD-JWT profile (flat disclosures, SHA-256, no plaintext user claims).',
  credential_expired:
    'Saved identity credential has expired. Run identity credentials request again.',
  credential_not_yet_valid: 'Saved identity credential is not yet valid.',
  audience_restricted:
    'Saved credential is restricted to a different audience.',
  duplicate_commitments:
    'Saved credential contains duplicate disclosure commitments.',
  nested_disclosure: 'Nested selective disclosure is not supported.',
  invalid_disclosure:
    'Saved credential contains an invalid or uncommitted disclosure.',
  reserved_or_duplicate_claim:
    'Saved credential contains a reserved or duplicate disclosure claim.',
  invalid_holder_key: holderKeyError,
  holder_key_mismatch:
    'Saved holder key does not match the credential cnf.jwk. Request a new credential.',
};

function toCliError(error: unknown): unknown {
  if (!(error instanceof LinkPresentationError)) return error;
  if (error.code === 'claim_unavailable') {
    return new Error(
      `Requested claim is not available for selective disclosure: ${error.claim}`,
    );
  }
  // An unsupported cnf.jwk reports the holder key parser's own error.
  if (
    error.code === 'unsupported_profile' &&
    error.cause instanceof LinkConfigurationError
  ) {
    return error.cause;
  }
  return new Error(errorMessages[error.code], { cause: error });
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

  try {
    const presentation = await createPresentation({
      credential: artifact.credential,
      // Loaded only after the credential and requested claims are validated.
      holderKey: () => {
        try {
          return loadHolderKey(artifact.holder.path).privateKey.export({
            format: 'jwk',
          });
        } catch (error) {
          throw new Error(holderKeyError, { cause: error });
        }
      },
      aud: options.aud,
      nonce: options.nonce,
      disclose: options.claim,
    });
    return { presentation };
  } catch (error) {
    throw toCliError(error);
  }
}
