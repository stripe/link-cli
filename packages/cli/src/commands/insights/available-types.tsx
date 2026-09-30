import type {
  AvailableInsightTypesPage,
  IInsightsResource,
  ListInsightTypesParams,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { upgradeCommand } from './upgrade-command';

interface AvailableTypesProps {
  resource: IInsightsResource;
  params: ListInsightTypesParams;
  onComplete: (result: AvailableInsightTypesPage | null) => void;
}

export const AvailableTypes: React.FC<AvailableTypesProps> = ({
  resource,
  params,
  onComplete,
}) => {
  const action = useCallback(
    () => resource.listAvailableTypes(params),
    [resource, params],
  );
  const { status, data: page, error } = useAsyncAction(action, onComplete);

  if (status === 'loading')
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Loading available insight types...
      </Text>
    );
  if (status === 'error')
    return (
      <Text color="red">Failed to load available insight types: {error}</Text>
    );
  if (!page?.data.length)
    return <Text dimColor>No insight types available</Text>;
  const command = upgradeCommand(
    page.data.map((insight) => insight.authorization_remediation),
  );

  return (
    <Box flexDirection="column">
      <Text bold>Available insight types</Text>
      {page.data.map((insight) => (
        <Box key={insight.id} flexDirection="column" marginTop={1}>
          <Text>{insight.description}</Text>
          <Text dimColor>ID: {insight.id}</Text>
          {insight.authorization_remediation ? (
            <Text color="yellow">
              Additional authorization is required; see --format json for
              details.
            </Text>
          ) : null}
        </Box>
      ))}
      {command ? (
        <Text color="yellow" wrap="wrap">
          Upgrade access: {command}
        </Text>
      ) : null}
      {page.has_more ? (
        <Text dimColor>Next page: --starting-after {page.data.at(-1)?.id}</Text>
      ) : null}
    </Box>
  );
};
