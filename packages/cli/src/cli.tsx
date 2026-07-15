import { type AuthStorage, Storage, storage } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { createAuthCli } from './commands/auth';
import { createBalancesCli } from './commands/balances';
import { createDemoCli } from './commands/demo';
import { createMppCli } from './commands/mpp';
import { createOnboardCli } from './commands/onboard';
import { createPaymentMethodsCli } from './commands/payment-methods';
import { createReportCli } from './commands/report';
import { createServeCli } from './commands/serve';
import { createShippingAddressCli } from './commands/shipping-address';
import { createSourcesCli } from './commands/sources';
import { createSpendRequestCli } from './commands/spend-request';
import { createTransactionsCli } from './commands/transactions';
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

const verboseIndex = process.argv.indexOf('--verbose');
const verbose = verboseIndex !== -1;
if (verboseIndex !== -1) {
  process.argv.splice(verboseIndex, 1);
}

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

const requestedCommand = process.argv[2];
const hiddenCli =
  requestedCommand === 'transactions'
    ? createTransactionsCli(
        () => factory.createTransactionsResource(),
        authStorage,
        envAccessToken,
      )
    : requestedCommand === 'sources'
      ? createSourcesCli(
          () => factory.createSourcesResource(),
          authStorage,
          envAccessToken,
        )
      : requestedCommand === 'balances'
        ? createBalancesCli(
            () => factory.createBalancesResource(),
            authStorage,
            envAccessToken,
          )
        : null;
if (hiddenCli) {
  process.argv.splice(2, 1);
}

const cli =
  hiddenCli ??
  Cli.create('link-cli', {
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

if (!hiddenCli) {
  cli.command(
    createAuthCli(authRepo, getUpdateInfo, authStorage, envAccessToken),
  );
  cli.command(
    createSpendRequestCli(spendRequestRepo, authStorage, envAccessToken),
  );
  cli.command(
    createPaymentMethodsCli(
      () => factory.createPaymentMethodsResource(),
      authStorage,
      envAccessToken,
    ),
  );
  cli.command(
    createShippingAddressCli(
      () => factory.createShippingAddressResource(),
      authStorage,
      envAccessToken,
    ),
  );
  cli.command(
    createUserInfoCli(
      () => factory.createUserInfoResource(),
      authStorage,
      envAccessToken,
    ),
  );
  cli.command(createMppCli(spendRequestRepo, authStorage, envAccessToken));
  // cli.command(
  //   createWebBotAuthCli(() => factory.createWebBotAuthResource(), authStorage),
  // );
  cli.command(
    createReportCli(
      () => factory.createReportResource(),
      authStorage,
      envAccessToken,
    ),
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
  cli.command(createServeCli(cli));
}

cli.serve();

export default cli;
