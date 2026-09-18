import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.list_payment_methods,
  execute(input, ctx) {
    return executeLink(() => tools.list_payment_methods.execute(input, ctx));
  },
});
