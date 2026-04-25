import { Box, Text } from 'ink';
import type React from 'react';
import { useMemo } from 'react';
import { renderQrMatrix } from '../../utils/render-qr-matrix';

const DOWNLOAD_URL = 'https://link.com/download';

export const AppDownloadQrCodes: React.FC = () => {
  const qrLines = useMemo(() => renderQrMatrix(DOWNLOAD_URL), []);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>
        Get the Link app to approve spend requests from your phone
      </Text>
      <Box flexDirection="column" alignItems="flex-start" marginTop={1}>
        {qrLines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable static array
          <Text key={i}>{line}</Text>
        ))}
        <Text dimColor>{DOWNLOAD_URL}</Text>
      </Box>
    </Box>
  );
};
