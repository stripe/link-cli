import { type AuthStorage, Storage, storage } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { createAuthCli } from './commands/auth';
import { createDemoCli } from './commands/demo';
import { createMppCli } from './commands/mpp';
import { createOnboardCli } from './commands/onboard';
import { createPaymentMethodsCli } from './commands/payment-methods';
import { createShippingAddressCli } from './commands/shipping-address';
import { createSpendRequestCli } from './commands/spend-request';
import { createUserInfoCli } from './commands/user-info';
import { createWebBotAuthCli } from './commands/web-bot-auth';
import { ResourceFactory } from './utils/resource-factory';
import {
  createAgentUpdateInfoProvider,
  createInteractiveUpdateInfoProvider,
  renderInteractiveUpdateNotice,
} from './utils/update-info';

declare const __CLI_VERSION__: string;
declare const __CLI_NAME__: string;

const cliVersion = __CLI_VERSION__;
const cliName = __CLI_NAME__;
const defaultHeaders = {
  'User-Agent': `link-cli/${cliVersion}`,
};

const verbose = process.argv.includes('--verbose');

const authFileIndex = process.argv.indexOf('--auth');
const credentialFilePath =
  authFileIndex !== -1
    ? process.argv[authFileIndex + 1]
    : process.env.LINK_AUTH_FILE;
if (authFileIndex !== -1) {
  process.argv.splice(authFileIndex, 2);
}
const authStorage: AuthStorage = credentialFilePath
  ? new Storage({ configPath: credentialFilePath })
  : storage;

const envAccessToken = process.env.LINK_ACCESS_TOKEN;
const envRefreshToken = process.env.LINK_REFRESH_TOKEN;
const noRefresh = Boolean(process.env.LINK_NO_REFRESH);

const factory = new ResourceFactory({
  verbose,
  defaultHeaders,
  authStorage,
  envAccessToken,
  envRefreshToken,
  noRefresh,
});
const authRepo = factory.createAuthResource();
const spendRequestRepo = factory.createSpendRequestResource();

const cli = Cli.create('link-cli', {
  description:
    'Create a secure, one-time payment credential from a Link wallet to let agents complete purchases on behalf of users.',
  version: cliVersion,
});

const isAgent =
  process.argv.includes('--format') || process.argv.includes('--mcp');
const agentUpdateInfoProvider = createAgentUpdateInfoProvider(
  cliName,
  cliVersion,
);
let getUpdateInfo = agentUpdateInfoProvider;

if (!isAgent && process.stdout.isTTY) {
  const updateInfo = await agentUpdateInfoProvider({ polling: false });
  getUpdateInfo = createInteractiveUpdateInfoProvider(updateInfo);
  if (updateInfo) {
    process.stderr.write(renderInteractiveUpdateNotice(updateInfo));
  }
}

cli.command(
  createAuthCli(authRepo, getUpdateInfo, authStorage, envAccessToken),
);
cli.command(createSpendRequestCli(spendRequestRepo, authStorage));
cli.command(
  createPaymentMethodsCli(
    () => factory.createPaymentMethodsResource(),
    authStorage,
  ),
);
cli.command(
  createShippingAddressCli(
    () => factory.createShippingAddressResource(),
    authStorage,
  ),
);
cli.command(
  createUserInfoCli(() => factory.createUserInfoResource(), authStorage),
);
cli.command(createMppCli(spendRequestRepo, authStorage));
cli.command(
  createWebBotAuthCli(() => factory.createWebBotAuthResource(), authStorage),
);
cli.command(
  createDemoCli(
    authRepo,
    spendRequestRepo,
    () => factory.createPaymentMethodsResource(),
    authStorage,
  ),
);
cli.command(
  createOnboardCli(
    authRepo,
    spendRequestRepo,
    () => factory.createPaymentMethodsResource(),
    authStorage,
  ),
);

cli.serve();

export default cli;
