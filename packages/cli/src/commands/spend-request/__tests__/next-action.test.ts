import { Link, type NextAction, type SpendRequest } from '@stripe/link-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Storage } from '../../../auth/storage';
import { ResourceFactory } from '../../../utils/resource-factory';
import { createSpendRequestCli } from '../index';
import { getSpendRequestNextAction } from '../next-action';

const action: NextAction = {
  type: 'partner_auth_challenge',
  resolution: 'auto_resume',
  display_message: 'Complete verification',
  action_url: 'https://example.com/verify?nonce=a%2Bb&callback=%2Fdone#step',
  expires_at: '2026-11-05T12:00:00Z',
};
const base: SpendRequest = {
  id: 'sr_snapshot',
  status: 'requires_action',
  created_at: '2026-11-04T00:00:00Z',
  updated_at: '2026-11-04T00:00:00Z',
};

function fixture(response: SpendRequest | null = base, authenticated = true) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      response === null
        ? Response.json({}, { status: 404 })
        : Response.json(response),
    );
  const repository = new Link({ accessToken: 'test-token', fetch })
    .spendRequests;
  const retrieve = vi.spyOn(repository, 'retrieve');
  const storage = new Storage();
  vi.spyOn(storage, 'isAuthenticated').mockReturnValue(authenticated);
  const cli = createSpendRequestCli(
    repository,
    storage,
    authenticated ? 'test-token' : undefined,
  );
  async function run(extra: string[] = [], explicit = true) {
    let stdout = '';
    let exitCode = 0;
    await cli.serve(
      [
        'retrieve',
        base.id,
        '--next-action',
        ...extra,
        ...(explicit ? ['--format', 'json'] : []),
      ],
      {
        stdout: (text) => {
          stdout += text;
        },
        exit: (code) => {
          exitCode = code;
        },
      },
    );
    return { stdout, exitCode };
  }
  return { cli, repository, retrieve, fetch, run };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('next action projection', () => {
  it.each(['requires_action', 'failed'] as const)(
    'reads only the %s branch',
    (status) => {
      const other = { ...action, display_message: 'Stale action' };
      const request = {
        ...base,
        status,
        status_details: {
          requires_action: {
            next_action: status === 'requires_action' ? action : other,
          },
          failed: {
            code: 'verification_required',
            next_action: status === 'failed' ? action : other,
          },
        },
      };
      expect(getSpendRequestNextAction(request)).toBe(action);
    },
  );

  it.each([
    'created',
    'pending_approval',
    'approved',
    'submitted',
    'succeeded',
    'denied',
    'canceled',
    'expired',
    'future_status',
  ])('ignores stale actions for %s', (status) => {
    expect(
      getSpendRequestNextAction({
        ...base,
        status,
        status_details: {
          requires_action: { next_action: action },
          failed: { code: 'old', next_action: action },
        },
      }),
    ).toBeNull();
  });

  it.each(['requires_action', 'failed'] as const)(
    'handles absent/null details and actions for %s',
    (status) => {
      for (const status_details of [
        undefined,
        null,
        {},
        { [status]: null },
        { [status]: status === 'failed' ? { code: 'failure' } : {} },
        { [status]: { code: 'failure', next_action: null } },
      ]) {
        expect(
          getSpendRequestNextAction({ ...base, status, status_details }),
        ).toBeNull();
      }
    },
  );
});

