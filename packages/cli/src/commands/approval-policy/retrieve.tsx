// biome-ignore-all lint/suspicious/noArrayIndexKey: Policy rules are ordered and have no identifiers.
import type { ApprovalPolicy, IApprovalPolicyResource } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback } from 'react';
import { useAsyncAction } from '../../hooks/use-async-action';
import { formatAmount } from '../../utils/format-amount';

interface ApprovalPolicyRetrieveProps {
  resource: IApprovalPolicyResource;
  onComplete: (result: ApprovalPolicy | null) => void;
}

export const ApprovalPolicyRetrieve: React.FC<ApprovalPolicyRetrieveProps> = ({
  resource,
  onComplete,
}) => {
  const action = useCallback(() => resource.retrieve(), [resource]);
  const { status, data: policy, error } = useAsyncAction(action, onComplete);

  if (status === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading approval policy...
        </Text>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to load approval policy</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Approval Policy</Text>
      {policy?.rules.map((rule, index) => (
        <Box
          key={`rule-${index}`}
          flexDirection="column"
          marginTop={1}
          paddingX={2}
        >
          <Text bold>Rule {index + 1}</Text>
          <Text>
            <Text dimColor>Action: </Text>
            {rule.action}
          </Text>
          <Text>
            <Text dimColor>Per-purchase limit: </Text>
            {formatAmount(
              rule.limits.per_purchase.amount,
              rule.limits.per_purchase.currency,
            )}
          </Text>
          {rule.allowed_payment_methods ? (
            <Text>
              <Text dimColor>Allowed payment methods: </Text>
              {rule.allowed_payment_methods.length > 0
                ? rule.allowed_payment_methods.join(', ')
                : 'None'}
            </Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
};
