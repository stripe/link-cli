import type { IPaymentMethodsResource, PaymentMethod } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';

interface PaymentMethodsListProps {
  resource: IPaymentMethodsResource;
  onComplete: (result: PaymentMethod[] | null) => void;
}

export const PaymentMethodsList: React.FC<PaymentMethodsListProps> = ({
  resource,
  onComplete,
}) => {
  const action = useCallback(() => resource.listPaymentMethods(), [resource]);
  const { status, data: methods, error } = useAsyncAction(action, onComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading payment methods...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to load payment methods</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!methods || methods.length === 0) {
    return (
      <Box>
        <Text dimColor>No payment methods found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Payment Methods</Text>
      <Box flexDirection="column" marginTop={1}>
        {methods.map((pm) => {
          const label =
            pm.card_details?.brand ??
            pm.bank_account_details?.bank_name ??
            'Bank account';
          const last4 =
            pm.card_details?.last4 ?? pm.bank_account_details?.last4;
          const suffix = pm.nickname ? `(${pm.nickname})` : '';
          const agenticCap = pm.capabilities?.agentic_payments;
          const ineligible = agenticCap && !agenticCap.eligible;
          return (
            <Box key={pm.id} paddingX={2}>
              <Text>
                <Text dimColor>{pm.id}</Text>
                {'  '}
                {label} ****{last4}
                {suffix ? ` ${suffix}` : ''}
                {pm.is_default ? <Text color="green"> (default)</Text> : ''}
                {ineligible ? (
                  <Text dimColor>
                    {'  '}agentic_payments: ineligible
                    {agenticCap.ineligibility_reasons?.length > 0
                      ? ` (${agenticCap.ineligibility_reasons.join(', ')})`
                      : ''}
                  </Text>
                ) : null}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
