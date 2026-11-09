import { z } from 'zod';

export const simulateOptions = z.object({
  scenario: z
    .string()
    .optional()
    .describe(
      'Sample scenario ID chosen by the evaluation harness. Requires Link login or LINK_ACCESS_TOKEN. Currently uses local fixtures; URLs are synthetic and no spend request or verification session is created. Use --list-scenarios for IDs.',
    ),
  listScenarios: z
    .boolean()
    .default(false)
    .describe(
      'List available spend-request simulation scenarios. Choose exactly one of --scenario or --list-scenarios. Requires Link login or LINK_ACCESS_TOKEN; the backend catalog will replace local fixtures after deployment.',
    ),
});
