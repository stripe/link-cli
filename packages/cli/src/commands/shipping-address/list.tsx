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

function formatStreetLine(address: ShippingAddress): string | null {
  const parts = [address.line_1, address.line_2].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
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

  const localityPostal =
    locality && postal
      ? `${locality} ${postal}`
      : locality || postal || null;

  if (localityPostal && address.country_code) {
    return `${localityPostal}, ${address.country_code}`;
  }

  return localityPostal || address.country_code || null;
}

function formatAddressLines(addressRecord: ShippingAddressRecord): string[] {
  if (!addressRecord.address) {
    return ['Address details unavailable'];
  }

  const address = addressRecord.address;
  const lines = [
    formatStreetLine(address),
    formatLocalityLine(address),
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
          const nickname = shippingAddress.nickname
            ? ` (${shippingAddress.nickname})`
            : '';

          return (
            <Box
              key={shippingAddress.id}
              flexDirection="column"
              paddingX={2}
              marginBottom={1}
            >
              <Text>
                <Text dimColor>{shippingAddress.id}</Text>
                {nickname}
                {shippingAddress.is_default ? (
                  <Text color="green"> (default)</Text>
                ) : null}
              </Text>
              <Box flexDirection="column" marginTop={1}>
                {addressName ? <Text bold>{addressName}</Text> : null}
                {formatAddressLines(shippingAddress).map((line) => (
                  <Text key={`${shippingAddress.id}:${line}`}>{line}</Text>
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
