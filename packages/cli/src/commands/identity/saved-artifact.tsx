import { Box, Text } from 'ink';
import type React from 'react';

export interface SavedArtifactDetail {
  label: string;
  value: string | number;
}

export function SavedArtifact({
  message,
  outputFile,
  details = [],
}: {
  message: string;
  outputFile: string;
  details?: SavedArtifactDetail[];
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color="green">✓ {message}</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>
          <Text dimColor>Saved to: </Text>
          {outputFile}
        </Text>
        {details.map(({ label, value }) => (
          <Text key={label}>
            <Text dimColor>{label}: </Text>
            {value}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
