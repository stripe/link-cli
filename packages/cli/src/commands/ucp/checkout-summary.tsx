import type { UcpCheckout } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import type React from 'react';

function formatAmount(
  amount?: number | null,
  currency?: string | null,
): string {
  if (amount == null) return 'N/A';
  return `$${(amount / 100).toFixed(2)} ${(currency ?? 'usd').toUpperCase()}`;
}

interface CheckoutSummaryProps {
  checkout: UcpCheckout;
}

/** Shared presentational summary of a UCP checkout session (create + complete). */
export const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({
  checkout,
}) => {
  const shipping = (checkout.total_details as { amount_shipping?: number })
    ?.amount_shipping;
  const orderStatus = (checkout.order_details as { status?: string })?.status;
  const lineItems = Array.isArray(checkout.line_item_details)
    ? (checkout.line_item_details as Array<{
        sku_id?: string;
        quantity?: number;
        amount_total?: number;
      }>)
    : [];

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
      {checkout.amount_total != null && (
        <Text>
          Total:{' '}
          <Text bold color="white">
            {formatAmount(checkout.amount_total, checkout.currency)}
          </Text>
        </Text>
      )}
      {checkout.amount_subtotal != null && (
        <Text>
          Subtotal:{' '}
          <Text bold color="white">
            {formatAmount(checkout.amount_subtotal, checkout.currency)}
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
          {lineItems.map((item, index) => (
            <Text key={item.sku_id ?? String(index)}>
              {'  '}
              {item.sku_id ?? '—'} ×{item.quantity ?? 1}
              {item.amount_total != null
                ? `  ${formatAmount(item.amount_total, checkout.currency)}`
                : ''}
            </Text>
          ))}
        </Box>
      )}
      {orderStatus && (
        <Text>
          Order:{' '}
          <Text bold color="white">
            {orderStatus}
          </Text>
        </Text>
      )}
      {checkout.expires_at != null && (
        <Text dimColor>
          Expires: {new Date(checkout.expires_at * 1000).toISOString()}
        </Text>
      )}
    </Box>
  );
};
