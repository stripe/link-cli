import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.create_report,
  execute(input, ctx) {
    return executeLink(ctx, () => tools.create_report.execute(input, ctx));
  },
});
