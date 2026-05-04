export interface UpdateInfo {
  current: string;
  latest: string;
}

export interface UpdateInfoRequest {
  polling: boolean;
}

export type UpdateInfoProvider = (
  request: UpdateInfoRequest,
) => Promise<UpdateInfo | undefined>;

const NPM_LATEST_URL = 'https://registry.npmjs.org/@stripe/link-cli/latest';
const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

let cachedUpdateInfo:
  | {
      expiresAt: number;
      value?: UpdateInfo;
    }
  | undefined;
let inflightUpdateInfo: Promise<UpdateInfo | undefined> | undefined;

export function createAgentUpdateInfoProvider(
  cliVersion: string,
): UpdateInfoProvider {
  return async ({ polling }) => {
    if (polling) {
      return cachedUpdateInfo?.value;
    }

    const now = Date.now();
    if (cachedUpdateInfo && cachedUpdateInfo.expiresAt > now) {
      return cachedUpdateInfo.value;
    }

    if (!inflightUpdateInfo) {
      inflightUpdateInfo = fetchLatestVersion(cliVersion).finally(() => {
        inflightUpdateInfo = undefined;
      });
    }

    return inflightUpdateInfo;
  };
}

export function createInteractiveUpdateInfoProvider(
  updateInfo?: UpdateInfo,
): UpdateInfoProvider {
  return async () => updateInfo;
}

export function renderInteractiveUpdateNotice(updateInfo: UpdateInfo): string {
  return [
    '',
    `Update available for @stripe/link-cli: ${updateInfo.current} -> ${updateInfo.latest}`,
    'Run: npm install -g @stripe/link-cli',
    '',
  ].join('\n');
}

async function fetchLatestVersion(
  cliVersion: string,
): Promise<UpdateInfo | undefined> {
  try {
    const response = await fetch(NPM_LATEST_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      cacheUpdateInfo(undefined, FAILURE_CACHE_TTL_MS);
      return undefined;
    }

    const payload = (await response.json()) as { version?: unknown };
    const latest =
      typeof payload.version === 'string' ? payload.version.trim() : undefined;
    const value =
      latest && latest.length > 0 && latest !== cliVersion
        ? { current: cliVersion, latest }
        : undefined;

    cacheUpdateInfo(value);
    return value;
  } catch {
    cacheUpdateInfo(undefined, FAILURE_CACHE_TTL_MS);
    return undefined;
  }
}

function cacheUpdateInfo(
  value: UpdateInfo | undefined,
  ttlMs: number = UPDATE_CACHE_TTL_MS,
) {
  cachedUpdateInfo = {
    expiresAt: Date.now() + ttlMs,
    value,
  };
}
