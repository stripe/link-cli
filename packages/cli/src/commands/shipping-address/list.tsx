import type {
  IShippingAddressResource,
  ShippingAddress,
  ShippingAddressRecord,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useState } from 'react';

interface ShippingAddressListProps {
  resource: IShippingAddressResource;
  onComplete: () => void;
}

function formatLocalityLine(address: ShippingAddress): string | null {
  const locality = [
    address.dependent_locality,
    address.locality,
    address.administrative_area,
  ]
    .filter(Boolean)
    .join(', ');
  const postal = [address.postal_code, address.sorting_code]
    .filter(Boolean)
    .join(' ');

  if (locality && postal) {
    return `${locality} ${postal}`;
  }

  return locality || postal || null;
}

function formatAddressLines(addressRecord: ShippingAddressRecord): string[] {
  if (!addressRecord.address) {
    return ['Address details unavailable'];
  }

  const address = addressRecord.address;
  const lines = [
    address.line_1,
    address.line_2,
    formatLocalityLine(address),
    address.country_code,
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines : ['Address details unavailable'];
}

export const ShippingAddressList: React.FC<ShippingAddressListProps> = ({
  resource,
  onComplete,
}) => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading',
  );
  const [shippingAddresses, setShippingAddresses] = useState<
    ShippingAddressRecord[]
  >([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await resource.listShippingAddresses();
        setShippingAddresses(result);
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
          <Spinner type="dots" /> Loading shipping addresses...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to load shipping addresses</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (shippingAddresses.length === 0) {
    return (
      <Box>
        <Text dimColor>No shipping addresses found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Shipping Addresses</Text>
      <Box flexDirection="column" marginTop={1}>
        {shippingAddresses.map((shippingAddress) => {
          const addressName = shippingAddress.address?.name;
          const headerParts = [
            shippingAddress.id,
            addressName,
            shippingAddress.nickname ? `(${shippingAddress.nickname})` : null,
          ].filter(Boolean);

          return (
            <Box
              key={shippingAddress.id}
              flexDirection="column"
              paddingX={2}
              marginBottom={1}
            >
              <Text>
                <Text dimColor>{headerParts.shift()}</Text>
                {headerParts.length > 0 ? `  ${headerParts.join(' ')}` : ''}
                {shippingAddress.is_default ? (
                  <Text color="green"> (default)</Text>
                ) : null}
              </Text>
              {formatAddressLines(shippingAddress).map((line) => (
                <Text key={`${shippingAddress.id}:${line}`}>{line}</Text>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
