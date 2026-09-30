import type { DecodedMppChallenge } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import type React from 'react';

export function DecodeChallengeView({
  decoded,
}: {
  decoded: DecodedMppChallenge[];
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color="green">
        ✓ {decoded.length} supported challenge(s) decoded
      </Text>
      {decoded.map((challenge) => (
        <Box
          key={`${challenge.method}:${challenge.id}`}
          flexDirection="column"
          marginTop={1}
          paddingX={2}
        >
          <Text>
            Method: <Text bold>{challenge.method}</Text>
          </Text>
          <Text>
            ID: <Text bold>{challenge.id}</Text>
          </Text>
          <Text>
            Realm: <Text bold>{challenge.realm}</Text>
          </Text>
          <Text>
            Network ID: <Text bold>{challenge.network_id}</Text>
          </Text>
          <Text>Request JSON:</Text>
          <Text>{JSON.stringify(challenge.request_json, null, 2)}</Text>
        </Box>
      ))}
    </Box>
  );
}
