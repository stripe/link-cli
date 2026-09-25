'use client';

import { linkClient } from '@stripe/link-integrations-better-auth/client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ plugins: [linkClient()] });
