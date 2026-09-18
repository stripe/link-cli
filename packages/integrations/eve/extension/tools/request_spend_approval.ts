import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.request_spend_approval,
  execute(input, ctx) {
    return executeLink(() => tools.request_spend_approval.execute(input, ctx));
  },
});
