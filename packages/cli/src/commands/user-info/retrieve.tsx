import type { IUserInfoResource, UserInfo } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useState } from 'react';

interface UserInfoRetrieveProps {
  resource: IUserInfoResource;
  onComplete: () => void;
}

export const UserInfoRetrieve: React.FC<UserInfoRetrieveProps> = ({
  resource,
  onComplete,
}) => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  );
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await resource.retrieve();
        setUserInfo(result);
        setStatus('success');
        setTimeout(onComplete, 1500);
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
        setTimeout(onComplete, 1500);
      }
    };

    fetch();
  }, [resource, onComplete]);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading user info...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to load user info</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>User Info</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>
          <Text dimColor>Email: </Text>
          {userInfo?.email ?? <Text dimColor>Not set</Text>}
        </Text>
        <Text>
          <Text dimColor>Name: </Text>
          {userInfo?.name ?? <Text dimColor>Not set</Text>}
        </Text>
        <Text>
          <Text dimColor>Phone: </Text>
          {userInfo?.phone ?? <Text dimColor>Not set</Text>}
        </Text>
      </Box>
    </Box>
  );
};
