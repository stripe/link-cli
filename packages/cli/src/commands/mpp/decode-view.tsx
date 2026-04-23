import { Box, Text } from 'ink';
import type React from 'react';
import type { DecodedStripeChallenge } from './decode';

export function DecodeChallengeView({
  decoded,
}: {
  decoded: DecodedStripeChallenge;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color="green">✓ Stripe challenge decoded</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>
          ID: <Text bold>{decoded.id}</Text>
        </Text>
        <Text>
          Realm: <Text bold>{decoded.realm}</Text>
        </Text>
        <Text>
          Network ID: <Text bold>{decoded.network_id}</Text>
        </Text>
        <Text>Request JSON:</Text>
        <Text>{JSON.stringify(decoded.request_json, null, 2)}</Text>
      </Box>
    </Box>
  );
}
