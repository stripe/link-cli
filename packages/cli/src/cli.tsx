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
import { ResourceFactory } from './utils/resource-factory';
import {
  createAgentUpdateInfoProvider,
  createInteractiveUpdateInfoProvider,
  renderInteractiveUpdateNotice,
} from './utils/update-info';

declare const __CLI_VERSION__: string;
declare const __BUILD_NUMBER__: string;
declare const __CLI_NAME__: string;

const cliVersion = __CLI_VERSION__;
const buildNumber = __BUILD_NUMBER__;
const cliName = __CLI_NAME__;
const defaultHeaders = {
  'User-Agent': `link-cli/${cliVersion} (build ${buildNumber})`,
  'X-Build-Number': buildNumber,
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

const factory = new ResourceFactory({ verbose, defaultHeaders, authStorage });
const authRepo = factory.createAuthResource();
const spendRequestRepo = factory.createSpendRequestResource();

const cli = Cli.create('link-cli', {
  description:
    'Create a secure, one-time payment credential from a Link wallet to let agents complete purchases on behalf of users.',
  version: `${cliVersion} (build ${buildNumber})`,
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

cli.command(createAuthCli(authRepo, getUpdateInfo, authStorage));
cli.command(createSpendRequestCli(spendRequestRepo, authStorage));
cli.command(
  createPaymentMethodsCli(
    () => factory.createPaymentMethodsResource(),
    authStorage,
  ),
);
cli.command(
  createShippingAddressCli(() => factory.createShippingAddressResource()),
);
cli.command(createUserInfoCli(() => factory.createUserInfoResource()));
cli.command(createMppCli(spendRequestRepo, authStorage));
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
