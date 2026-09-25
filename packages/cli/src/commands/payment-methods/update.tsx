import type { IPaymentMethodsResource, PaymentMethod } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { sanitizeText } from '../../utils/sanitize-text';

interface PaymentMethodUpdateProps {
  resource: IPaymentMethodsResource;
  id: string;
  nickname: string;
  onComplete: (result: PaymentMethod) => void;
}

export const PaymentMethodUpdate: React.FC<PaymentMethodUpdateProps> = ({
  resource,
  id,
  nickname,
  onComplete,
}) => {
  const action = useCallback(
    () => resource.update(id, { nickname }),
    [resource, id, nickname],
  );
  const {
    status,
    data: method,
    error,
  } = useAsyncAction(action, (result) => {
    if (result) onComplete(result);
  });

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Updating payment method...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to update payment method</Text>
        <Text color="red">{sanitizeText(error)}</Text>
      </Box>
    );
  }

  if (!method) return null;

  return method.nickname ? (
    <Text color="green">✓ Nickname updated to {method.nickname}.</Text>
  ) : (
    <Text color="green">✓ Nickname cleared.</Text>
  );
};
