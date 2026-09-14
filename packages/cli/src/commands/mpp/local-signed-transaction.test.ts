import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Transaction } from 'viem/tempo';
import { describe, expect, it, vi } from 'vitest';
import {
  LocalSignedTransactionResource,
  getPrivyConfig,
  isLocalPrivyMode,
  signSponsoredTempoTransaction,
} from './local-signed-transaction';

const LINK_REQUEST: SpendRequest = {
  id: 'lsrq_link_001',
  status: 'created',
  credential_type: 'card',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

function linkResource() {
  return {
    create: vi.fn(async () => LINK_REQUEST),
    retrieve: vi.fn(async () => LINK_REQUEST),
    list: vi.fn(async () => [LINK_REQUEST]),
    update: vi.fn(async () => LINK_REQUEST),
    requestApproval: vi.fn(async () => ({
      id: LINK_REQUEST.id,
      approval_url: 'https://link.test/approve',
    })),
    cancel: vi.fn(async () => LINK_REQUEST),
  } satisfies ISpendRequestResource;
}

describe('local Privy configuration', () => {
  it('requires explicit opt-in', () => {
    expect(isLocalPrivyMode({ LINK_MPP_LOCAL_PRIVY: '1' })).toBe(true);
    expect(isLocalPrivyMode({ LINK_MPP_LOCAL_PRIVY: 'true' })).toBe(false);
    expect(isLocalPrivyMode({})).toBe(false);
  });

  it('reads required credentials without including them in errors', () => {
    expect(
      getPrivyConfig({
        PRIVY_APP_ID: 'app',
        PRIVY_APP_SECRET: 'secret',
        PRIVY_WALLET_ID: 'wallet',
      }),
    ).toEqual({ appId: 'app', appSecret: 'secret', walletId: 'wallet' });
    expect(() => getPrivyConfig({ PRIVY_APP_SECRET: 'secret' })).toThrow(
      'PRIVY_APP_ID, PRIVY_WALLET_ID',
    );
  });
});

describe('sponsored Tempo signing', () => {
  it('raw-signs the sender digest and returns a partial 0x78 envelope', async () => {
    const account = privateKeyToAccount(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    );
    const transaction = {
      calls: [
        {
          data: '0x' as const,
          to: '0x7b9cae3c6f339d864c7c4ceeec9703c864a68c9b' as const,
          value: 0n,
        },
      ],
      chainId: 4217,
      feePayer: true as const,
      from: account.address,
      gas: 100_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      nonce: 1,
      nonceKey: 1n,
      type: 'tempo' as const,
      validBefore: 2_000_000_000,
    };
    const signHash = vi.fn(async (hash: `0x${string}`) =>
      account.sign({ hash }),
    );

    const signed = await signSponsoredTempoTransaction(
      transaction,
      Transaction.serialize as never,
      signHash,
    );

    expect(signed).toMatch(/^0x78/);
    expect(signHash).toHaveBeenCalledWith(
      keccak256(await Transaction.serialize(transaction)),
    );
  });
});

describe('LocalSignedTransactionResource', () => {
  it('auto-approves and stores a locally signed transaction', async () => {
    const link = linkResource();
    const sign = vi.fn(async () => '0x76aabbcc');
    const resource = new LocalSignedTransactionResource(link, sign);

    const created = await resource.create({
      credential_type: 'signed_transaction',
      payment_challenge: 'Payment id="tempo_001"',
      context: 'Local stablecoin test request',
      request_approval: true,
    });

    expect(sign).toHaveBeenCalledWith('Payment id="tempo_001"');
    expect(link.create).not.toHaveBeenCalled();
    expect(created).toMatchObject({
      status: 'approved',
      credential_type: 'signed_transaction',
      payment_challenge: 'Payment id="tempo_001"',
      signed_transaction: { tx_hash: '0x76aabbcc' },
    });
    expect(created.id).toMatch(/^local_lsrq_/);
    await expect(resource.retrieve(created.id)).resolves.toEqual(created);
    expect(link.retrieve).not.toHaveBeenCalled();
  });

  it('delegates all other credential types to Link', async () => {
    const link = linkResource();
    const sign = vi.fn(async () => '0x76aabbcc');
    const resource = new LocalSignedTransactionResource(link, sign);

    await expect(
      resource.create({
        credential_type: 'shared_payment_token',
        context: 'Link-backed request',
      }),
    ).resolves.toEqual(LINK_REQUEST);
    expect(link.create).toHaveBeenCalledOnce();
    expect(sign).not.toHaveBeenCalled();
  });
});
