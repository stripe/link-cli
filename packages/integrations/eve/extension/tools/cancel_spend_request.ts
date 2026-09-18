import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.cancel_spend_request,
  execute(input, ctx) {
    return executeLink(() => tools.cancel_spend_request.execute(input, ctx));
  },
});
