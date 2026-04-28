import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import { storage } from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { IAuthResource } from '../../auth/types';
import { Login } from '../auth/login';
import { ONBOARD as O } from '../demo/content';
import { DemoRunner } from '../demo/demo-runner';

type Phase = 'welcome' | 'auth' | 'payment-methods' | 'demo';

interface OnboardRunnerProps {
  authRepo: IAuthResource;
  spendRequestRepo: ISpendRequestResource;
  paymentMethodsResource: IPaymentMethodsResource;
  onComplete: () => void;
}

export const OnboardRunner: React.FC<OnboardRunnerProps> = ({
  authRepo,
  spendRequestRepo,
  paymentMethodsResource,
  onComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('welcome');
  const [authSkipped, setAuthSkipped] = useState(false);
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
    if (key.return && enterResolver.current) {
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
        // Phase 1: Auth
        setPhase('auth');
        if (storage.isAuthenticated()) {
          setAuthSkipped(true);
        } else {
          setAuthSkipped(false);
          await waitForAuth();
        }

        // Phase 2: Payment methods — just check at least one exists
        setPhase('payment-methods');
        while (true) {
          const methods = await paymentMethodsResource.listPaymentMethods();
          if (methods.length > 0) break;
          setPmMissing(true);
          await waitForEnter();
          setPmMissing(false);
        }

        // Phase 3: Demo
        setPhase('demo');
      } catch (err) {
        setError((err as Error).message);
      }
    };
    run();
  }, []);

  const pastPhase = (target: Phase) => {
    const order: Phase[] = ['welcome', 'auth', 'payment-methods', 'demo'];
    return order.indexOf(phase) > order.indexOf(target);
  };

  const prompt = (label = 'Press [Enter] to continue') => (
    <Text dimColor>
      {'\n'}
      {'>'} {label}
    </Text>
  );

  return (
    <Box flexDirection="column" gap={1}>
      {/* Welcome */}
      <Box flexDirection="column">
        <Text bold>{O.title}</Text>
        <Text>{O.subtitle}</Text>
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
                  Visit{' '}
                  <Text bold color="cyan">
                    app.link.com/wallet
                  </Text>{' '}
                  to add a payment method, then press [Enter] to continue.
                </Text>
              </Box>
              {prompt(O.paymentMethods.retryPrompt)}
            </Box>
          )}

          {pastPhase('payment-methods') && (
            <Text color="green">✓ Payment method found</Text>
          )}
        </Box>
      )}

      {/* Demo */}
      {phase === 'demo' && (
        <Box flexDirection="column">
          <Text dimColor>───</Text>
          <DemoRunner
            authRepo={authRepo}
            spendRequestRepo={spendRequestRepo}
            paymentMethodsResource={paymentMethodsResource}
            onComplete={onComplete}
          />
        </Box>
      )}

      {error && <Text color="red">Error: {error}</Text>}
    </Box>
  );
};
