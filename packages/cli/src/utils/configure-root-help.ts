import type { Command } from 'commander';

export function configureRootHelp(
  program: Command,
  authCommand: Command,
  spendIntentCommand: Command,
  paymentMethodsCommand: Command,
  skillCommand: Command,
  mppCommand: Command,
  demoCommand: Command,
  onboardCommand: Command,
): void {
  program.configureHelp({
    formatHelp(cmd, helper) {
      const helpWidth = helper.helpWidth || 80;
      const itemIndent = 2;
      const itemSeparator = 2;

      function formatItem(
        term: string,
        termWidth: number,
        description: string,
      ) {
        if (description) {
          const fullText = `${term.padEnd(termWidth + itemSeparator)}${description}`;
          return helper.wrap(
            fullText,
            helpWidth - itemIndent,
            termWidth + itemSeparator,
          );
        }
        return term;
      }

      function formatList(items: string[]) {
        return items.join('\n').replace(/^/gm, ' '.repeat(itemIndent));
      }

      const output: string[] = [`Usage: ${helper.commandUsage(cmd)}`, ''];

      const desc = helper.commandDescription(cmd);
      if (desc.length > 0) {
        output.push(helper.wrap(desc, helpWidth, 0), '');
      }

      output.push(
        'Getting started:',
        formatList([
          'As an agent, you MUST run `link-cli skill` to fully understand how to get setup.',
          'Optional: Run `npx skills add stripe/link-cli` to install the skill for future use.',
        ]),
        '',
      );

      const optTermWidth = helper.longestOptionTermLength(cmd, helper);
      const optionList = helper
        .visibleOptions(cmd)
        .map((option) =>
          formatItem(
            helper.optionTerm(option),
            optTermWidth,
            helper.optionDescription(option),
          ),
        );
      if (optionList.length > 0) {
        output.push('Options:', formatList(optionList), '');
      }

      const commandGroups = [
        { heading: 'Auth:', parent: authCommand },
        { heading: 'Spend Requests:', parent: spendIntentCommand },
        { heading: 'Payment Methods:', parent: paymentMethodsCommand },
        { heading: 'MPP:', parent: mppCommand },
      ];

      const allLeafCmds = commandGroups.flatMap(({ parent }) =>
        helper.visibleCommands(parent),
      );
      const maxTermWidth = allLeafCmds.reduce(
        (max, sub) =>
          Math.max(
            max,
            // biome-ignore lint/style/noNonNullAssertion: sub is always a subcommand and always has a parent
            `${sub.parent!.name()} ${helper.subcommandTerm(sub)}`.length,
          ),
        Math.max(
          skillCommand.name().length,
          demoCommand.name().length,
          onboardCommand.name().length,
        ),
      );

      for (const { heading, parent } of commandGroups) {
        const cmds = helper.visibleCommands(parent);
        if (cmds.length === 0) continue;
        const list = cmds.map((sub) =>
          formatItem(
            `${parent.name()} ${helper.subcommandTerm(sub)}`,
            maxTermWidth,
            helper.subcommandDescription(sub),
          ),
        );
        output.push(heading, formatList(list), '');
      }

      output.push(
        'Other:',
        formatList([
          formatItem(
            skillCommand.name(),
            maxTermWidth,
            skillCommand.description(),
          ),
          formatItem(
            demoCommand.name(),
            maxTermWidth,
            demoCommand.description(),
          ),
          formatItem(
            onboardCommand.name(),
            maxTermWidth,
            onboardCommand.description(),
          ),
        ]),
        '',
      );

      return output.join('\n');
    },
  });
}
