import { type AuthStorage, storage as defaultStorage } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import type { IAuthResource } from '../../auth/types';
import { DISPLAY_DELAY_MS } from '../../utils/constants';

interface LogoutProps {
  authResource: IAuthResource;
  authStorage?: AuthStorage;
  onComplete: () => void;
}

export const Logout: React.FC<LogoutProps> = ({
  authResource,
  authStorage = defaultStorage,
  onComplete,
}) => {
  const storage = authStorage;
  const [done, setDone] = useState(false);

  useEffect(() => {
    const run = async () => {
      const auth = storage.getAuth();
      if (auth?.refresh_token) {
        try {
          await authResource.revokeToken(auth.refresh_token);
        } catch {
          // best-effort: clear local storage regardless
        }
      }
      storage.clearAuth();
      storage.deleteConfig();
      setDone(true);
      setTimeout(onComplete, DISPLAY_DELAY_MS);
    };
    run();
  }, [authResource, onComplete, storage]);

  if (!done) {
    return null;
  }

  return (
    <Box>
      <Text color="green">✓ Logged out successfully</Text>
    </Box>
  );
};
