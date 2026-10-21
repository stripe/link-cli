import type { NextAction } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';

interface ResumingViewProps {
  nextAction: NextAction | null;
  requestId: string | undefined;
  timedOut?: boolean;
}

export const ResumingView: React.FC<ResumingViewProps> = ({
  nextAction,
  requestId,
  timedOut = false,
}) => {
  if (timedOut) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          ✗ Timed out waiting for verification to resolve
        </Text>
        <Text dimColor>
          Run `spend-request retrieve {requestId}` to check the current status.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan">
        <Spinner type="dots" /> Waiting for verification to complete...
      </Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>{nextAction?.display_message}</Text>
        {nextAction?.action_url && (
          <Text dimColor>
            URL: <Text color="cyan">{nextAction.action_url}</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
};
