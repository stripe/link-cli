import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import {
  type CliAuthStorage,
  storage as defaultStorage,
} from '../../auth/storage';
import type { IAuthResource } from '../../auth/types';
import { useAsyncAction } from '../../hooks/use-async-action';

interface LogoutProps {
  authResource: IAuthResource;
  authStorage?: CliAuthStorage;
  onComplete: () => void;
}

export const Logout: React.FC<LogoutProps> = ({
  authResource,
  authStorage = defaultStorage,
  onComplete,
}) => {
  const storage = authStorage;

  const action = useCallback(async () => {
    const auth = storage.getTokens();
    if (auth?.refresh_token) {
      try {
        await authResource.revokeToken(auth.refresh_token);
      } catch {
        // best-effort: clear local storage regardless
      }
    }
    storage.clearTokens();
    storage.deleteConfig();
  }, [authResource, storage]);

  const { status } = useAsyncAction(action, onComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Logging out...
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color="green">✓ Logged out successfully</Text>
    </Box>
  );
};
