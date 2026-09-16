import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { type InspectResult, type InspectTool, runInspect } from './inspect';

interface InspectViewProps {
  url: string;
  timeoutMs?: number;
  onComplete: (result: InspectResult | null) => void;
}

function ToolList({ label, tools }: { label: string; tools: InspectTool[] }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{label}</Text>
      {tools.map((tool) => (
        <Box
          key={`${tool.command}:${tool.url ?? ''}`}
          flexDirection="column"
          paddingLeft={2}
        >
          <Text color="green">{tool.command}</Text>
          <Text dimColor>{tool.description}</Text>
          {tool.url ? <Text dimColor>{tool.url}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

export const InspectView: React.FC<InspectViewProps> = ({
  url,
  timeoutMs,
  onComplete,
}) => {
  const { exit } = useApp();
  const action = useCallback(
    () => runInspect(url, { timeoutMs }),
    [url, timeoutMs],
  );
  const handleComplete = useCallback(
    (result: InspectResult | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );
  const { status, data, error } = useAsyncAction(action, handleComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Inspecting {url}...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Inspection failed</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!data) return null;

  const tools = data.available_tools;

  return (
    <Box flexDirection="column">
      <Text>
        Inspected <Text bold>{data.display_name ?? data.url}</Text>
      </Text>
      {data.display_name ? <Text dimColor>{data.url}</Text> : null}
      {data.description ? <Text>{data.description}</Text> : null}
      {data.llms_txt ? (
        <Text dimColor>llms.txt: {data.llms_txt.join(', ')}</Text>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {tools?.machine_payments ? (
          <ToolList label="Machine payments" tools={tools.machine_payments} />
        ) : null}
        {tools?.mcp ? <ToolList label="MCP" tools={tools.mcp} /> : null}
        {tools?.provisioning ? (
          <ToolList label="Provisioning" tools={tools.provisioning} />
        ) : null}
        {tools?.browser_checkout ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Browser checkout</Text>
            <Box flexDirection="column" paddingLeft={2}>
              {tools.browser_checkout.merchant_advice ? (
                <Text>Merchant: {tools.browser_checkout.merchant_advice}</Text>
              ) : null}
              {tools.browser_checkout.general_advice ? (
                <Text dimColor>{tools.browser_checkout.general_advice}</Text>
              ) : null}
            </Box>
          </Box>
        ) : null}
        {!tools ? <Text dimColor>No available tools detected.</Text> : null}
      </Box>
    </Box>
  );
};
