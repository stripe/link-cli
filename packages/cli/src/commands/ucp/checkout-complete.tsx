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
          <Spinner type="dots" /> Completing checkout...
        </Text>
      </Box>
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
      <Text color="green">✓ Checkout completed</Text>
      {data && <CheckoutSummary checkout={data} />}
    </Box>
  );
};
