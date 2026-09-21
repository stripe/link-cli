import type {
  ISummariesResource,
  SummariesPage,
  SummaryDataValue,
  SummaryValue,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface SummariesListProps {
  resource: ISummariesResource;
  summaries?: string[];
  onComplete: (result: SummariesPage | null) => void;
}

export async function listAllSummaries(
  resource: ISummariesResource,
  summaries?: string[],
): Promise<SummariesPage> {
  const data: SummariesPage['data'] = [];
  let startingAfter: string | undefined;

  // The API itself supports a limit param, but I didn't see value in exposing that to the caller
  // while we still have such a small number of summaries and the CLI handles pagination, but that could
  // be a change here later.
  while (true) {
    const page = await resource.list({
      ...(summaries && summaries.length > 0 ? { summaries } : {}),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    data.push(...page.data);

    if (!page.has_more) return { data, has_more: false };

    const cursor = page.data.at(-1)?.id;
    if (!cursor || cursor === startingAfter) {
      throw new Error('Cannot advance summaries pagination cursor.');
    }
    startingAfter = cursor;
  }
}

function formatValue(value: SummaryValue | SummaryDataValue): string {
  if (value.unit === 'count') {
    const count = 'amount' in value ? value.amount : value.count;
    return (count as number).toLocaleString();
  }
  return `${value.currency.toUpperCase()} ${(value.amount / 100).toFixed(2)}`;
}

function formatAsOf(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timestamp * 1000));
}

export const SummariesList: React.FC<SummariesListProps> = ({
  resource,
  summaries,
  onComplete,
}) => {
  const action = useCallback(
    () => listAllSummaries(resource, summaries),
    [resource, summaries],
  );
  const { status, data: page, error } = useAsyncAction(action, onComplete);

  if (status === 'loading') {
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Loading summaries...
      </Text>
    );
  }
  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Failed to load summaries</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  const summariesData = page?.data ?? [];
  if (summariesData.length === 0)
    return <Text dimColor>No summaries found</Text>;

  const readySummaries = summariesData.filter(
    (summary) => summary.status === 'ready',
  );
  const pendingSummaries = summariesData.filter(
    (summary) => summary.status === 'pending',
  );
  const summariesWithoutData = summariesData.filter(
    (summary) => summary.status === 'no_data',
  );

  return (
    <Box flexDirection="column">
      <Text bold>Summaries</Text>
      {readySummaries.map((summary) => {
        const entries =
          summary.entries.length > 0 ? summary.entries : (summary.data ?? []);
        const title =
          summary.as_of !== undefined
            ? `${summary.description} (as of ${formatAsOf(summary.as_of)})`
            : summary.description;
        return (
          <Box key={summary.id} flexDirection="column" marginTop={1}>
            <Text bold wrap="wrap">
              {title}
            </Text>
            {entries.map((entry, index) => (
              <Box
                key={`${summary.id}-${entry.label}-${formatValue(entry.value)}`}
                paddingLeft={2}
              >
                <Text wrap="wrap">
                  {index + 1}. {entry.label} ({formatValue(entry.value)})
                </Text>
              </Box>
            ))}
          </Box>
        );
      })}
      {pendingSummaries.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            Data were not ready yet for these summaries; check again later:
          </Text>
          {pendingSummaries.map((summary, index) => (
            <Text key={summary.id} wrap="wrap">
              {index + 1}. {summary.description}
            </Text>
          ))}
        </Box>
      ) : null}
      {summariesWithoutData.map((summary) => (
        <Box key={summary.id} flexDirection="column" marginTop={1}>
          <Text wrap="wrap">{summary.description}</Text>
          <Text dimColor>No data is available for this summary</Text>
        </Box>
      ))}
    </Box>
  );
};
