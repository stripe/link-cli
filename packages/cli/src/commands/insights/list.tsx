import type {
  IInsightsResource,
  Insight,
  InsightsPage,
  ListInsightsParams,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { upgradeCommand } from './upgrade-command';

interface InsightsListProps {
  resource: IInsightsResource;
  params: ListInsightsParams;
  onComplete: (result: InsightsPage | null) => void;
}

function formatAsOf(timestamp: number | null | undefined): string | null {
  if (timestamp == null) return null;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatInsightValue(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const tagged = value as Record<string, unknown>;
    if (tagged.type === 'number_of_items') {
      const items = tagged.number_of_items;
      if (
        items !== null &&
        typeof items === 'object' &&
        !Array.isArray(items)
      ) {
        const fields = items as Record<string, unknown>;
        if (
          typeof fields.label === 'string' &&
          typeof fields.count === 'number'
        )
          return `${fields.label} (count: ${fields.count.toLocaleString()})`;
      }
    }
  }
  // Future value types should remain visible even before this client learns to format them.
  return JSON.stringify(value) ?? String(value);
}

function InsightCard({ insight }: { insight: Insight }) {
  const asOf = formatAsOf(insight.as_of);
  const title = asOf
    ? `${insight.description} (as of ${asOf})`
    : insight.description;
  const entries = insight.data ?? [];
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold wrap="wrap">
        {title}
      </Text>
      <Text dimColor>ID: {insight.id}</Text>
      {insight.status === 'pending' ? (
        <Text dimColor>Pending; check again later.</Text>
      ) : insight.status === 'no_data' ? (
        <>
          <Text dimColor>
            {insight.error_message ?? 'No data is available.'}
          </Text>
          {insight.authorization_remediation ? (
            <Text color="yellow">
              Additional authorization is required; see --format json for
              details.
            </Text>
          ) : null}
        </>
      ) : insight.status === 'ready' ? (
        entries.length ? (
          entries.map((entry, index) => (
            <Text
              key={`${insight.id}-${entry.label}-${JSON.stringify(entry.value)}`}
              wrap="wrap"
            >
              {index + 1}. {entry.label}: {formatInsightValue(entry.value)}
            </Text>
          ))
        ) : (
          <Text dimColor>No entries returned.</Text>
        )
      ) : (
        <Text dimColor>
          Status: {insight.status}. See --format json for the full response.
        </Text>
      )}
    </Box>
  );
}

export const InsightsList: React.FC<InsightsListProps> = ({
  resource,
  params,
  onComplete,
}) => {
  const action = useCallback(() => resource.list(params), [resource, params]);
  const { status, data: page, error } = useAsyncAction(action, onComplete);

  if (status === 'loading')
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Loading insights...
      </Text>
    );
  if (status === 'error')
    return <Text color="red">Failed to load insights: {error}</Text>;
  if (!page?.data.length) return <Text dimColor>No insights found</Text>;
  const command = upgradeCommand(
    page.data.map((insight) => insight.authorization_remediation),
  );

  return (
    <Box flexDirection="column">
      <Text bold>Insights</Text>
      {page.data.map((insight) => (
        <InsightCard key={insight.id} insight={insight} />
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
