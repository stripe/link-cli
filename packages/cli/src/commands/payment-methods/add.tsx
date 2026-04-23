import { Box, Text, useApp, useInput } from 'ink';
import type React from 'react';
import { openUrl } from '../../utils/open-url';

export const WALLET_URL = 'https://app.link.com/wallet';

export const AddPaymentMethod: React.FC = () => {
  const { exit } = useApp();

  useInput((_input, key) => {
    if (key.return) {
      openUrl(WALLET_URL);
      exit();
    }
  });

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Add Payment Method</Text>
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
            {WALLET_URL}
          </Text>
        </Text>
        <Text dimColor>Press Enter to open in browser</Text>
      </Box>
    </Box>
  );
};
