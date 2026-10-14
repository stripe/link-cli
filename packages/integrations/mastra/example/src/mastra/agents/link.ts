import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import {
  createLinkTools,
  linkSkillsPath,
} from '@stripe/link-integrations-mastra';

const accessToken = process.env.LINK_ACCESS_TOKEN;
const model = process.env.MASTRA_MODEL;
if (!accessToken || !model) {
  throw new Error(
    'Set LINK_ACCESS_TOKEN and MASTRA_MODEL in the example .env file.',
  );
}

export const linkAgent = new Agent({
  id: 'link-agent',
  name: 'Link Wallet',
  model,
  instructions:
    'Help the user with their Link wallet. You can prepare purchase credentials but have no merchant checkout tools.',
  tools: createLinkTools({ accessToken }),
  skills: [linkSkillsPath],
  memory: new Memory({ options: { lastMessages: 20 } }),
});
