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

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Checkout created</Text>
      {data && <CheckoutSummary checkout={data} />}
      <Box marginTop={1}>
        <Text dimColor>
          Mint and approve a Shared Payment Token using this business as the
          network ID:{' '}
          <Text color="cyan">
            spend-request create --credential-type shared_payment_token
            --network-id {params.profile_id}
          </Text>
          . Then complete:{' '}
          <Text color="cyan">ucp checkout complete {data?.id}</Text>
        </Text>
      </Box>
    </Box>
  );
};
