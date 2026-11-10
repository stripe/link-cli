import type { IUcpResource, UcpCheckout } from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { CheckoutSummary } from './checkout-summary';

interface CheckoutRetrieveProps {
  repository: IUcpResource;
  id: string;
  business: string;
  onComplete: (result: UcpCheckout | null) => void;
}

export function CheckoutRetrieve({
  repository,
  id,
  business,
  onComplete,
}: CheckoutRetrieveProps) {
  const { exit } = useApp();
  const action = useCallback(
    () => repository.retrieveCheckout(id, { business }),
    [repository, id, business],
  );
  const finish = useCallback(
    (result: UcpCheckout | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );
  const { status, data, error } = useAsyncAction(action, finish);

  if (status === 'loading') {
    return (
      <Text color="cyan">
        <Spinner type="dots" /> Retrieving checkout...
      </Text>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to retrieve checkout</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Checkout retrieved</Text>
      {data && <CheckoutSummary checkout={data} />}
    </Box>
  );
}
