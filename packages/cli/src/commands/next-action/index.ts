import { Cli } from 'incur';
import { registerSimulate } from './simulate';

export function createNextActionCli() {
  const cli = Cli.create('next-action', {
    update: false,
    description: 'Next-action sample responses for agent evaluation',
  });
  registerSimulate(cli);
  return cli;
}
