import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.list_transactions,
  execute(input, ctx) {
    return executeLink(ctx, () => tools.list_transactions.execute(input, ctx));
  },
});
