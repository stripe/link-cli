import { defineTool } from 'eve/tools';
import { executeLink, tools } from '../lib/tools';

export default defineTool({
  ...tools.mpp_decode,
  execute(input, ctx) {
    return executeLink(ctx, () => tools.mpp_decode.execute(input, ctx));
  },
});
