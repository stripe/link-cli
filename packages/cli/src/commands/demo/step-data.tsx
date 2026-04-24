import { Box, Text } from 'ink';
import type React from 'react';

interface StepDataProps {
  data: Record<string, unknown>;
}

export const StepData: React.FC<StepDataProps> = ({ data }) => {
  const entries = Object.entries(data).filter(
    ([, v]) => v !== undefined && v !== null,
  );

  const maxKeyLen = Math.max(...entries.map(([k]) => k.length));

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      marginTop={1}
      borderStyle="single"
      borderColor="gray"
    >
      {entries.map(([key, value]) => (
        <Text key={key}>
          <Text dimColor>{key.padEnd(maxKeyLen)}</Text>
          {'  '}
          <Text>
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </Text>
        </Text>
      ))}
    </Box>
  );
};
