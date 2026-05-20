import { type AuthStorage, storage as defaultStorage } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import { resolveAuthInfo } from './utils';

interface AuthStatusProps {
  authStorage?: AuthStorage;
  envAccessToken?: string;
  onComplete: () => void;
}

export const AuthStatus: React.FC<AuthStatusProps> = ({
  authStorage = defaultStorage,
  envAccessToken,
  onComplete,
}) => {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setChecked(true);
    setTimeout(onComplete, DISPLAY_DELAY_MS);
  }, [onComplete]);

  if (!checked) {
    return null;
  }

  const info = resolveAuthInfo(envAccessToken, authStorage);

  if (info.authenticated) {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ Authenticated</Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>
            Access token: <Text bold>{info.tokenPreview}</Text>
          </Text>
          <Text>
            Token type: <Text bold>{info.tokenType}</Text>
          </Text>
          {info.source === 'env' ? (
            <Text>
              Source: <Text bold>LINK_ACCESS_TOKEN</Text>
            </Text>
          ) : (
            <Text>
              Credentials: <Text bold>{info.credentialsPath}</Text>
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="yellow">✗ Not authenticated</Text>
      <Text dimColor>Run "link-cli auth login" to authenticate</Text>
      <Box marginTop={1} paddingX={2}>
        <Text>
          Credentials: <Text bold>{info.credentialsPath}</Text>
        </Text>
      </Box>
    </Box>
  );
};
