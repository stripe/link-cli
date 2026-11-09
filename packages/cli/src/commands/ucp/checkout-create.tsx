import type {
  CreateUcpCheckoutParams,
  IUcpResource,
  UcpCheckout,
} from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import {
  buildCommandContinuation,
  formatCommandSuggestion,
} from '../../utils/command-continuation';
import { CheckoutSummary } from './checkout-summary';

interface CheckoutCreateProps {
  repository: IUcpResource;
  params: CreateUcpCheckoutParams;
  onComplete: (result: UcpCheckout | null) => void;
}

export const CheckoutCreate: React.FC<CheckoutCreateProps> = ({
  repository,
  params,
  onComplete,
}) => {
  const { exit } = useApp();
  const action = useCallback(
    () => repository.createCheckout(params),
    [repository, params],
  );
  const wrappedOnComplete = useCallback(
    (result: UcpCheckout | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );
  const { status, data, error } = useAsyncAction(action, wrappedOnComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Creating checkout...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to create checkout</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  const spendRequest = buildCommandContinuation('spend-request', [
    'create',
    '--credential-type',
    'shared_payment_token',
    '--network-id',
    params.business,
  ]);
  const completion = data
    ? buildCommandContinuation('ucp', [
        'checkout',
        'complete',
        data.id,
        '--spend-request-id',
        '<spend_request_id>',
        '--business',
        params.business,
      ])
    : undefined;

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Checkout created</Text>
      {data && <CheckoutSummary checkout={data} />}
      <Box marginTop={1}>
        <Text dimColor>
          Review checkout messages and fulfillment choices. Use checkout update
          to resolve missing details before approving the final total. Create
          and approve a spend request using this business as the network ID:{' '}
          <Text color="cyan">{formatCommandSuggestion(spendRequest)}</Text>.
          Then complete (both --spend-request-id and --business are required):{' '}
          <Text color="cyan">
            {completion && formatCommandSuggestion(completion)}
          </Text>
          . Replace only the &lt;spend_request_id&gt; argument after approval.
        </Text>
      </Box>
    </Box>
  );
};
