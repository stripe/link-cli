import { defineExtension } from 'eve/extension';
import { z } from 'zod';

export default defineExtension({
  config: z.object({
    accessToken: z.string().trim().min(1, 'Provide a Link access token.'),
  }),
});
