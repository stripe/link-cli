import { z } from 'zod';

export const simulateOptions = z.object({
  scenario: z
    .string()
    .optional()
    .describe(
      'Exact sample scenario ID (visa_otp aliases partner_auth_challenge). Simulation only: no request, authentication, or verification is performed.',
    ),
  listScenarios: z
    .boolean()
    .default(false)
    .describe(
      'List the local simulation catalog and provenance. Choose exactly one of --scenario or --list-scenarios; synthetic URLs do not work.',
    ),
});
