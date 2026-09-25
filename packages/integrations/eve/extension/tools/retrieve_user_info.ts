import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.retrieve_user_info,
  execute(input, ctx) {
    return executeLink(() => tools.retrieve_user_info.execute(input, ctx));
  },
});
