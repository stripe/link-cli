import { randomUUID } from 'node:crypto';
import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';
import type {
  CreateSpendRequestParams,
  ISpendRequestResource,
  RequestApprovalResponse,
  SpendRequest,
  UpdateSpendRequestParams,
} from '@stripe/link-sdk';
import { Credential } from 'mppx';
import { Mppx, Transport, tempo } from 'mppx/client';
import { type Hex, isAddress, keccak256, parseSignature } from 'viem';

export const LOCAL_PRIVY_ENV = 'LINK_MPP_LOCAL_PRIVY';

export interface LocalPrivyEnvironment {
  LINK_MPP_LOCAL_PRIVY?: string;
  PRIVY_APP_ID?: string;
  PRIVY_APP_SECRET?: string;
  PRIVY_WALLET_ID?: string;
}

export type SignedTransactionFactory = (
  paymentChallenge: string,
) => Promise<string | SignedTempoTransaction>;

export interface SignedTempoTransaction {
  authorization?: string;
  source: string;
  txHash: string;
}

type TempoTransactionSerializer = (
  transaction: unknown,
  signature?: ReturnType<typeof parseSignature>,
) => Hex | Promise<Hex>;

export async function signSponsoredTempoTransaction(
  transaction: unknown,
  serializer: TempoTransactionSerializer,
  signHash: (hash: Hex) => Promise<Hex>,
): Promise<Hex> {
  const unsignedTransaction = await serializer(transaction);
  const signature = parseSignature(
    await signHash(keccak256(unsignedTransaction)),
  );
  return serializer(transaction, signature);
}

export function isLocalPrivyMode(
  env: LocalPrivyEnvironment = process.env,
): boolean {
  return env.LINK_MPP_LOCAL_PRIVY === '1';
}

export function getPrivyConfig(env: LocalPrivyEnvironment = process.env) {
  const missing = [
    ['PRIVY_APP_ID', env.PRIVY_APP_ID],
    ['PRIVY_APP_SECRET', env.PRIVY_APP_SECRET],
    ['PRIVY_WALLET_ID', env.PRIVY_WALLET_ID],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `Local Privy mode requires ${missing.join(', ')} to be set.`,
    );
  }
  return {
    appId: env.PRIVY_APP_ID as string,
    appSecret: env.PRIVY_APP_SECRET as string,
    walletId: env.PRIVY_WALLET_ID as string,
  };
}

export async function createLocalPrivyEthereumAccount(
  env: LocalPrivyEnvironment = process.env,
) {
  const config = getPrivyConfig(env);
  const privy = new PrivyClient({
    appId: config.appId,
    appSecret: config.appSecret,
  });
  const wallet = await privy.wallets().get(config.walletId);
  if (wallet.chain_type !== 'ethereum' || !isAddress(wallet.address)) {
    throw new Error('PRIVY_WALLET_ID must identify a valid Ethereum wallet.');
  }

  return {
    account: createViemAccount(privy, {
      walletId: wallet.id,
      address: wallet.address,
    }),
    privy,
    wallet,
  };
}

async function createTempoTransactionCredentialWithPrivy(
  paymentChallenge: string,
  env: LocalPrivyEnvironment = process.env,
): Promise<SignedTempoTransaction> {
  const {
    account: privyAccount,
    privy,
    wallet,
  } = await createLocalPrivyEthereumAccount(env);
  const defaultSignTransaction =
    privyAccount.signTransaction.bind(privyAccount);
  const account = {
    ...privyAccount,
    signTransaction: (async (transaction, options) => {
      if ((transaction as { feePayer?: unknown }).feePayer !== true) {
        return defaultSignTransaction(transaction, options);
      }
      const serializer = options?.serializer as
        | TempoTransactionSerializer
        | undefined;
      if (!serializer) {
        throw new Error(
          'Tempo transaction serializer is required for fee-payer signing.',
        );
      }
      return signSponsoredTempoTransaction(
        transaction,
        serializer,
        async (hash) => {
          const response = await privy
            .wallets()
            .ethereum()
            .signSecp256k1(wallet.id, { params: { hash } });
          return response.signature as Hex;
        },
      );
    }) as typeof privyAccount.signTransaction,
  };
  const client = Mppx.create({
    methods: [
      tempo.charge({ account, clientId: 'link-cli', mode: 'pull' }),
      tempo.session({
        account,
        // Keep the local experiment tightly bounded. A production value must
        // come from the approved SpendRequest rather than a CLI constant.
        maxDeposit: '0.01',
      }),
    ],
    polyfill: false,
    transport: Transport.http(),
  });
  const authorization = await client.createCredential(
    new Response(null, {
      status: 402,
      headers: { 'www-authenticate': paymentChallenge },
    }),
  );
  const credential = Credential.deserialize<{
    action?: unknown;
    signature?: unknown;
    transaction?: unknown;
    type?: unknown;
  }>(authorization);
  const transaction =
    credential.challenge.intent === 'session'
      ? credential.payload.transaction
      : credential.payload.signature;
  if (
    credential.payload.type !== 'transaction' ||
    (credential.challenge.intent === 'session' &&
      credential.payload.action !== 'open') ||
    typeof transaction !== 'string' ||
    !/^0x(?:76|78)[0-9a-f]+$/i.test(transaction) ||
    transaction.length % 2 !== 0
  ) {
    throw new Error('Privy did not return a serialized Tempo transaction.');
  }
  if (!credential.source) {
    throw new Error('Privy Tempo credential did not include a payer source.');
  }
  return {
    authorization,
    source: credential.source,
    txHash: transaction,
  };
}

