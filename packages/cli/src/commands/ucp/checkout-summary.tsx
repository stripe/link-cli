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
  const total =
    checkout.totals?.find((entry) => entry.type === 'total')?.amount ??
    checkout.amount_total;
  const subtotal =
    checkout.totals?.find((entry) => entry.type === 'subtotal')?.amount ??
    checkout.amount_subtotal;
  const shipping =
    checkout.totals?.find((entry) => entry.type === 'fulfillment')?.amount ??
    (checkout.total_details as { amount_shipping?: number })?.amount_shipping;
  const orderStatus =
    (checkout.order as { id?: string })?.id ??
    (checkout.order_details as { status?: string })?.status;
  const lineItems =
    checkout.line_items?.map((line) => ({
      sku_id: line.item.id,
      quantity: line.quantity,
      amount_total: line.totals?.find((entry) => entry.type === 'total')
        ?.amount,
    })) ??
    (Array.isArray(checkout.line_item_details)
      ? (checkout.line_item_details as Array<{
          sku_id?: string;
          quantity?: number;
          amount_total?: number;
        }>)
      : []);

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
