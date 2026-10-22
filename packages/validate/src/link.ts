import { execFile } from 'node:child_process';

// Runs a Link CLI command and returns its JSON output, or undefined when
// link-cli is unavailable, logged out, or fails. Output can contain personal
// data, so it is never logged.
export type LinkCli = (args: string[]) => Promise<unknown>;

export const linkCli: LinkCli = async (args) => {
  const stdout = await new Promise<string | undefined>((resolve) => {
    execFile(
      'link-cli',
      [...args, '--format', 'json'],
      {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, LINK_TEST_HELPERS: '1' },
      },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
  try {
    return stdout === undefined ? undefined : JSON.parse(stdout);
  } catch {
    return undefined;
  }
};

export type Address = Partial<Record<(typeof addressFields)[number], string>>;
const addressFields = [
  'line_1',
  'line_2',
  'locality',
  'administrative_area',
  'postal_code',
  'country_code',
] as const;

type ShippingRecord = { is_default?: boolean; address?: Address | null };

export async function defaultShippingAddress(
  cli: LinkCli,
): Promise<{ address: Address } | { skipped: string }> {
  const records = await cli(['shipping-address', 'list']);
  if (!Array.isArray(records)) {
    return { skipped: 'Could not read Link shipping addresses with link-cli.' };
  }
  const usable = (records as ShippingRecord[]).filter((r) => r.address);
  const defaults = usable.filter((r) => r.is_default);
  const chosen =
    defaults.length === 1
      ? defaults[0]
      : usable.length === 1
        ? usable[0]
        : undefined;
  return chosen?.address
    ? { address: chosen.address }
    : { skipped: 'The Link account has no single default shipping address.' };
}

const normalize = (value: unknown) =>
  typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLowerCase()
    : '';

export function sameAddress(expected: Address, actual: Address) {
  return addressFields.every(
    (field) => normalize(expected[field]) === normalize(actual[field]),
  );
}

type SpendRequest = {
  id?: string;
  network_id?: string;
  merchant_url?: string;
  amount?: number;
  created_at?: string;
  status?: string;
};

// Finds a spend request matching the validation's network, amount, and time
// window: a canceled match if any, else any match (for its status in an
// error message). `available: false` means link-cli could not list requests.
export async function findSpendRequest(
  cli: LinkCli,
  match: { networkId: string; amount: number; since: number },
): Promise<{ available: false } | { available: true; request?: SpendRequest }> {
  const requests = await cli(['spend-request', 'list', '--include-history']);
  if (!Array.isArray(requests)) return { available: false };
  const matches = (requests as SpendRequest[]).filter(
    (r) =>
      r.network_id === match.networkId &&
      r.amount === match.amount &&
      Date.parse(r.created_at ?? '') >= match.since,
  );
  return {
    available: true,
    request: matches.find((r) => r.status === 'canceled') ?? matches[0],
  };
}

// Whether link-cli has the test-helpers approve command (0.30.0 or later).
export async function canApproveSpendRequests(cli: LinkCli) {
  const schema = await cli([
    'test-helpers',
    'spend-request',
    'approve',
    '--schema',
  ]);
  return schema !== undefined;
}

// Approves this run's pending test spend requests, identified by the seller's
// network ID or checkout URL. Link only approves Demo requests here. Each
// request is attempted once; an approval link-cli can't make is left for a
// person.
export async function approveSpendRequests(
  cli: LinkCli,
  match: { networkId: string; sellerUrl: string; since: number },
  attempted: Set<string>,
) {
  const requests = await cli(['spend-request', 'list']);
  if (!Array.isArray(requests)) return;
  for (const r of requests as SpendRequest[]) {
    if (
      r.id &&
      !attempted.has(r.id) &&
      r.status === 'pending_approval' &&
      Date.parse(r.created_at ?? '') >= match.since &&
      (r.network_id === match.networkId ||
        r.merchant_url === match.sellerUrl ||
        r.merchant_url?.startsWith(`${match.sellerUrl}/`))
    ) {
      attempted.add(r.id);
      await cli(['test-helpers', 'spend-request', 'approve', r.id]);
    }
  }
}
