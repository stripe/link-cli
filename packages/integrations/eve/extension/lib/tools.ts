import { Link, LinkApiError } from '@stripe/link-sdk';
import { createLinkTools } from '@stripe/link-sdk/tools';
import extension from '../extension';

// Read mount configuration only when a tool executes, not during discovery.
export const tools = createLinkTools(
  () => new Link({ accessToken: extension.config.accessToken }),
);

export async function executeLink<Output>(
  call: () => Promise<Output>,
): Promise<Output> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof LinkApiError && error.status === 401) {
      throw new Error(
        'Link access token is invalid or expired. Configure a new accessToken for the extension.',
      );
    }
    throw error;
  }
}
