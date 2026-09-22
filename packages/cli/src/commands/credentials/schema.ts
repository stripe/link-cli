import { z } from 'incur';

export const presentOptions = z
  .object({
    aud: z
      .string()
      .min(1)
      .optional()
      .describe('Exact audience from the verifier challenge'),
    nonce: z
      .string()
      .min(1)
      .optional()
      .describe('Nonce from the verifier challenge'),
    claim: z
      .array(z.string().min(1))
      .default([])
      .describe(
        'Top-level claim to disclose (required and repeatable in manual mode, e.g. --claim email)',
      ),
    openid4vpChallenge: z
      .url()
      .optional()
      .describe(
        'OpenID4VP authorization request URL; derives audience, nonce, and claims from DCQL',
      ),
    x401Resource: z
      .url()
      .optional()
      .describe(
        'x401-protected GET resource; answers PROOF-REQUEST with a Result Artifact',
      ),
    submit: z
      .boolean()
      .default(false)
      .describe(
        'Submit the OpenID4VP response or retry the x401 resource with proof',
      ),
  })
  .superRefine((options, context) => {
    const protocolOptions = [
      options.openid4vpChallenge,
      options.x401Resource,
    ].filter(Boolean);
    if (protocolOptions.length > 1) {
      context.addIssue({
        code: 'custom',
        path: ['x401Resource'],
        message:
          '--openid4vp-challenge and --x401-resource are mutually exclusive',
      });
    }
    if (protocolOptions.length > 0) {
      for (const field of ['aud', 'nonce'] as const) {
        if (options[field] !== undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `--${field} cannot be used with a protocol challenge option`,
          });
        }
      }
      if (options.claim.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['claim'],
          message: '--claim cannot be used with a protocol challenge option',
        });
      }
      return;
    }

    if (!options.aud) {
      context.addIssue({
        code: 'custom',
        path: ['aud'],
        message: '--aud is required in manual mode',
      });
    }
    if (!options.nonce) {
      context.addIssue({
        code: 'custom',
        path: ['nonce'],
        message: '--nonce is required in manual mode',
      });
    }
    if (options.claim.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['claim'],
        message: '--claim is required in manual mode',
      });
    }
    if (options.submit) {
      context.addIssue({
        code: 'custom',
        path: ['submit'],
        message: '--submit requires --openid4vp-challenge or --x401-resource',
      });
    }
  });
