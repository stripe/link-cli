import { z } from 'incur';

export const requestOptions = z.object({
  count: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .describe('Number of tokens to request'),
  accessToken: z
    .string()
    .optional()
    .describe(
      'Access token. Defaults to the stored credentials from "link-cli auth login".',
    ),
  outputFile: z
    .string()
    .optional()
    .describe(
      'Write the token artifact as JSON to this path (0600). Refuses to overwrite unless --force is set.',
    ),
  force: z
    .boolean()
    .default(false)
    .describe('Overwrite --output-file if it already exists.'),
});
