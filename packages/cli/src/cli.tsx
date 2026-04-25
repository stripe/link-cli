import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth';
import { registerDemoCommand } from './commands/demo';
import { registerMppCommands } from './commands/mpp';
import { registerOnboardCommand } from './commands/onboard';
import { registerPaymentMethodsCommands } from './commands/payment-methods';
import { registerSkillCommand } from './commands/skill';
import { registerSpendRequestCommands } from './commands/spend-request';
import { configureRootHelp } from './utils/configure-root-help';
import { ResourceFactory } from './utils/resource-factory';

declare const __CLI_VERSION__: string;
declare const __BUILD_NUMBER__: string;

const cliVersion = __CLI_VERSION__;
const buildNumber = __BUILD_NUMBER__;
const defaultHeaders = {
  'User-Agent': `link-cli/${cliVersion} (build ${buildNumber})`,
  'X-Build-Number': buildNumber,
};

const program = new Command();

// Check early so verbose is available before commander parses subcommands
const verbose = process.argv.includes('--verbose');
const factory = new ResourceFactory({ verbose, defaultHeaders });
const authRepo = factory.createAuthResource();
const spendRequestRepo = factory.createSpendRequestResource();

program
  .name('link-cli')
  .description(
    'Create a secure, one-time payment credential from a Link wallet to let agents complete purchases on behalf of users.',
  )
  .version(`${cliVersion} (build ${buildNumber})`)
  .option('--verbose', 'Print API request and response details to stderr')
  .helpCommand(false)
  .configureOutput({
    outputError: (str, write) => {
      write(str);
      const isJsonMode = process.argv.includes('--output-json');
      if (str.includes('unknown command') && !isJsonMode) {
        write("\nRun 'link-cli --help' to see available commands.\n");
        write("Run 'link-cli --skill' for full instructions.\n");
      }
    },
  });

const authCommand = registerAuthCommands(program, authRepo);
const spendRequestCommand = registerSpendRequestCommands(
  program,
  spendRequestRepo,
);
const paymentMethodsCommand = registerPaymentMethodsCommands(program, () =>
  factory.createPaymentMethodsResource(),
);

const skillCommand = registerSkillCommand(program);
const mppCommand = registerMppCommands(program, spendRequestRepo);
const demoCommand = registerDemoCommand(program, spendRequestRepo, () =>
  factory.createPaymentMethodsResource(),
);
const onboardCommand = registerOnboardCommand(
  program,
  authRepo,
  spendRequestRepo,
  () => factory.createPaymentMethodsResource(),
);

configureRootHelp(
  program,
  authCommand,
  spendRequestCommand,
  paymentMethodsCommand,
  skillCommand,
  mppCommand,
  demoCommand,
  onboardCommand,
);

program.parse();
