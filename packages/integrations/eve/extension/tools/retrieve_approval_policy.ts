import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.retrieve_approval_policy,
  execute(input, ctx) {
    return executeLink(ctx, () =>
      tools.retrieve_approval_policy.execute(input, ctx),
    );
  },
});
