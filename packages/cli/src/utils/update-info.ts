import process from 'node:process';
import updateNotifier from 'update-notifier';

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

const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60 * 1000;

let cachedUpdateInfo:
  | {
      expiresAt: number;
      value?: UpdateInfo;
    }
  | undefined;
let inflightUpdateInfo: Promise<UpdateInfo | undefined> | undefined;

export function createAgentUpdateInfoProvider(
  packageName: string,
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
      inflightUpdateInfo = fetchLatestVersion(packageName, cliVersion).finally(
        () => {
          inflightUpdateInfo = undefined;
        },
      );
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
  packageName: string,
  cliVersion: string,
): Promise<UpdateInfo | undefined> {
  const previousDisableFlag = process.env.NO_UPDATE_NOTIFIER;

  try {
    process.env.NO_UPDATE_NOTIFIER = '1';
    const notifier = updateNotifier({
      pkg: {
        name: packageName,
        version: cliVersion,
      },
    });
    const payload = await notifier.fetchInfo();
    const latest = payload.latest?.trim();
    const value =
      latest && latest.length > 0 && latest !== cliVersion
        ? { current: cliVersion, latest }
        : undefined;

    cacheUpdateInfo(value);
    return value;
  } catch {
    cacheUpdateInfo(undefined, FAILURE_CACHE_TTL_MS);
    return undefined;
  } finally {
    if (previousDisableFlag === undefined) {
      process.env.NO_UPDATE_NOTIFIER = undefined;
    } else {
      process.env.NO_UPDATE_NOTIFIER = previousDisableFlag;
    }
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
