import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { RequestContext } from '@mastra/core/request-context';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { LibSQLStore } from '@mastra/libsql';
import { afterEach, expect, it, vi } from 'vitest';
import { createLinkTools } from '../src';
import { purchase, spendRequest, streamingModel } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

async function fixture(requireSpendApproval = true, requestApproval = true) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json(spendRequest));
  vi.stubGlobal('fetch', fetch);
  const getAccessToken = vi.fn((context) =>
    context.requestContext.get('token'),
  );
  let calls = 0;
  const model = new MastraLanguageModelV2Mock({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          if (calls++ === 0) {
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'purchase-one',
              toolName: 'create_spend_request',
              input: JSON.stringify({
                ...purchase,
                request_approval: requestApproval,
              }),
            });
            controller.enqueue({
              type: 'finish',
              finishReason: 'tool-calls',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
          } else {
            controller.enqueue({ type: 'text-start', id: 'answer' });
            controller.enqueue({
              type: 'text-delta',
              id: 'answer',
              delta: 'Done.',
            });
            controller.enqueue({ type: 'text-end', id: 'answer' });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
          }
          controller.close();
        },
      }),
    }),
  });
  const agent = new Agent({
    id: 'approval',
    name: 'Approval test',
    instructions: 'Help with the Link wallet.',
    model: streamingModel(model),
    tools: createLinkTools({ getAccessToken, requireSpendApproval }),
  });
  const storage = new LibSQLStore({ id: 'approval-test', url: ':memory:' });
  const mastra = new Mastra({ agents: { agent }, storage, logger: false });
  return {
    agent: mastra.getAgent('agent'),
    fetch,
    getAccessToken,
    storage,
    requestContext: new RequestContext([['token', 'initial-token']]),
  };
}

it.each([true, false])(
  'waits for approval even with request_approval=%s and resolves credentials on resume',
  async (requestApproval) => {
    const { agent, fetch, getAccessToken, storage, requestContext } =
      await fixture(true, requestApproval);
    try {
      const stream = await agent.stream('Prepare the purchase.', {
        requestContext,
      });
      const chunks = [];
      for await (const chunk of stream.fullStream) chunks.push(chunk);
      expect(chunks).toContainEqual(
        expect.objectContaining({
          type: 'tool-call-approval',
          payload: expect.objectContaining({
            toolCallId: 'purchase-one',
            toolName: 'create_spend_request',
          }),
        }),
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(getAccessToken).not.toHaveBeenCalled();
      requestContext.set('token', 'refreshed-token');
      const resumed = await agent.approveToolCall({
        runId: stream.runId,
        toolCallId: 'purchase-one',
        requestContext,
      });
      await resumed.consumeStream();
      expect(fetch).toHaveBeenCalledOnce();
      expect(getAccessToken).toHaveBeenCalledOnce();
      expect(
        new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization'),
      ).toBe('Bearer refreshed-token');
      expect(
        JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).request_approval,
      ).toBe(requestApproval);
    } finally {
      await storage.close();
    }
  },
);

it('declines without resolving a token or calling Link', async () => {
  const { agent, fetch, getAccessToken, storage, requestContext } =
    await fixture();
  try {
    const stream = await agent.stream('Prepare the purchase.', {
      requestContext,
    });
    await stream.consumeStream();
    const declined = await agent.declineToolCall({
      runId: stream.runId,
      toolCallId: 'purchase-one',
      requestContext,
    });
    await declined.consumeStream();
    expect(fetch).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  } finally {
    await storage.close();
  }
});

it('lets applications disable the Mastra prompt while retaining Link approval', async () => {
  const { agent, fetch, storage, requestContext } = await fixture(false);
  try {
    const stream = await agent.stream('Prepare the purchase.', {
      requestContext,
    });
    const chunks = [];
    for await (const chunk of stream.fullStream) chunks.push(chunk);
    expect(chunks.some((chunk) => chunk.type === 'tool-call-approval')).toBe(
      false,
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).request_approval,
    ).toBe(true);
  } finally {
    await storage.close();
  }
});
