import type { LanguageModel } from '@mastra/core/llm';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { noopObserve, type Tool } from '@mastra/core/tools';

export const purchase = {
  amount: 1000,
  merchant_name: 'Example',
  merchant_url: 'https://example.com',
  context:
    'A user-requested purchase of a book from Example. The total includes shipping and taxes and is within the requested budget.',
};

export const spendRequest = {
  id: 'lsrq_one',
  status: 'pending_approval',
  created_at: '2026-09-17',
  updated_at: '2026-09-17',
  approval_url: 'https://link.com/approve/one',
};

// The upstream mock's doGenerate return type is incompatible with Mastra's own
// exact optional types. These tests only stream; keep that contract explicit.
export function streamingModel(mock: MastraLanguageModelV2Mock): LanguageModel {
  return {
    specificationVersion: mock.specificationVersion,
    provider: mock.provider,
    modelId: mock.modelId,
    supportedUrls: mock.supportedUrls,
    doStream: mock.doStream.bind(mock),
    doGenerate: async (): Promise<never> => {
      throw new Error('Use streaming in this test');
    },
  };
}

export function execute<Input, Output>(
  tool: Tool<Input, Output>,
  input: Input,
  requestContext = new RequestContext(),
) {
  if (!tool.execute) throw new Error(`Missing execute on ${tool.id}`);
  return tool.execute(input, { requestContext, observe: noopObserve });
}
