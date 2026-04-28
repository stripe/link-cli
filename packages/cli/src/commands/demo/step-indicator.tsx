import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';

export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped';

interface StepIndicatorProps {
  label: string;
  status: StepStatus;
  detail?: string;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  label,
  status,
  detail,
}) => {
  switch (status) {
    case 'pending':
      return (
        <Text dimColor>
          {'  '}○ {label}
        </Text>
      );
    case 'active':
      return (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" /> {label}
          </Text>
        </Box>
      );
    case 'done':
      return (
        <Box flexDirection="column">
          <Text color="green">
            ✓ {label}
            {detail ? <Text dimColor> — {detail}</Text> : null}
          </Text>
        </Box>
      );
    case 'error':
      return (
        <Box flexDirection="column">
          <Text color="red">
            ✗ {label}
            {detail ? <Text dimColor> — {detail}</Text> : null}
          </Text>
        </Box>
      );
    case 'skipped':
      return (
        <Text color="yellow">
          {'  '}– {label} (skipped)
        </Text>
      );
  }
};
