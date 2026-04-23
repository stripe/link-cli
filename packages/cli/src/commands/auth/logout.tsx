import { storage } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';

interface LogoutProps {
  onComplete: () => void;
}

export const Logout: React.FC<LogoutProps> = ({ onComplete }) => {
  const [done, setDone] = useState(false);

  useEffect(() => {
    storage.clearAuth();
    storage.deleteConfig();
    setDone(true);
    setTimeout(onComplete, 1000);
  }, [onComplete]);

  if (!done) {
    return null;
  }

  return (
    <Box>
      <Text color="green">✓ Logged out successfully</Text>
    </Box>
  );
};
