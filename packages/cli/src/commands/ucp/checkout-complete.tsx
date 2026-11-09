import type {
  CompleteUcpCheckoutParams,
  IUcpResource,
  UcpCheckout,
} from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { CheckoutSummary } from './checkout-summary';

interface CheckoutCompleteProps {
  repository: IUcpResource;
  id: string;
  params: CompleteUcpCheckoutParams;
  onComplete: (result: UcpCheckout | null) => void;
}

export const CheckoutComplete: React.FC<CheckoutCompleteProps> = ({
  repository,
  id,
  params,
  onComplete,
}) => {
  const { exit } = useApp();
  const action = useCallback(
    () => repository.completeCheckout(id, params),
    [repository, id, params],
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
        <Spinner type="dots" /> Completing checkout...
      </Text>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to complete checkout</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Checkout completion response received</Text>
      {data && <CheckoutSummary checkout={data} />}
    </Box>
  );
};
