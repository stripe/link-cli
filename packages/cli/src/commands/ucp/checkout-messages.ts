import type { UcpCheckout } from '@stripe/link-sdk';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = asRecord(entry);
        return record ? [record] : [];
      })
    : [];
}

export function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export interface CheckoutMessage {
  type: string;
  code?: string;
  content: string;
  path?: string;
  severity?: string;
  url?: string;
}

export function checkoutMessages(checkout: UcpCheckout): CheckoutMessage[] {
  if (!Array.isArray(checkout.messages)) return [];
  return checkout.messages.map((value) => {
    const message = asRecord(value);
    return {
      type: textField(message?.type)?.toLowerCase() ?? 'message',
      code: textField(message?.code),
      content:
        textField(message?.content) ??
        (typeof value === 'string' ? value : JSON.stringify(value)),
      path: textField(message?.path),
      severity: textField(message?.severity),
      url: textField(message?.url) ?? textField(message?.action_url),
    };
  });
}
