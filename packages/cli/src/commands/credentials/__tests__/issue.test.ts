import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HolderPublicJwk,
  IIdentityCredentialsResource,
} from '@stripe/link-sdk';
import { holderJwkThumbprint } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { loadHolderKey, loadOrCreateHolderKey } from '../holder-key';
import { issueIdentityCredential } from '../issue';

function publicJwkFromPrivate(): HolderPublicJwk {
  const privateKey = generateKeyPairSync('ed25519').privateKey;
  const jwk = privateKey.export({ format: 'jwk' }) as Record<string, string>;
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function compactCredential(
  jwk: HolderPublicJwk,
  claims: Record<string, unknown> = { email: 'user@example.com' },
): string {
  const jwt = `${encodeSegment({ alg: 'EdDSA', typ: 'vc+sd-jwt' })}.${encodeSegment(
    {
      iss: 'https://api.link.com',
      cnf: { jwk },
    },
  )}.sig`;
  const disclosures = Object.entries(claims).map(([name, value]) =>
    encodeSegment(['salt', name, value]),
  );
  return `${[jwt, ...disclosures].join('~')}~`;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'link-credential-'));
}

describe('issueIdentityCredential', () => {
  it('issues a managed credential and records the local key path', async () => {
    const dir = tempDir();
    const keyFile = join(dir, 'holder-key.jwk');
    const resource: IIdentityCredentialsResource = {
      issue: vi.fn(async ({ cnf }) => ({
        credential: compactCredential(cnf.jwk),
        issuer: 'https://api.link.com',
        expires_at: '2026-09-15T00:00:00Z',
      })),
    };

    const result = await issueIdentityCredential({
      resource,
      keyFile,
    });

    expect(existsSync(keyFile)).toBe(true);
    expect(result.version).toBe(1);
    expect(result.holder.path).toBe(keyFile);
    expect(result.holder.created).toBe(true);
    expect(result.holder.thumbprint).toBe(
      holderJwkThumbprint(result.holder.jwk),
    );
    expect(result.claims).toEqual({ email: 'user@example.com' });
    expect(resource.issue).toHaveBeenCalledWith({
      cnf: { jwk: result.holder.jwk },
    });
  });

  it('sanitizes disclosed claims before returning them to the CLI', async () => {
    const keyFile = join(tempDir(), 'holder-key.jwk');
    const resource: IIdentityCredentialsResource = {
      issue: vi.fn(async ({ cnf }) => ({
        credential: compactCredential(cnf.jwk, {
          email: '\u001b[2Juser@example.com\u0007',
        }),
        issuer: 'https://api.link.com',
        expires_at: '2026-09-15T00:00:00Z',
      })),
    };

    const result = await issueIdentityCredential({
      resource,
      keyFile,
    });

    expect(result.claims).toEqual({ email: 'user@example.com' });
  });

  it('rejects an issued credential whose cnf.jwk does not match', async () => {
    const keyFile = join(tempDir(), 'holder-key.jwk');
    const other = publicJwkFromPrivate();
    const resource: IIdentityCredentialsResource = {
      issue: vi.fn(async () => ({
        credential: compactCredential(other),
        issuer: 'https://api.link.com',
        expires_at: '2026-09-15T00:00:00Z',
      })),
    };

    await expect(
      issueIdentityCredential({
        resource,
        keyFile,
      }),
    ).rejects.toThrow('does not match the requested holder public key');
  });
});

describe('loadHolderKey', () => {
  it('does not generate a replacement key when the file is missing', () => {
    const missing = join(tempDir(), 'missing.jwk');
    expect(() => loadHolderKey(missing)).toThrow('Holder key not found');
    expect(existsSync(missing)).toBe(false);
  });

  it('loads an existing managed key', () => {
    const keyFile = join(tempDir(), 'holder-key.jwk');
    const created = loadOrCreateHolderKey(keyFile);
    const loaded = loadHolderKey(keyFile);
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(loaded.created).toBe(false);
    expect(loaded.publicJwk).toEqual(created.publicJwk);
  });

  it('refuses to read or write a holder key through a symbolic link', () => {
    const dir = tempDir();
    const target = join(dir, 'target.jwk');
    const keyFile = join(dir, 'holder-key.jwk');
    symlinkSync(target, keyFile);

    expect(() => loadOrCreateHolderKey(keyFile)).toThrow('symbolic link');
    expect(existsSync(target)).toBe(false);
  });
});
