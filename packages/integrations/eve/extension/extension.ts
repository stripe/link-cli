import { defineExtension } from 'eve/extension';
import type { ToolAuthProvider } from 'eve/tools';
import { z } from 'zod';

type LinkExtensionConfig = { accessToken: string } | { auth: ToolAuthProvider };

const config: z.ZodType<LinkExtensionConfig, LinkExtensionConfig> = z.union([
  z.strictObject({
    accessToken: z.string().trim().min(1, 'Provide a Link access token.'),
  }),
  z.strictObject({
    auth: z.custom<ToolAuthProvider>(
      (value) =>
        value !== null &&
        typeof value === 'object' &&
        'getToken' in value &&
        typeof value.getToken === 'function',
      'Provide an Eve authorization provider.',
    ),
  }),
]);

export default defineExtension({ config });
