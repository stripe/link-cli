import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.list_spend_requests,
  execute(input, ctx) {
    return executeLink(() => tools.list_spend_requests.execute(input, ctx));
  },
});
