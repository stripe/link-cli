import type { IPaymentMethodsResource, PaymentMethod } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface PaymentMethodRetrieveProps {
  resource: IPaymentMethodsResource;
  id: string;
  onComplete: (result: PaymentMethod | null) => void;
}

export const PaymentMethodRetrieve: React.FC<PaymentMethodRetrieveProps> = ({
  resource,
  id,
  onComplete,
}) => {
  const action = useCallback(() => resource.retrieve(id), [resource, id]);
  const { status, data: method, error } = useAsyncAction(action, onComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading payment method...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to load payment method</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!method) {
    return <Text dimColor>Payment method {id} not found</Text>;
  }

  const details = method.card_details ?? method.bank_account_details;
  const agenticCap = method.capabilities?.agentic_payments;
  const ineligibilityReasons = agenticCap?.ineligibility_reasons ?? [];

  return (
    <Box flexDirection="column">
      <Text bold>Payment Method</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>
          <Text dimColor>ID: </Text>
          {method.id}
        </Text>
        <Text>
          <Text dimColor>Type: </Text>
          {method.type}
        </Text>
        <Text>
          <Text dimColor>Name: </Text>
          {method.name}
        </Text>
        {method.nickname ? (
          <Text>
            <Text dimColor>Nickname: </Text>
            {method.nickname}
          </Text>
        ) : null}
        {details?.last4 ? (
          <Text>
            <Text dimColor>Last four: </Text>
            {details.last4}
          </Text>
        ) : null}
        <Text>
          <Text dimColor>Default: </Text>
          {method.is_default ? 'yes' : 'no'}
        </Text>
        {agenticCap ? (
          <Text>
            <Text dimColor>Agentic payments: </Text>
            {agenticCap.eligible
              ? 'eligible'
              : `ineligible${ineligibilityReasons.length ? ` (${ineligibilityReasons.join(', ')})` : ''}`}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
};
