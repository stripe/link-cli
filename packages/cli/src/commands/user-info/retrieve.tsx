import type { IUserInfoResource, UserInfo } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface UserInfoRetrieveProps {
  resource: IUserInfoResource;
  onComplete: (result: UserInfo | null) => void;
}

export const UserInfoRetrieve: React.FC<UserInfoRetrieveProps> = ({
  resource,
  onComplete,
}) => {
  const action = useCallback(() => resource.retrieve(), [resource]);
  const { status, data: userInfo, error } = useAsyncAction(action, onComplete);

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
