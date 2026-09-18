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

function formatLimit(value: number | null): string {
  return value === null ? 'Unlimited' : `${value} cents`;
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
        {userInfo?.address && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Address</Text>
            <Box flexDirection="column" paddingLeft={2}>
              <Text>
                <Text dimColor>Line 1: </Text>
                {userInfo.address.line1 ?? <Text dimColor>Not set</Text>}
              </Text>
              <Text>
                <Text dimColor>Line 2: </Text>
                {userInfo.address.line2 ?? <Text dimColor>Not set</Text>}
              </Text>
              <Text>
                <Text dimColor>City: </Text>
                {userInfo.address.city ?? <Text dimColor>Not set</Text>}
              </Text>
              <Text>
                <Text dimColor>State: </Text>
                {userInfo.address.state ?? <Text dimColor>Not set</Text>}
              </Text>
              <Text>
                <Text dimColor>Postal code: </Text>
                {userInfo.address.postal_code ?? <Text dimColor>Not set</Text>}
              </Text>
              <Text>
                <Text dimColor>Country: </Text>
                {userInfo.address.country ?? <Text dimColor>Not set</Text>}
              </Text>
            </Box>
          </Box>
        )}
        {userInfo?.eligible_for_balance !== undefined && (
          <Text>
            <Text dimColor>Eligible for balance: </Text>
            {userInfo.eligible_for_balance ? 'Yes' : 'No'}
          </Text>
        )}
        {userInfo?.agent_wallet_spend_limits && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Agent Wallet Spend Limits</Text>
            <Box flexDirection="column" paddingLeft={2}>
              <Text>
                <Text dimColor>Per-transaction: </Text>
                {formatLimit(
                  userInfo.agent_wallet_spend_limits.per_transaction.limit,
                )}
              </Text>
              <Text>
                <Text dimColor>Daily: </Text>
                limit{' '}
                {formatLimit(userInfo.agent_wallet_spend_limits.daily.limit)},
                used {userInfo.agent_wallet_spend_limits.daily.used} cents,
                remaining{' '}
                {formatLimit(
                  userInfo.agent_wallet_spend_limits.daily.remaining,
                )}
              </Text>
              <Text>
                <Text dimColor>30-day: </Text>
                limit{' '}
                {formatLimit(
                  userInfo.agent_wallet_spend_limits.thirty_day.limit,
                )}
                , used {userInfo.agent_wallet_spend_limits.thirty_day.used}{' '}
                cents, remaining{' '}
                {formatLimit(
                  userInfo.agent_wallet_spend_limits.thirty_day.remaining,
                )}
              </Text>
            </Box>
          </Box>
        )}
        {userInfo?.agent_wallet_verification_requirement && (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text dimColor>Agent Wallet verification requirement: </Text>
              {userInfo.agent_wallet_verification_requirement.status}
            </Text>
            {userInfo.agent_wallet_verification_requirement.action_url && (
              <Text>
                <Text dimColor>Action URL: </Text>
                {userInfo.agent_wallet_verification_requirement.action_url}
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};
