import { storage } from '@stripe/link-sdk';
import { outputError } from './execute-command';

export function requireAuth(): void {
  if (!storage.isAuthenticated()) {
    outputError('Not authenticated. Run "link-cli auth login" first.');
  }
}
