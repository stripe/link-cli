import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.retrieve_spend_request,
  execute(input, ctx) {
    return executeLink(ctx, () =>
      tools.retrieve_spend_request.execute(input, ctx),
    );
  },
});
