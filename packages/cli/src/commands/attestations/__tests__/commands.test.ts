import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAttestationsCli } from '..';
import { getPoolPath, readAttestationPool } from '../storage';

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'link-pool-command-'));
  vi.spyOn(os, 'homedir').mockReturnValue(directory);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

it('requests into the pool, takes without an API resource, and exports independently', async () => {
  const request = vi.fn().mockResolvedValue({
    issuer: 'https://api.link.com',
    token_key_id: 'key-id',
    count: 2,
    tokens: ['secret-one', 'secret-two'],
  });
  const resource = vi.fn(() => ({ request }));
  const cli = createAttestationsCli(resource);
  async function run(args: string[]) {
    let stdout = '';
    await cli.serve([...args, '--format', 'json'], {
      stdout: (text) => {
        stdout += text;
      },
      exit: (code) => {
        expect(code).toBe(0);
      },
    });
    return JSON.parse(stdout);
  }

  expect(await run(['request', '--count', '2'])).toMatchObject({
    count: 2,
    output_file: getPoolPath(),
  });
  expect(request).toHaveBeenCalledWith({ count: 2 });
  resource.mockClear();
  expect(await run(['list'])).toMatchObject({
    total_token_count: 2,
    attestations: [{ storage: 'pool', stored_token_count: 2 }],
  });
  expect(await run(['take'])).toEqual({
    issuer: 'https://api.link.com',
    token_key_id: 'key-id',
    token: 'secret-one',
    authorization: 'PrivateToken token="secret-one=="',
  });
  expect(resource).not.toHaveBeenCalled();
  expect((await readAttestationPool()).batches[0]?.count).toBe(1);

  const before = await fs.readFile(getPoolPath());
  const exported = path.join(directory, 'agent.json');
  request.mockResolvedValue({
    issuer: 'https://api.link.com',
    token_key_id: 'key-id',
    count: 1,
    tokens: ['exported'],
  });
  const result = await run([
    'request',
    '--count',
    '1',
    '--output-file',
    exported,
  ]);
  expect(result).toMatchObject({ count: 1, output_file: exported });
  expect(result).not.toHaveProperty('tokens');
  expect(await fs.readFile(getPoolPath())).toEqual(before);
  expect(JSON.parse(await fs.readFile(exported, 'utf8')).tokens[0].token).toBe(
    'exported',
  );
});
