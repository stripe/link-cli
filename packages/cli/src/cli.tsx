import { Cli } from 'incur';
import updateNotifier from 'update-notifier';
import { createAuthCli } from './commands/auth';
import { createMppCli } from './commands/mpp';
import { createPaymentMethodsCli } from './commands/payment-methods';
import { createSpendRequestCli } from './commands/spend-request';
import { ResourceFactory } from './utils/resource-factory';

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
const factory = new ResourceFactory({ verbose, defaultHeaders });
const authRepo = factory.createAuthResource();
const spendRequestRepo = factory.createSpendRequestResource();

const notifier = updateNotifier({
  pkg: { name: cliName, version: cliVersion },
});

const cli = Cli.create('link-cli', {
  description:
    'Create a secure, one-time payment credential from a Link wallet to let agents complete purchases on behalf of users.',
  version: `${cliVersion} (build ${buildNumber})`,
});

cli.command(createAuthCli(authRepo, notifier.update));
cli.command(createSpendRequestCli(spendRequestRepo));
cli.command(
  createPaymentMethodsCli(() => factory.createPaymentMethodsResource()),
);
cli.command(createMppCli(spendRequestRepo));

notifier.notify();

cli.serve();

export default cli;
