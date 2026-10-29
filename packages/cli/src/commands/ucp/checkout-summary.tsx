import type { UcpCheckout } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import type React from 'react';
import { formatAmount as formatCurrencyAmount } from '../../utils/format-amount';

function formatAmount(
  amount?: number | null,
  currency?: string | null,
): string {
  if (amount == null) return 'N/A';
  return formatCurrencyAmount(amount, currency ?? 'usd');
}

interface CheckoutSummaryProps {
  checkout: UcpCheckout;
}

/** Shared presentational summary of a UCP checkout session (create + complete). */
export const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({
  checkout,
}) => {
  const total = checkout.totals?.find(
    (entry) => entry.type === 'total',
  )?.amount;
  const subtotal = checkout.totals?.find(
    (entry) => entry.type === 'subtotal',
  )?.amount;
  const shipping = checkout.totals?.find(
    (entry) => entry.type === 'fulfillment',
  )?.amount;
  const orderId = checkout.order?.id;
  const lineItems = checkout.line_items ?? [];

  return (
    <Box flexDirection="column" marginTop={1} paddingX={2}>
      <Text>
        ID:{' '}
        <Text bold color="white">
          {checkout.id}
        </Text>
      </Text>
      {checkout.status && (
        <Text>
          Status:{' '}
          <Text bold color="white">
            {checkout.status}
          </Text>
        </Text>
      )}
      {total != null && (
        <Text>
          Total:{' '}
          <Text bold color="white">
            {formatAmount(total, checkout.currency)}
          </Text>
        </Text>
      )}
      {subtotal != null && (
        <Text>
          Subtotal:{' '}
          <Text bold color="white">
            {formatAmount(subtotal, checkout.currency)}
          </Text>
        </Text>
      )}
      {shipping != null && (
        <Text>
          Shipping:{' '}
          <Text bold color="white">
            {formatAmount(shipping, checkout.currency)}
          </Text>
        </Text>
      )}
      {lineItems.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="white">
            Line Items:
          </Text>
          {lineItems.map((line, index) => {
            const amount = line.totals?.find(
              (entry) => entry.type === 'total',
            )?.amount;
            return (
              <Text key={line.id ?? String(index)}>
                {'  '}
                {line.item.id} ×{line.quantity}
                {amount != null
                  ? `  ${formatAmount(amount, checkout.currency)}`
                  : ''}
              </Text>
            );
          })}
        </Box>
      )}
      {orderId && (
        <Text>
          Order:{' '}
          <Text bold color="white">
            {orderId}
          </Text>
        </Text>
      )}
      {checkout.expires_at != null && (
        <Text dimColor>Expires: {checkout.expires_at}</Text>
      )}
    </Box>
  );
};
