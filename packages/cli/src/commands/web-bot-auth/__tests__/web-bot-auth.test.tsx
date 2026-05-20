import type { IWebBotAuthResource, WebBotAuthBlock } from '@stripe/link-sdk';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { WebBotAuthSign } from '../sign';

const ESCAPE_PAYLOAD = '\x1b[2JEvil\rHidden';
const CLEAN_TEXT = 'EvilHidden';

const webBotAuthBlock: WebBotAuthBlock = {
  signature: 'sig1=:stub_sig:',
  signature_input:
    'sig1=("@authority" "signature-agent");created=1715400000;keyid="stub_keyid";alg="ed25519";expires=1715400600;tag="web-bot-auth"',
  signature_agent:
    'https://api.link.com/.well-known/http-message-signatures-directory',
  authority: 'wine-merchant.com',
  expires_at: '2099-12-31T23:59:59Z',
};

describe('web-bot-auth', () => {
  describe('sanitization', () => {
    it('sanitizes escape sequences in signature fields', async () => {
      const resource = sanitizeResource({
        getHeaders: vi.fn(async () => ({
          ...webBotAuthBlock,
          signature: `sig1=:${ESCAPE_PAYLOAD}:`,
          authority: ESCAPE_PAYLOAD,
        })),
      } as unknown as IWebBotAuthResource);

      const { lastFrame } = render(
        <WebBotAuthSign
          resource={resource}
          url="https://wine-merchant.com/checkout"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain(CLEAN_TEXT);
        expect(frame).not.toContain('\x1b[2J');
        expect(frame).not.toContain('\r');
      });
    });
  });

  describe('WebBotAuthSign', () => {
    it('renders loading spinner initially', () => {
      const resource = {
        getHeaders: vi.fn(() => new Promise(() => {})),
      } as unknown as IWebBotAuthResource;

      const { lastFrame } = render(
        <WebBotAuthSign
          resource={resource}
          url="https://wine-merchant.com/checkout"
          onComplete={() => {}}
        />,
      );

      expect(lastFrame()).toContain('Getting Web Bot Auth headers');
    });

    it('renders signature fields on success', async () => {
      const resource = {
        getHeaders: vi.fn(async () => webBotAuthBlock),
      } as unknown as IWebBotAuthResource;

      const { lastFrame } = render(
        <WebBotAuthSign
          resource={resource}
          url="https://wine-merchant.com/checkout"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        const frame = lastFrame();
        expect(frame).toContain('sig1=:stub_sig:');
        expect(frame).toContain('sig1=("@authority"');
        expect(frame).toContain('wine-merchant.com');
        expect(frame).toContain('2099-12-31');
      });
    });

    it('calls onComplete with the result block', async () => {
      const resource = {
        getHeaders: vi.fn(async () => webBotAuthBlock),
      } as unknown as IWebBotAuthResource;
      const onComplete = vi.fn();

      render(
        <WebBotAuthSign
          resource={resource}
          url="https://wine-merchant.com/checkout"
          onComplete={onComplete}
        />,
      );

      await vi.waitFor(
        () => {
          expect(onComplete).toHaveBeenCalledWith(webBotAuthBlock);
        },
        { timeout: 3000 },
      );
    });

    it('renders error message on failure', async () => {
      const resource = {
        getHeaders: vi.fn(async () => {
          throw new Error('Not authenticated');
        }),
      } as unknown as IWebBotAuthResource;

      const { lastFrame } = render(
        <WebBotAuthSign
          resource={resource}
          url="https://wine-merchant.com/checkout"
          onComplete={() => {}}
        />,
      );

      await vi.waitFor(() => {
        expect(lastFrame()).toContain('Not authenticated');
      });
    });
  });
});
