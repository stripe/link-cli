import { getApiErrorDetails, LinkApiError } from '@stripe/link-sdk';
import { z } from 'incur';
import { upgradeCommand } from '../commands/insights/upgrade-command';
import { sanitizeDeep } from './sanitize-text';

const messageEnvelope = z.object({ error: z.object({ message: z.string() }) });

/** Only parsed error fields may reach output; SDK messages can contain raw bodies. */
export function investmentApiError(error: unknown, operation: string) {
  if (!(error instanceof LinkApiError)) return null;
  const details = sanitizeDeep(getApiErrorDetails(error));
  const message = messageEnvelope.safeParse(error.details);
  const command =
    details?.code === 'missing_permissions'
      ? upgradeCommand([details.authorization_remediation], {
          includeExecutable: false,
        })
      : null;
  return {
    code: details?.code ?? error.code,
    message:
      details?.message ??
      (message.success
        ? sanitizeDeep(message.data.error.message)
        : details?.code) ??
      `Failed to ${operation} (${error.status})`,
    ...(command
      ? {
          cta: {
            commands: [
              { command, description: 'Upgrade access after user approval' },
            ],
          },
        }
      : {}),
  };
}
