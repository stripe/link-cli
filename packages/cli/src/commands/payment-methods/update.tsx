import type {
  IPaymentMethodsResource,
  PaymentMethod,
  UpdatePaymentMethodParams,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { sanitizeText } from '../../utils/sanitize-text';

interface PaymentMethodUpdateProps {
  resource: IPaymentMethodsResource;
  id: string;
  params: UpdatePaymentMethodParams;
  onComplete: (result: PaymentMethod) => void;
}

export const PaymentMethodUpdate: React.FC<PaymentMethodUpdateProps> = ({
  resource,
  id,
  params,
  onComplete,
}) => {
  const action = useCallback(
    () => resource.update(id, params),
    [resource, id, params],
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

  const messages: string[] = [];
  if (params.nickname !== undefined) {
    messages.push(
      method.nickname
        ? `Nickname updated to ${sanitizeText(method.nickname)}.`
        : 'Nickname cleared.',
    );
  }
  if (params.is_default !== undefined) {
    messages.push(
      method.is_default
        ? 'Default payment method set.'
        : 'Default payment method cleared.',
    );
  }
  return (
    <Box flexDirection="column">
      {messages.map((message) => (
        <Text key={message} color="green">
          ✓ {message}
        </Text>
      ))}
    </Box>
  );
};
