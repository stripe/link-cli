import type { IWebBotAuthResource, WebBotAuthBlock } from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface WebBotAuthSignProps {
  resource: IWebBotAuthResource;
  url: string;
  onComplete: (result: WebBotAuthBlock | null) => void;
}

export const WebBotAuthSign: React.FC<WebBotAuthSignProps> = ({
  resource,
  url,
  onComplete,
}) => {
  const { exit } = useApp();
  const action = useCallback(() => resource.getHeaders(url), [resource, url]);
  const handleComplete = useCallback(
    (result: WebBotAuthBlock | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );
  const { status, data: block, error } = useAsyncAction(action, handleComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Getting Web Bot Auth headers...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to get Web Bot Auth headers</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!block) return null;

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Web Bot Auth headers obtained</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>
          <Text dimColor>Signature: </Text>
          {block.signature}
        </Text>
        <Text>
          <Text dimColor>Signature-Input: </Text>
          {block.signature_input}
        </Text>
        <Text>
          <Text dimColor>Authority: </Text>
          {block.authority}
        </Text>
        <Text>
          <Text dimColor>Expires: </Text>
          {block.expires_at}
        </Text>
      </Box>
    </Box>
  );
};
