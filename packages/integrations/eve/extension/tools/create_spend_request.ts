import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.create_spend_request,
  execute(input, ctx) {
    return executeLink(() => tools.create_spend_request.execute(input, ctx));
  },
});
