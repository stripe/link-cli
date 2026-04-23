import type { IPaymentMethodsResource, PaymentMethod } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useState } from 'react';

interface PaymentMethodsListProps {
  resource: IPaymentMethodsResource;
  onComplete: () => void;
}

export const PaymentMethodsList: React.FC<PaymentMethodsListProps> = ({
  resource,
  onComplete,
}) => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  );
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await resource.listPaymentMethods();
        setMethods(result);
        setStatus('success');
        setTimeout(onComplete, 1500);
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
        setTimeout(onComplete, 1500);
      }
    };

    fetch();
  }, [resource, onComplete]);

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

  if (methods.length === 0) {
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
          const suffix = [pm.nickname ? `(${pm.nickname})` : '']
            .filter(Boolean)
            .join(' ');
          return (
            <Box key={pm.id} paddingX={2}>
              <Text>
                <Text dimColor>{pm.id}</Text>
                {'  '}
                {label} ****{last4}
                {suffix ? ` ${suffix}` : ''}
                {pm.is_default ? <Text color="green"> (default)</Text> : ''}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
