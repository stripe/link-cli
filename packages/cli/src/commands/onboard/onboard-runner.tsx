import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
  PaymentMethod,
} from '@stripe/link-sdk';
import { storage } from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { IAuthResource } from '../../auth/types';
import { Login } from '../auth/login';
import { ONBOARD as O } from '../demo/content';
import { DemoRunner } from '../demo/demo-runner';
import { AppDownloadQrCodes } from '../spend-request/app-download-qr-codes';

type Phase =
  | 'welcome'
  | 'auth'
  | 'payment-methods'
  | 'pick-pm'
  | 'demo'
  | 'app-tip';

interface OnboardRunnerProps {
  authRepo: IAuthResource;
  spendRequestRepo: ISpendRequestResource;
  paymentMethodsResource: IPaymentMethodsResource;
  onComplete: () => void;
}

function formatPm(pm: PaymentMethod): string {
  if (pm.card_details) {
    return `${pm.card_details.brand} ****${pm.card_details.last4}`;
  }
  if (pm.bank_account_details) {
    return `${pm.bank_account_details.bank_name} ****${pm.bank_account_details.last4}`;
  }
  return pm.type;
}

export const OnboardRunner: React.FC<OnboardRunnerProps> = ({
  authRepo,
  spendRequestRepo,
  paymentMethodsResource,
  onComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('welcome');
  const [authSkipped, setAuthSkipped] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPmIndex, setSelectedPmIndex] = useState(0);
  const [selectedPmId, setSelectedPmId] = useState<string>('');
  const [pmMissing, setPmMissing] = useState(false);
  const [error, setError] = useState<string>('');

  const enterResolver = useRef<(() => void) | null>(null);

  function waitForEnter(): Promise<void> {
    return new Promise((resolve) => {
      enterResolver.current = resolve;
    });
  }

  const authResolver = useRef<(() => void) | null>(null);

  function waitForAuth(): Promise<void> {
    return new Promise((resolve) => {
      authResolver.current = resolve;
    });
  }

  useInput((_input, key) => {
    if (phase === 'pick-pm') {
      if (key.upArrow) {
        setSelectedPmIndex((i) => (i > 0 ? i - 1 : paymentMethods.length - 1));
      } else if (key.downArrow) {
        setSelectedPmIndex((i) => (i < paymentMethods.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        const pm = paymentMethods[selectedPmIndex];
        setSelectedPmId(pm.id);
        if (enterResolver.current) {
          const resolve = enterResolver.current;
          enterResolver.current = null;
          resolve();
        }
      }
    } else if (key.return && enterResolver.current) {
      const resolve = enterResolver.current;
      enterResolver.current = null;
      resolve();
    }
  });

  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally runs once
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const run = async () => {
      try {
        // Phase 1: Auth (no gate for welcome — just show it and proceed)
        setPhase('auth');
        if (storage.isAuthenticated()) {
          setAuthSkipped(true);
        } else {
          setAuthSkipped(false);
          await waitForAuth();
        }

        // Phase 2: Payment methods
        setPhase('payment-methods');
        while (true) {
          const methods = await paymentMethodsResource.listPaymentMethods();
          if (methods.length > 0) {
            setPaymentMethods(methods);
            setPmMissing(false);

            if (methods.length === 1) {
              // Auto-select the only one
              setSelectedPmId(methods[0].id);
              break;
            }

            // Let user pick
            const defaultIdx = methods.findIndex((m) => m.is_default);
            setSelectedPmIndex(defaultIdx >= 0 ? defaultIdx : 0);
            setPhase('pick-pm');
            await waitForEnter();
            break;
          }
          setPmMissing(true);
          await waitForEnter();
          setPmMissing(false);
        }

        // Phase 3: App tip
        setPhase('app-tip');
        await waitForEnter();

        // Phase 4: Demo
        setPhase('demo');
        // DemoRunner handles the rest via its own onComplete
      } catch (err) {
        setError((err as Error).message);
      }
    };
    run();
  }, []);

  const pastPhase = (target: Phase) => {
    const order: Phase[] = [
      'welcome',
      'auth',
      'payment-methods',
      'pick-pm',
      'app-tip',
      'demo',
    ];
    return order.indexOf(phase) > order.indexOf(target);
  };

  const prompt = (label = 'Press [Enter] to continue') => (
    <Text dimColor>
      {'\n'}
      {'>'} {label}
    </Text>
  );

  const selectedPmLabel = selectedPmId
    ? formatPm(
        paymentMethods.find((pm) => pm.id === selectedPmId) ??
          paymentMethods[0],
      )
    : '';

  return (
    <Box flexDirection="column" gap={1}>
      {/* Welcome — no gate, just header text */}
      <Box flexDirection="column">
        <Text bold>{O.title}</Text>
        <Text dimColor>{O.subtitle}</Text>
      </Box>

      {/* Auth */}
      <Box flexDirection="column">
        {authSkipped || pastPhase('auth') ? (
          <Text color="green">
            ✓ {authSkipped ? O.auth.alreadyLoggedIn : O.auth.authenticated}
          </Text>
        ) : phase === 'auth' && !storage.isAuthenticated() ? (
          <Login
            authResource={authRepo}
            clientName={O.auth.clientName}
            onComplete={() => authResolver.current?.()}
          />
        ) : null}
      </Box>

      {/* Payment methods */}
      {pastPhase('auth') && (
        <Box flexDirection="column">
          {phase === 'payment-methods' && !pmMissing && (
            <Text color="cyan">{O.paymentMethods.loading}</Text>
          )}

          {pmMissing && (
            <Box flexDirection="column">
              <Text color="yellow">{O.paymentMethods.missing}</Text>
              <Box marginTop={1}>
                <Text>
                  To continue, add a card to your Link wallet:{'\n'}
                  {O.paymentMethods.missingSteps
                    .map((s, i) => ` ${i + 1}. ${s}`)
                    .join('\n')}
                </Text>
              </Box>
              {prompt(O.paymentMethods.retryPrompt)}
            </Box>
          )}

          {/* PM picker */}
          {phase === 'pick-pm' && paymentMethods.length > 1 && (
            <Box flexDirection="column">
              <Text>{O.paymentMethods.pickPrompt}</Text>
              <Box flexDirection="column" marginTop={1}>
                {paymentMethods.map((pm, i) => (
                  <Text key={pm.id}>
                    {i === selectedPmIndex ? (
                      <Text color="cyan" bold>
                        {'>'} {formatPm(pm)}
                        {pm.is_default ? ' (default)' : ''}
                      </Text>
                    ) : (
                      <Text dimColor>
                        {'  '}
                        {formatPm(pm)}
                        {pm.is_default ? ' (default)' : ''}
                      </Text>
                    )}
                  </Text>
                ))}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>{O.paymentMethods.pickHint}</Text>
              </Box>
            </Box>
          )}

          {/* PM selected summary */}
          {pastPhase('pick-pm') && selectedPmId && (
            <Text color="green">
              ✓ Using <Text bold>{selectedPmLabel}</Text>
            </Text>
          )}
        </Box>
      )}

      {/* App tip — before the demo so the user can grab the app for approvals */}
      {pastPhase('pick-pm') && !pastPhase('app-tip') && (
        <Box flexDirection="column">
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={2}
            paddingY={1}
          >
            <Text bold>{O.appTip.title}</Text>
            <Text>{O.appTip.description}</Text>
            <AppDownloadQrCodes />
          </Box>
          {phase === 'app-tip' && prompt('Press [Enter] to start the demo')}
        </Box>
      )}

      {/* Demo */}
      {phase === 'demo' && (
        <Box flexDirection="column">
          <Text dimColor>───</Text>
          <DemoRunner
            spendRequestRepo={spendRequestRepo}
            paymentMethodsResource={paymentMethodsResource}
            paymentMethodId={selectedPmId}
            onComplete={onComplete}
          />
        </Box>
      )}

      {error && <Text color="red">Error: {error}</Text>}
    </Box>
  );
};