export async function signTempoTransactionWithPrivy(
  paymentChallenge: string,
  env: LocalPrivyEnvironment = process.env,
): Promise<string> {
  return (
    await createTempoTransactionCredentialWithPrivy(paymentChallenge, env)
  ).txHash;
}

/**
 * Temporary in-memory stand-in for Link's signed_transaction spend requests.
 * All other credential types continue to use the real Link resource.
 */
export class LocalSignedTransactionResource implements ISpendRequestResource {
  private readonly requests = new Map<string, SpendRequest>();

  constructor(
    private readonly link: ISpendRequestResource,
    private readonly signTransaction: SignedTransactionFactory = createTempoTransactionCredentialWithPrivy,
  ) {}

  async create(params: CreateSpendRequestParams): Promise<SpendRequest> {
    if (params.credential_type !== 'signed_transaction') {
      return this.link.create(params);
    }
    if (!params.payment_challenge) {
      throw new Error(
        'Local signed_transaction spend requests require payment_challenge.',
      );
    }

    const now = new Date().toISOString();
    const id = `local_lsrq_${randomUUID()}`;
    const signed = await this.signTransaction(params.payment_challenge);
    const txHash = typeof signed === 'string' ? signed : signed.txHash;
    const source = typeof signed === 'string' ? undefined : signed.source;
    const authorization =
      typeof signed === 'string' ? undefined : signed.authorization;
    // `payment_authorization` is intentionally local-PoC-only for now. It
    // lets us exercise the correct session boundary (the complete MPP
    // Authorization value) without committing an SDK field name yet.
    const request = {
      id,
      status: 'approved',
      credential_type: 'signed_transaction',
      payment_challenge: params.payment_challenge,
      signed_transaction: {
        tx_hash: txHash,
        ...(source ? { source } : {}),
      },
      ...(authorization
        ? {
            payment_authorization: {
              protocol: 'mpp',
              header_name: 'Authorization',
              value: authorization,
            },
          }
        : {}),
      context: params.context,
      created_at: now,
      updated_at: now,
    } satisfies SpendRequest & {
      payment_authorization?: {
        protocol: 'mpp';
        header_name: 'Authorization';
        value: string;
      };
    };
    this.requests.set(id, request);
    return request;
  }

  async retrieve(id: string): Promise<SpendRequest | null> {
    return this.requests.get(id) ?? this.link.retrieve(id);
  }

  async list(opts?: { includeHistory?: boolean }): Promise<SpendRequest[]> {
    return [...this.requests.values(), ...(await this.link.list(opts))];
  }

  async update(
    id: string,
    params: UpdateSpendRequestParams,
  ): Promise<SpendRequest> {
    const local = this.requests.get(id);
    if (!local) return this.link.update(id, params);
    const updated = {
      ...local,
      ...params,
      updated_at: new Date().toISOString(),
    };
    this.requests.set(id, updated);
    return updated;
  }

  async requestApproval(id: string): Promise<RequestApprovalResponse> {
    if (!this.requests.has(id)) return this.link.requestApproval(id);
    return { id, approval_url: `local://approved/${id}` };
  }

  async cancel(id: string): Promise<SpendRequest> {
    const local = this.requests.get(id);
    if (!local) return this.link.cancel(id);
    const canceled: SpendRequest = {
      ...local,
      status: 'canceled',
      updated_at: new Date().toISOString(),
    };
    this.requests.set(id, canceled);
    return canceled;
  }
}
