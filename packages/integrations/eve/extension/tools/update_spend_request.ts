import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.update_spend_request,
  execute(input, ctx) {
    return executeLink(() => tools.update_spend_request.execute(input, ctx));
  },
});
