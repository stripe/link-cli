import { storage } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';

interface AuthStatusProps {
  onComplete: () => void;
}

export const AuthStatus: React.FC<AuthStatusProps> = ({ onComplete }) => {
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [tokenPreview, setTokenPreview] = useState('');
  const [tokenType, setTokenType] = useState('');
  const [credentialsPath, setCredentialsPath] = useState('');

  useEffect(() => {
    const auth = storage.getAuth();
    const credentialsPath = storage.getPath();
    if (auth) {
      setAuthenticated(true);
      setTokenPreview(`${auth.access_token.substring(0, 20)}...`);
      setTokenType(auth.token_type);
    }
    setCredentialsPath(credentialsPath);
    setChecked(true);
    setTimeout(onComplete, 1000);
  }, [onComplete]);

  if (!checked) {
    return null;
  }

  if (authenticated) {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ Authenticated</Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>
            Access token: <Text bold>{tokenPreview}</Text>
          </Text>
          <Text>
            Token type: <Text bold>{tokenType}</Text>
          </Text>
          <Text>
            Credentials: <Text bold>{credentialsPath}</Text>
          </Text>
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
          Credentials: <Text bold>{credentialsPath}</Text>
        </Text>
      </Box>
    </Box>
  );
};
