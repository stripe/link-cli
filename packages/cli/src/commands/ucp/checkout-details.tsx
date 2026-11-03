import type { UcpCheckout } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import { formatAmount } from '../../utils/format-amount';
import { asRecords, checkoutMessages, textField } from './checkout-messages';

export function CheckoutMessages({ checkout }: { checkout: UcpCheckout }) {
  const messages = checkoutMessages(checkout);
  if (!messages.length) return null;
  const occurrences = new Map<string, number>();
  const keyedMessages = messages.map((message) => {
    const serialized = JSON.stringify(message);
    const count = occurrences.get(serialized) ?? 0;
    occurrences.set(serialized, count + 1);
    return { ...message, key: `${serialized}:${count}` };
  });
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Messages:</Text>
      {keyedMessages.map((message) => (
        <Box key={message.key} flexDirection="column" paddingLeft={2}>
          <Text
            color={
              message.type === 'error'
                ? 'red'
                : message.type === 'warning'
                  ? 'yellow'
                  : 'cyan'
            }
          >
            {message.type.toUpperCase()}
            {message.code ? ` [${message.code}]` : ''}
            {message.severity ? ` (${message.severity})` : ''}
          </Text>
          <Text>{message.content}</Text>
          {message.path && <Text dimColor>Field: {message.path}</Text>}
          {message.url && <Text>URL: {message.url}</Text>}
        </Box>
      ))}
    </Box>
  );
}

export function CheckoutBuyer({ checkout }: { checkout: UcpCheckout }) {
  const buyer = checkout.buyer;
  const name = [buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ');
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Buyer:</Text>
      <Box flexDirection="column" paddingLeft={2}>
        {name && <Text>{name}</Text>}
        {buyer?.email && <Text>{buyer.email}</Text>}
        {buyer?.phone_number && <Text>{buyer.phone_number}</Text>}
        {!name && !buyer?.email && !buyer?.phone_number && (
          <Text dimColor>Not provided</Text>
        )}
      </Box>
    </Box>
  );
}

export function CheckoutFulfillment({ checkout }: { checkout: UcpCheckout }) {
  const methods = asRecords(checkout.fulfillment?.methods);
  const selectedMethods = methods.filter(
    (method) =>
      textField(method.selected_destination_id) ||
      asRecords(method.groups).some((group) =>
        textField(group.selected_option_id),
      ),
  );
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Fulfillment:</Text>
      {!methods.length && (
        <Box paddingLeft={2}>
          <Text dimColor>Not provided</Text>
        </Box>
      )}
      {methods.length > 0 && !selectedMethods.length && (
        <Box flexDirection="column" paddingLeft={2}>
          <Text>No destination selected</Text>
          <Text>
            No{' '}
            {methods.every((method) => method.type === 'shipping')
              ? 'shipping'
              : 'fulfillment'}{' '}
            option selected
          </Text>
        </Box>
      )}
      {selectedMethods.map((method, index) => {
        const destinationId = textField(method.selected_destination_id);
        const destination = destinationId
          ? asRecords(method.destinations).find(
              (entry) => entry.id === destinationId,
            )
          : undefined;
        const recipient = destination
          ? [destination.first_name, destination.last_name]
              .map(textField)
              .filter(Boolean)
              .join(' ')
          : undefined;
        const groups = asRecords(method.groups);
        return (
          <Box
            key={textField(method.id) ?? index}
            flexDirection="column"
            paddingLeft={2}
          >
            <Text>
              Method: {textField(method.type) ?? 'Not specified'}
              {textField(method.id) ? ` (ID: ${method.id})` : ''}
            </Text>
            <Text>
              {destinationId
                ? `Selected destination ID: ${destinationId}`
                : 'No destination selected'}
            </Text>
            {destination && (
              <Box flexDirection="column" paddingLeft={2}>
                {recipient && <Text>{recipient}</Text>}
                {[
                  ['street_address'],
                  ['extended_address'],
                  ['address_locality', 'address_region', 'postal_code'],
                  ['address_country'],
                  ['phone_number'],
                ].map((fields) => {
                  const value = fields
                    .map((field) => textField(destination[field]))
                    .filter(Boolean)
                    .join(' ');
                  return value ? <Text key={fields[0]}>{value}</Text> : null;
                })}
              </Box>
            )}
            {!groups.length && (
              <Text>
                No {method.type === 'shipping' ? 'shipping' : 'fulfillment'}{' '}
                option selected
              </Text>
            )}
            {groups.map((group, groupIndex) => {
              const optionId = textField(group.selected_option_id);
              const option = optionId
                ? asRecords(group.options).find(
                    (entry) => entry.id === optionId,
                  )
                : undefined;
              const total = asRecords(option?.totals).find(
                (entry) => entry.type === 'total',
              );
              const amount =
                typeof total?.amount === 'number' ? total.amount : undefined;
              return (
                <Box
                  key={textField(group.id) ?? groupIndex}
                  flexDirection="column"
                >
                  {textField(group.id) && (
                    <Text>Fulfillment group ID: {textField(group.id)}</Text>
                  )}
                  <Text>
                    {optionId ? (
                      <>
                        Selected option
                        {textField(option?.title) ? `: ${option?.title}` : ''}{' '}
                        (ID: {optionId})
                        {amount !== undefined
                          ? ` — ${formatAmount(amount, checkout.currency ?? 'usd')}`
                          : ''}
                      </>
                    ) : (
                      `No ${method.type === 'shipping' ? 'shipping' : 'fulfillment'} option selected`
                    )}
                  </Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
