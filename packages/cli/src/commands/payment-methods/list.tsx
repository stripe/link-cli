import type {
  IPaymentMethodsResource,
  PaymentMethodsListResponse,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { formatAmount } from '../../utils/format-amount';

interface PaymentMethodsListProps {
  resource: IPaymentMethodsResource;
  onComplete: (result: PaymentMethodsListResponse | null) => void;
}

export const PaymentMethodsList: React.FC<PaymentMethodsListProps> = ({
  resource,
  onComplete,
}) => {
  const action = useCallback(() => resource.listWithMetadata(), [resource]);
  const { status, data: response, error } = useAsyncAction(action, onComplete);
  const methods = response?.payment_details;
  const unavailableCount = response?.unavailable_count ?? 0;
  const unavailableMessage =
    unavailableCount > 0
      ? `${unavailableCount} payment method${unavailableCount === 1 ? '' : 's'} ${unavailableCount === 1 ? 'is' : 'are'} unavailable for use.`
      : null;

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
      <Box flexDirection="column">
        <Text dimColor>No payment methods found</Text>
        {unavailableMessage && <Text dimColor>{unavailableMessage}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Payment Methods</Text>
      {unavailableMessage && <Text dimColor>{unavailableMessage}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {methods.map((pm) => {
          const label =
            pm.name ??
            pm.card_details?.brand ??
            pm.bank_account_details?.bank_name ??
            'Bank account';
          const last4 =
            pm.card_details?.last4 ?? pm.bank_account_details?.last4;
          const availableBalance = pm.balance_details?.available_balance;
          const details = last4
            ? ` ****${last4}`
            : availableBalance
              ? ` ${formatAmount(availableBalance.amount, availableBalance.currency)} available`
              : '';
          const suffix = pm.nickname ? `(${pm.nickname})` : '';
          const agenticCap = pm.capabilities?.agentic_payments;
          const ineligible = agenticCap && !agenticCap.eligible;
          return (
            <Box key={pm.id} paddingX={2}>
              <Text>
                <Text dimColor>{pm.id}</Text>
                {'  '}
                {label}
                {details}
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