describe('next action snapshot command', () => {
  it.each(
    (
      [
        'ssn_verification',
        'identity_verification',
        'three_d_secure',
        'partner_auth_challenge',
      ] as const
    ).flatMap((type) =>
      (
        [
          'auto_resume',
          'create_new_spend_request',
          'create_new_spend_request_after_completion',
        ] as const
      ).map((resolution) => ({ type, resolution })),
    ),
  )(
    'preserves $type / $resolution in exactly one result and one GET',
    async ({ type, resolution }) => {
      const next_action = {
        ...action,
        type,
        resolution,
        additional_field: 'future',
      };
      const { run, fetch, retrieve } = fixture({
        ...base,
        status_details: { requires_action: { next_action } },
        shared_payment_token: { id: 'secret-token' },
      });
      const result = await run(['--timeout', '-1']);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([{ next_action }]);
      expect(retrieve).toHaveBeenCalledExactlyOnceWith(base.id);
      expect(fetch).toHaveBeenCalledOnce();
      expect(String(fetch.mock.calls[0]?.[0])).toBe(
        `https://api.link.com/spend_requests/${base.id}`,
      );
      expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
    },
  );

  it.each([
    null,
    { ...action, type: null, action_url: null, expires_at: null },
    { ...action, expires_at: undefined },
  ])('returns nullable/older actions unchanged: %j', async (next_action) => {
    const { run } = fixture({
      ...base,
      status_details: { failed: { code: 'verification', next_action } },
      status: 'failed',
    });
    const result = await run();
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      JSON.parse(JSON.stringify([{ next_action }])),
    );
  });

  it('preserves unknown server action types and additional fields', async () => {
    const { run, fetch } = fixture();
    const next_action = {
      ...action,
      type: 'future_action',
      additional_field: 'future',
    };
    fetch.mockResolvedValue(
      Response.json({
        ...base,
        status_details: { requires_action: { next_action } },
      }),
    );
    const result = await run();
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([{ next_action }]);
  });

  it.each([
    ['--include', 'card'],
    ['--include', ''],
    ['--output-file', '/tmp/unused-card.json'],
    ['--output-file', ''],
    ['--force'],
    ['--interval', '2'],
    ['--interval', '-2'],
    ['--max-attempts', '1'],
    ['--max-attempts', '-1'],
  ])('rejects incompatible %j before retrieving', async (...extra) => {
    const { run, retrieve, fetch } = fixture();
    const result = await run(extra);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).code).toBe('INVALID_INPUT');
    expect(retrieve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps NOT_FOUND distinct from no action', async () => {
    const missing = fixture(null);
    const result = await missing.run();
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).code).toBe('NOT_FOUND');
    const noAction = await fixture().run();
    expect(noAction.exitCode).toBe(0);
    expect(JSON.parse(noAction.stdout)).toEqual([{ next_action: null }]);
  });

  it('checks auth before snapshot option validation', async () => {
    const { run, retrieve } = fixture(base, false);
    const result = await run(['--force']);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).code).toBe('NOT_AUTHENTICATED');
    expect(retrieve).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])(
    'keeps API error behavior for HTTP %s',
    async (status) => {
      const { run, fetch } = fixture();
      fetch.mockResolvedValue(
        Response.json(
          { error: { code: 'test_error', message: 'Test failure' } },
          { status },
        ),
      );
      const result = await run();
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toHaveProperty('code');
      expect(result.stdout).not.toContain('next_action');
    },
  );

  it('keeps network failure behavior', async () => {
    const { run, fetch } = fixture();
    fetch.mockRejectedValue(new Error('Network unavailable'));
    const result = await run();
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).message).toContain('Request failed: GET');
  });

  it('observes enrollment after OTP without a status or URL change', async () => {
    const { run, retrieve } = fixture();
    const enrollment = {
      ...action,
      type: 'partner_create_card_enrollment' as const,
      display_message: 'Confirm enrollment',
    };
    retrieve
      .mockResolvedValueOnce({
        ...base,
        status_details: { requires_action: { next_action: action } },
      })
      .mockResolvedValueOnce({
        ...base,
        status_details: { requires_action: { next_action: enrollment } },
      });
    expect(JSON.parse((await run()).stdout)).toEqual([{ next_action: action }]);
    expect(JSON.parse((await run()).stdout)).toEqual([
      { next_action: enrollment },
    ]);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it('uses ResourceFactory sanitization while preserving URL query and fragment', async () => {
    const unsafe = {
      ...action,
      display_message: '\u001b[31mVerify\u001b[0m\u0007',
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        ...base,
        status_details: { requires_action: { next_action: unsafe } },
      }),
    );
    const repository = new ResourceFactory({
      envAccessToken: 'test-token',
      fetch,
    }).createSpendRequestResource();
    const cli = createSpendRequestCli(repository, undefined, 'test-token');
    let stdout = '';
    await cli.serve(
      ['retrieve', base.id, '--next-action', '--format', 'json'],
      {
        stdout: (text) => {
          stdout += text;
        },
      },
    );
    expect(JSON.parse(stdout)).toEqual([
      { next_action: { ...action, display_message: 'Verify' } },
    ]);
  });

  it('requires an explicit format in human mode and accepts it when provided', async () => {
    const ttyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      'isTTY',
    );
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
    try {
      const { run, retrieve } = fixture();
      const result = await run([], false);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Use --next-action with --format json');
      expect(retrieve).not.toHaveBeenCalled();
      expect(JSON.parse((await run()).stdout)).toEqual([{ next_action: null }]);
      expect(retrieve).toHaveBeenCalledOnce();
    } finally {
      if (ttyDescriptor)
        Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor);
      else Reflect.deleteProperty(process.stdout, 'isTTY');
    }
  });

  it('advertises the flag and default in help, LLM and MCP discovery', async () => {
    const { cli } = fixture();
    for (const args of [
      ['retrieve', '--help'],
      ['retrieve', '--schema'],
      ['--llms-full'],
    ]) {
      let stdout = '';
      await cli.serve(args, {
        stdout: (text) => {
          stdout += text;
        },
      });
      expect(stdout).toMatch(/next-action|nextAction/);
      expect(stdout).toContain('timeout is ignored');
    }
    async function mcp(method: string, params: Record<string, unknown>) {
      const response = await cli.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
      );
      return response.json();
    }
    const listing = await mcp('tools/list', {});
    expect(
      listing.result.tools.map((tool: { name: string }) => tool.name),
    ).toContain('get_tool_details');
    const search = await mcp('tools/call', {
      name: 'search_tools',
      arguments: { query: 'retrieve' },
    });
    const catalog = JSON.parse(search.result.content[0].text);
    expect(catalog.tools[0].name).toContain('retrieve');
    const details = await mcp('tools/call', {
      name: 'get_tool_details',
      arguments: { name: catalog.tools[0].name },
    });
    const tool = JSON.parse(details.result.content[0].text);
    expect(tool.inputSchema.properties.nextAction).toMatchObject({
      type: 'boolean',
      default: false,
    });
    expect(tool.inputSchema.properties.nextAction.description).toContain(
      'timeout is ignored',
    );
  });
});
