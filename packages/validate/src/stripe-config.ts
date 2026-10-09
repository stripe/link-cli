import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, type TomlTable } from 'smol-toml';

function table(value: unknown): TomlTable {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as TomlTable)
    : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function readStripeTestKey(): string {
  const override = process.env.STRIPE_API_KEY || process.env.STRIPE_SECRET_KEY;
  if (override) return override;

  const configPath = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'stripe',
    'config.toml',
  );
  let contents: string;
  try {
    contents = readFileSync(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `Could not read Stripe CLI config at ${configPath}. Check its file permissions.`,
      );
    }
    contents = '';
  }

  let config: TomlTable;
  try {
    config = parse(contents);
  } catch {
    // TOML errors may include source lines containing credentials.
    throw new Error(
      'Could not parse Stripe CLI config. Check its TOML syntax.',
    );
  }
  const projectName =
    process.env.STRIPE_PROJECT_NAME ||
    string(config['project-name']) ||
    'default';
  // The Stripe CLI accepts `[profiles.<name>]` or `[<name>]` tables and the
  // older `secret_key` and `api_key` field names.
  const nested = table(table(config.profiles)[projectName]);
  const topLevel = table(config[projectName]);
  const read = (name: string) => string(nested[name]) || string(topLevel[name]);
  const key =
    read('test_mode_api_key') || read('secret_key') || read('api_key');
  if (key) return key;

  throw new Error(
    'No Stripe test key found. Log in to a Stripe sandbox, then rerun validation. ' +
      'This prints a URL and code for a person to approve:\n' +
      `pnpm --dir packages/validate exec stripe login --non-interactive --project-name ${shellQuote(projectName)}\n` +
      'Or set STRIPE_SECRET_KEY to a sandbox secret key.',
  );
}
