import type { UcpCheckout } from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { CheckoutSummary } from './checkout-summary';

interface CheckoutActionProps {
  action: () => Promise<UcpCheckout>;
  operation: 'update' | 'cancel';
  onComplete: (result: UcpCheckout | null) => void;
}

const labels = {
  update: { pending: 'Updating checkout...', success: 'Checkout updated' },
  cancel: { pending: 'Canceling checkout...', success: 'Checkout canceled' },
};

export function CheckoutAction({
  action,
  operation,
  onComplete,
}: CheckoutActionProps) {
  const { exit } = useApp();
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
        <Spinner type="dots" /> {labels[operation].pending}
      </Text>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to {operation} checkout</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ {labels[operation].success}</Text>
      {data && <CheckoutSummary checkout={data} />}
    </Box>
  );
}
