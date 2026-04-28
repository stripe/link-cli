import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import { storage } from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useCallback, useState } from 'react';
import type { IAuthResource } from '../../auth/types';
import { MarkdownText } from '../../utils/markdown-text';
import { Login } from '../auth/login';
import { AppDownloadQrCodes } from '../spend-request/app-download-qr-codes';
import { CardFlow } from './card-flow';
import { DEMO_MENU as M, ONBOARD as O } from './content';
import { SptFlow } from './spt-flow';

type Choice = 'card' | 'spt' | 'both';
type Phase =
  | 'auth'
  | 'menu'
  | 'card-flow'
  | 'card-done'
  | 'spt-flow'
  | 'summary';

interface DemoRunnerProps {
  authRepo: IAuthResource;
  spendRequestRepo: ISpendRequestResource;
  paymentMethodsResource: IPaymentMethodsResource;
  paymentMethodId?: string;
  onlyCard?: boolean;
  onlySpt?: boolean;
  onComplete: () => void;
}

export const DemoRunner: React.FC<DemoRunnerProps> = ({
  authRepo,
  spendRequestRepo,
  paymentMethodsResource,
  paymentMethodId: preselectedPmId,
  onlyCard,
  onlySpt,
  onComplete,
}) => {
  const preselected = onlyCard ? 'card' : onlySpt ? 'spt' : null;
  const [choice, setChoice] = useState<Choice | null>(preselected);
  const [menuIndex, setMenuIndex] = useState(0);

  const postAuthPhase: Phase =
    preselected === 'spt' ? 'spt-flow' : preselected ? 'card-flow' : 'menu';
  const [phase, setPhase] = useState<Phase>(
    storage.isAuthenticated() ? postAuthPhase : 'auth',
  );
  const [paymentMethodId, setPaymentMethodId] = useState<string>(
    preselectedPmId ?? '',
  );
  const [cardSuccess, setCardSuccess] = useState<boolean | null>(null);
  const [sptSuccess, setSptSuccess] = useState<boolean | null>(null);

  const runCard = choice === 'card' || choice === 'both';
  const runSpt = choice === 'spt' || choice === 'both';

  useInput((_input, key) => {
    if (phase === 'menu') {
      if (key.upArrow) {
        setMenuIndex((i) => (i > 0 ? i - 1 : M.options.length - 1));
      } else if (key.downArrow) {
        setMenuIndex((i) => (i < M.options.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        const selected = M.options[menuIndex].key;
        setChoice(selected);
        setPhase(selected === 'spt' ? 'spt-flow' : 'card-flow');
      }
    } else if (phase === 'card-done' && key.return) {
      setPhase('spt-flow');
    }
  });

  const onCardComplete = useCallback(
    (result: { paymentMethodId: string; success: boolean }) => {
      setPaymentMethodId(result.paymentMethodId);
      setCardSuccess(result.success);

      if (!runSpt) {
        setPhase('summary');
        setTimeout(onComplete, 1500);
      } else {
        setPhase('card-done');
      }
    },
    [runSpt, onComplete],
  );

  const onSptComplete = useCallback(
    (success: boolean) => {
      setSptSuccess(success);
      setPhase('summary');
      setTimeout(onComplete, 1500);
    },
    [onComplete],
  );

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{M.title}</Text>
        <Text>{M.subtitle}</Text>
      </Box>

      {/* Auth */}
      {phase === 'auth' && (
        <Login
          authResource={authRepo}
          clientName={O.auth.clientName}
          onComplete={() => setPhase(postAuthPhase)}
        />
      )}

      {/* Menu */}
      {phase === 'menu' && (
        <Box flexDirection="column">
          <Text>{M.question}</Text>
          <Box flexDirection="column" marginTop={1} gap={1}>
            {M.options.map((opt, i) => (
              <Box key={opt.key} flexDirection="column">
                {i === menuIndex ? (
                  <>
                    <Text color="cyan" bold>
                      {'>'} {opt.label}
                    </Text>
                    <Text color="cyan">
                      {'  '}
                      {opt.description}
                    </Text>
                  </>
                ) : (
                  <Text dimColor>
                    {'  '}
                    {opt.label}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>{M.hint}</Text>
          </Box>
        </Box>
      )}

      {/* Card flow */}
      {runCard && phase !== 'menu' && (
        <CardFlow
          spendRequestRepo={spendRequestRepo}
          paymentMethodsResource={paymentMethodsResource}
          paymentMethodId={preselectedPmId}
          onComplete={onCardComplete}
        />
      )}

      {phase === 'card-done' && (
        <Box flexDirection="column">
          <Text dimColor>───</Text>
          <MarkdownText>{M.transition}</MarkdownText>
          <Text dimColor>
            {'\n'}
            {'>'} {M.transitionPrompt}
          </Text>
        </Box>
      )}

      {/* SPT flow */}
      {runSpt && (phase === 'spt-flow' || phase === 'summary') && (
        <Box flexDirection="column">
          {runCard && <Text dimColor>───</Text>}
          <SptFlow
            spendRequestRepo={spendRequestRepo}
            paymentMethodsResource={paymentMethodsResource}
            paymentMethodId={paymentMethodId || undefined}
            onComplete={onSptComplete}
          />
        </Box>
      )}

      {/* Summary */}
      {phase === 'summary' && (
        <Box flexDirection="column">
          <Text dimColor>───</Text>
          <Text bold>Done!</Text>
          {cardSuccess !== null && (
            <Text color={cardSuccess ? 'green' : 'red'}>
              {cardSuccess ? '✓' : '✗'} Virtual card flow
            </Text>
          )}
          {sptSuccess !== null && (
            <Text color={sptSuccess ? 'green' : 'red'}>
              {sptSuccess ? '✓' : '✗'} Machine payment flow
            </Text>
          )}
          <AppDownloadQrCodes />
        </Box>
      )}
    </Box>
  );
};
