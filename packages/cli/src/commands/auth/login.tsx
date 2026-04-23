import { storage } from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useState } from 'react';
import type { IAuthResource } from '../../auth/types';
import { openUrl } from '../../utils/open-url';

interface LoginProps {
  authResource: IAuthResource;
  clientName?: string;
  onComplete: () => void;
}

export const Login: React.FC<LoginProps> = ({
  authResource,
  clientName,
  onComplete,
}) => {
  const [status, setStatus] = useState<
    'initiating' | 'waiting' | 'polling' | 'success' | 'error'
  >('initiating');
  const [userCode, setUserCode] = useState<string>('');
  const [verificationUrl, setVerificationUrl] = useState<string>('');
  const [deviceCode, setDeviceCode] = useState<string>('');
  const [error, setError] = useState<string>('');

  const isActive = status === 'waiting' || status === 'polling';

  useInput(
    (_input, key) => {
      if (key.return && verificationUrl) openUrl(verificationUrl);
    },
    { isActive },
  );

  useEffect(() => {
    const initAuth = async () => {
      try {
        const authRequest = await authResource.initiateDeviceAuth(clientName);
        setUserCode(authRequest.user_code);
        setVerificationUrl(authRequest.verification_url_complete);
        setDeviceCode(authRequest.device_code);
        setStatus('waiting');
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
      }
    };

    initAuth();
  }, [authResource, clientName]);

  useEffect(() => {
    if (status !== 'waiting' || !deviceCode) return;

    const startPolling = async () => {
      setStatus('polling');

      const pollInterval = setInterval(async () => {
        try {
          const tokens = await authResource.pollDeviceAuth(deviceCode);

          if (tokens) {
            clearInterval(pollInterval);
            storage.setAuth(tokens);
            setStatus('success');
            setTimeout(onComplete, 1000);
          }
        } catch (err) {
          clearInterval(pollInterval);
          setError((err as Error).message);
          setStatus('error');
        }
      }, 2000);

      // Cleanup on unmount
      return () => clearInterval(pollInterval);
    };

    // Wait 1 second before starting to poll
    const timeout = setTimeout(startPolling, 1000);
    return () => clearTimeout(timeout);
  }, [status, deviceCode, authResource, onComplete]);

  if (status === 'initiating') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Initiating authentication...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Authentication failed</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (status === 'success') {
    return (
      <Box flexDirection="column">
        <Text color="green">✓ Successfully authenticated!</Text>
        <Text dimColor>Credentials saved locally</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Link CLI Authentication</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text>
          Open:{' '}
          <Text bold color="cyan">
            {verificationUrl}
          </Text>
        </Text>
        <Text dimColor>Press Enter to open in browser</Text>
        <Text>
          Enter passphrase:{' '}
          <Text bold color="yellow">
            {userCode}
          </Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        {status === 'polling' ? (
          <Text color="cyan">
            <Spinner type="dots" /> Waiting for authorization...
          </Text>
        ) : (
          <Text dimColor>Press any key after authorizing...</Text>
        )}
      </Box>
    </Box>
  );
};
