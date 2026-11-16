import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentityCredentialsCli } from '..';
import { presentIdentityCredential } from '../present';

// Golden outputs captured from the node:crypto implementation of
// presentIdentityCredential. Keys, salts, and time are fixed, and Ed25519 is
// deterministic, so any change to these strings is a behavior change.

const NOW = 1_800_000_000;
const AUD = 'https://directory.example';
const NONCE = 'challenge-nonce';

/** Deterministic Ed25519 key from a repeated seed byte. */
function seededKey(fill: number): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.alloc(32, fill),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
}

const issuerKey = seededKey(7);
const holderPrivateJwk = seededKey(8).export({ format: 'jwk' });
const otherPrivateJwk = seededKey(9).export({ format: 'jwk' });
const holderPublicJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: holderPrivateJwk.x as string,
};

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const raw = (value: string | Uint8Array) =>
  Buffer.from(value).toString('base64url');
const hash = (value: string) =>
  createHash('sha256').update(value).digest('base64url');

const EMAIL = encode(['email-salt', 'email', 'private@example.test']);
const NAME = encode(['name-salt', 'given_name', 'UndisclosedName']);
const PHONE = encode(['phone-salt', 'phone_number', '+15550000000']);

interface Credential {
  header?: unknown;
  headerSegment?: string;
  payload?: Record<string, unknown>;
  payloadSegment?: string;
  disclosures?: readonly string[];
  sd?: unknown;
  suffix?: string;
}

function mint(options: Credential = {}): string {
  const disclosures = options.disclosures ?? [EMAIL, NAME, PHONE];
  const payload = {
    iss: 'https://api.link.com',
    vct: 'https://api.link.com/credentials/aap/v1',
    iat: NOW - 60,
    exp: NOW + 3600,
    cnf: { jwk: holderPublicJwk },
    _sd: options.sd ?? disclosures.map(hash),
    _sd_alg: 'sha-256',
    ...options.payload,
  };
  const input = `${options.headerSegment ?? encode(options.header ?? { typ: 'dc+sd-jwt', alg: 'EdDSA', kid: 'fixture' })}.${options.payloadSegment ?? encode(payload)}`;
  const jwt = `${input}.${sign(null, Buffer.from(input), issuerKey).toString('base64url')}`;
  return `${[jwt, ...disclosures].join('~')}~${options.suffix ?? ''}`;
}

let directory: string;
let file: string;
let keyFile: string;

async function saveCredential(credential: string) {
  const artifact = {
    version: 1,
    credential,
    issuer: 'https://api.link.com',
    expires_at: new Date((NOW + 3600) * 1000).toISOString(),
    holder: {
      jwk: holderPublicJwk,
      path: keyFile,
      thumbprint: 'cached-value',
      created: true,
    },
    claims: {},
  };
  await fs.writeFile(file, JSON.stringify(artifact), { mode: 0o600 });
}

async function saveHolderKey(jwk: unknown) {
  await fs.writeFile(keyFile, JSON.stringify({ private_jwk: jwk }), {
    mode: 0o600,
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'link-present-golden-'));
  vi.spyOn(os, 'homedir').mockReturnValue(directory);
  const store = path.join(directory, '.link-cli', 'identity', 'credentials');
  await fs.mkdir(store, { recursive: true });
  file = path.join(store, 'current.json');
  keyFile = path.join(directory, '.link-cli', 'identity', 'holder-key.jwk');
  await saveHolderKey(holderPrivateJwk);
  await saveCredential(mint());
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

const GOLDEN_PRESENTATIONS: Record<string, string> = {
  email:
    'eyJ0eXAiOiJkYytzZC1qd3QiLCJhbGciOiJFZERTQSIsImtpZCI6ImZpeHR1cmUifQ.eyJpc3MiOiJodHRwczovL2FwaS5saW5rLmNvbSIsInZjdCI6Imh0dHBzOi8vYXBpLmxpbmsuY29tL2NyZWRlbnRpYWxzL2FhcC92MSIsImlhdCI6MTc5OTk5OTk0MCwiZXhwIjoxODAwMDAzNjAwLCJjbmYiOnsiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiRTVqMkxHMGFSWHhSdW1wTFh6MjlMMm44cVRJV0lZM0ltWDVCYTlGOWs4byJ9fSwiX3NkIjpbInBHYUFrS3NnUm5GNXFkSC1aaWJHRlFDYU1uUlB3N2NLdVl5emcwaDlWS3MiLCJvelFuc21jSXFVSzVkaTg3eWM1N0dsak1yQkFwV0Q1Qkd5UUJqZjM4SmtvIiwiYl9aZ2RPSE93Zm1TRnZJR0hMU24ycENILXZHS1Z3eWJrV2hyTmpYN2xfVSJdLCJfc2RfYWxnIjoic2hhLTI1NiJ9.9mb2aTCwb6lEXo974WqaJA8YnJsxGa7JQz9zltcYkWL9esH82WUGzZI8gC3DyjqSYtMfG-5-NZF2o7NoorMEBQ~WyJlbWFpbC1zYWx0IiwiZW1haWwiLCJwcml2YXRlQGV4YW1wbGUudGVzdCJd~eyJ0eXAiOiJrYitqd3QiLCJhbGciOiJFZERTQSJ9.eyJhdWQiOiJodHRwczovL2RpcmVjdG9yeS5leGFtcGxlIiwibm9uY2UiOiJjaGFsbGVuZ2Utbm9uY2UiLCJpYXQiOjE4MDAwMDAwMDAsInNkX2hhc2giOiJmbXZjWE5OQ3BfUU1qS2MyRGxLRGYtRlI5YXQzTmtPb3ZIdjJuTW9VS2N3In0.nG0zW_cPYMgBtYVjmRd4en3u1B5zfS1tyVpIHm15nCpONo9w1S6vSX7KV9U8j3dcNykNRvJcbPojf0SB58L2CQ',
  'repeated claims in requested order':
    'eyJ0eXAiOiJkYytzZC1qd3QiLCJhbGciOiJFZERTQSIsImtpZCI6ImZpeHR1cmUifQ.eyJpc3MiOiJodHRwczovL2FwaS5saW5rLmNvbSIsInZjdCI6Imh0dHBzOi8vYXBpLmxpbmsuY29tL2NyZWRlbnRpYWxzL2FhcC92MSIsImlhdCI6MTc5OTk5OTk0MCwiZXhwIjoxODAwMDAzNjAwLCJjbmYiOnsiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiRTVqMkxHMGFSWHhSdW1wTFh6MjlMMm44cVRJV0lZM0ltWDVCYTlGOWs4byJ9fSwiX3NkIjpbInBHYUFrS3NnUm5GNXFkSC1aaWJHRlFDYU1uUlB3N2NLdVl5emcwaDlWS3MiLCJvelFuc21jSXFVSzVkaTg3eWM1N0dsak1yQkFwV0Q1Qkd5UUJqZjM4SmtvIiwiYl9aZ2RPSE93Zm1TRnZJR0hMU24ycENILXZHS1Z3eWJrV2hyTmpYN2xfVSJdLCJfc2RfYWxnIjoic2hhLTI1NiJ9.9mb2aTCwb6lEXo974WqaJA8YnJsxGa7JQz9zltcYkWL9esH82WUGzZI8gC3DyjqSYtMfG-5-NZF2o7NoorMEBQ~WyJwaG9uZS1zYWx0IiwicGhvbmVfbnVtYmVyIiwiKzE1NTUwMDAwMDAwIl0~WyJlbWFpbC1zYWx0IiwiZW1haWwiLCJwcml2YXRlQGV4YW1wbGUudGVzdCJd~eyJ0eXAiOiJrYitqd3QiLCJhbGciOiJFZERTQSJ9.eyJhdWQiOiJodHRwczovL2RpcmVjdG9yeS5leGFtcGxlIiwibm9uY2UiOiJjaGFsbGVuZ2Utbm9uY2UiLCJpYXQiOjE4MDAwMDAwMDAsInNkX2hhc2giOiJES3dKNHVBWjNZQ3owMHk3ZTdJRVZneE5sMXZxSi1aQnFidm00ejhfWkxVIn0.GUcoU_W64DmYn-8ius88bOoNxYOtBs9dXvijynzn5db7k7IeA4hRk6wftLptsb7Ax8O94BrtNH8NIcE2F2lyAQ',
  'all claims':
    'eyJ0eXAiOiJkYytzZC1qd3QiLCJhbGciOiJFZERTQSIsImtpZCI6ImZpeHR1cmUifQ.eyJpc3MiOiJodHRwczovL2FwaS5saW5rLmNvbSIsInZjdCI6Imh0dHBzOi8vYXBpLmxpbmsuY29tL2NyZWRlbnRpYWxzL2FhcC92MSIsImlhdCI6MTc5OTk5OTk0MCwiZXhwIjoxODAwMDAzNjAwLCJjbmYiOnsiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiRTVqMkxHMGFSWHhSdW1wTFh6MjlMMm44cVRJV0lZM0ltWDVCYTlGOWs4byJ9fSwiX3NkIjpbInBHYUFrS3NnUm5GNXFkSC1aaWJHRlFDYU1uUlB3N2NLdVl5emcwaDlWS3MiLCJvelFuc21jSXFVSzVkaTg3eWM1N0dsak1yQkFwV0Q1Qkd5UUJqZjM4SmtvIiwiYl9aZ2RPSE93Zm1TRnZJR0hMU24ycENILXZHS1Z3eWJrV2hyTmpYN2xfVSJdLCJfc2RfYWxnIjoic2hhLTI1NiJ9.9mb2aTCwb6lEXo974WqaJA8YnJsxGa7JQz9zltcYkWL9esH82WUGzZI8gC3DyjqSYtMfG-5-NZF2o7NoorMEBQ~WyJlbWFpbC1zYWx0IiwiZW1haWwiLCJwcml2YXRlQGV4YW1wbGUudGVzdCJd~WyJuYW1lLXNhbHQiLCJnaXZlbl9uYW1lIiwiVW5kaXNjbG9zZWROYW1lIl0~WyJwaG9uZS1zYWx0IiwicGhvbmVfbnVtYmVyIiwiKzE1NTUwMDAwMDAwIl0~eyJ0eXAiOiJrYitqd3QiLCJhbGciOiJFZERTQSJ9.eyJhdWQiOiJodHRwczovL2RpcmVjdG9yeS5leGFtcGxlIiwibm9uY2UiOiJjaGFsbGVuZ2Utbm9uY2UiLCJpYXQiOjE4MDAwMDAwMDAsInNkX2hhc2giOiJBMUZOQ1lGMHIxRWhTZ29YMFM0WWh6Y0dTRDgzMkF3aEloMTZ1b3RuWmlNIn0.iJp1aShiGSlwxtRTePSakqA2CcyvX8YOO3W2FZIKyJJfD80OKFTobivsU001qWTKwDkcQf9EArzsJusZk0QDCw',
  'exact audience and unicode nonce':
    'eyJ0eXAiOiJkYytzZC1qd3QiLCJhbGciOiJFZERTQSIsImtpZCI6ImZpeHR1cmUifQ.eyJpc3MiOiJodHRwczovL2FwaS5saW5rLmNvbSIsInZjdCI6Imh0dHBzOi8vYXBpLmxpbmsuY29tL2NyZWRlbnRpYWxzL2FhcC92MSIsImlhdCI6MTc5OTk5OTk0MCwiZXhwIjoxODAwMDAzNjAwLCJjbmYiOnsiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiRTVqMkxHMGFSWHhSdW1wTFh6MjlMMm44cVRJV0lZM0ltWDVCYTlGOWs4byJ9fSwiX3NkIjpbInBHYUFrS3NnUm5GNXFkSC1aaWJHRlFDYU1uUlB3N2NLdVl5emcwaDlWS3MiLCJvelFuc21jSXFVSzVkaTg3eWM1N0dsak1yQkFwV0Q1Qkd5UUJqZjM4SmtvIiwiYl9aZ2RPSE93Zm1TRnZJR0hMU24ycENILXZHS1Z3eWJrV2hyTmpYN2xfVSJdLCJfc2RfYWxnIjoic2hhLTI1NiJ9.9mb2aTCwb6lEXo974WqaJA8YnJsxGa7JQz9zltcYkWL9esH82WUGzZI8gC3DyjqSYtMfG-5-NZF2o7NoorMEBQ~WyJuYW1lLXNhbHQiLCJnaXZlbl9uYW1lIiwiVW5kaXNjbG9zZWROYW1lIl0~eyJ0eXAiOiJrYitqd3QiLCJhbGciOiJFZERTQSJ9.eyJhdWQiOiJodHRwczovL2RpcmVjdG9yeS5leGFtcGxlOjQ0My9wYXRoLyIsIm5vbmNlIjoiY2hhbGxlbmdlKy89d2l0aCB1bmljb2RlIMOpIiwiaWF0IjoxODAwMDAwMDAwLCJzZF9oYXNoIjoiRF9MdU1tN3c5S19mSEQyUjF0R20wbTJrM0NzZGk2bVFJYVlCdzJRaUVuUSJ9.V-mk33DbONlJ-hi9Jf0W3KHPOLtj3ZVBFNa7EzrM-w2CZoFZmmW_f6RDSNcpHQ6WlOcF3rPqM-OE3YmbokDpDg',
  'vc+sd-jwt with default _sd_alg':
    'eyJ0eXAiOiJ2YytzZC1qd3QiLCJhbGciOiJFZERTQSJ9.eyJpc3MiOiJodHRwczovL2FwaS5saW5rLmNvbSIsInZjdCI6Imh0dHBzOi8vYXBpLmxpbmsuY29tL2NyZWRlbnRpYWxzL2FhcC92MSIsImlhdCI6MTc5OTk5OTk0MCwiZXhwIjoxODAwMDAzNjAwLCJjbmYiOnsiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiRTVqMkxHMGFSWHhSdW1wTFh6MjlMMm44cVRJV0lZM0ltWDVCYTlGOWs4byJ9fSwiX3NkIjpbInBHYUFrS3NnUm5GNXFkSC1aaWJHRlFDYU1uUlB3N2NLdVl5emcwaDlWS3MiLCJvelFuc21jSXFVSzVkaTg3eWM1N0dsak1yQkFwV0Q1Qkd5UUJqZjM4SmtvIiwiYl9aZ2RPSE93Zm1TRnZJR0hMU24ycENILXZHS1Z3eWJrV2hyTmpYN2xfVSJdfQ.BvjhTALGfwAedGnvPtwgHxr1bvDGPXDjLDCMirXrXRoxpZ9ZcufqvLEYqN360VE1bUIP9i0Y3wBQ3fcByMLnAw~WyJlbWFpbC1zYWx0IiwiZW1haWwiLCJwcml2YXRlQGV4YW1wbGUudGVzdCJd~eyJ0eXAiOiJrYitqd3QiLCJhbGciOiJFZERTQSJ9.eyJhdWQiOiJodHRwczovL2RpcmVjdG9yeS5leGFtcGxlIiwibm9uY2UiOiJjaGFsbGVuZ2Utbm9uY2UiLCJpYXQiOjE4MDAwMDAwMDAsInNkX2hhc2giOiJLUUdrbGJqVXZ0dENGWWhhRlFXNlM5NlhHVG9Sd3NqVTdOR3VLaFE0aDBRIn0.ROv3hvkjsJvMZ3uTLJ7aFFbe7oSUEHfMOivWnCm5S-qS3hRflMupbh8-unCTmQniW-MBWqnewQOPlEcQN5ZsDA',
  'audience restriction naming this audience':
    'eyJ0eXAiOiJkYytzZC1qd3QiLCJhbGciOiJFZERTQSIsImtpZCI6ImZpeHR1cmUifQ.eyJpc3MiOiJodHRwczovL2FwaS5saW5rLmNvbSIsInZjdCI6Imh0dHBzOi8vYXBpLmxpbmsuY29tL2NyZWRlbnRpYWxzL2FhcC92MSIsImlhdCI6MTc5OTk5OTk0MCwiZXhwIjoxODAwMDAzNjAwLCJjbmYiOnsiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiRTVqMkxHMGFSWHhSdW1wTFh6MjlMMm44cVRJV0lZM0ltWDVCYTlGOWs4byJ9fSwiX3NkIjpbInBHYUFrS3NnUm5GNXFkSC1aaWJHRlFDYU1uUlB3N2NLdVl5emcwaDlWS3MiLCJvelFuc21jSXFVSzVkaTg3eWM1N0dsak1yQkFwV0Q1Qkd5UUJqZjM4SmtvIiwiYl9aZ2RPSE93Zm1TRnZJR0hMU24ycENILXZHS1Z3eWJrV2hyTmpYN2xfVSJdLCJfc2RfYWxnIjoic2hhLTI1NiIsImF1ZCI6WyJodHRwczovL290aGVyLmV4YW1wbGUiLCJodHRwczovL2RpcmVjdG9yeS5leGFtcGxlIl0sIm5iZiI6MTgwMDAwMDAwMH0.t60HKuxcdHqRERPUvYYUz3tk0BN5bVn2wND17Sz8Dm4W1cHkQINxGmrGTsKT08KsbGXjx4InKfwKFmqbwEXCCQ~WyJlbWFpbC1zYWx0IiwiZW1haWwiLCJwcml2YXRlQGV4YW1wbGUudGVzdCJd~eyJ0eXAiOiJrYitqd3QiLCJhbGciOiJFZERTQSJ9.eyJhdWQiOiJodHRwczovL2RpcmVjdG9yeS5leGFtcGxlIiwibm9uY2UiOiJjaGFsbGVuZ2Utbm9uY2UiLCJpYXQiOjE4MDAwMDAwMDAsInNkX2hhc2giOiJleTJvbmJqM3N3Z01rWGNvenUxZkxveG5TYmFacklPbTVKRWVwMFlVNDdzIn0.C_F7XFoVhEk_DJNXq--Cnee9vvgU6rG-yxK_ps7dJQQ_Zf-spppYYLVpyF6Q7URrCaAeLyHO1NBmIZnDfYx6Dg',
  'optional profile members':
    'eyJ0eXAiOiJkYytzZC1qd3QiLCJhbGciOiJFZERTQSIsImtpZCI6ImZpeHR1cmUifQ.eyJpc3MiOiJodHRwczovL2FwaS5saW5rLmNvbSIsInZjdCI6Imh0dHBzOi8vYXBpLmxpbmsuY29tL2NyZWRlbnRpYWxzL2FhcC92MSIsImlhdCI6MTc5OTk5OTk0MCwiZXhwIjoxODAwMDAzNjAwLCJjbmYiOnsiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiRTVqMkxHMGFSWHhSdW1wTFh6MjlMMm44cVRJV0lZM0ltWDVCYTlGOWs4byJ9fSwiX3NkIjpbInBHYUFrS3NnUm5GNXFkSC1aaWJHRlFDYU1uUlB3N2NLdVl5emcwaDlWS3MiLCJvelFuc21jSXFVSzVkaTg3eWM1N0dsak1yQkFwV0Q1Qkd5UUJqZjM4SmtvIiwiYl9aZ2RPSE93Zm1TRnZJR0hMU24ycENILXZHS1Z3eWJrV2hyTmpYN2xfVSJdLCJfc2RfYWxnIjoic2hhLTI1NiIsInN0YXR1cyI6eyJpZHgiOjF9LCJ2Y3QjaW50ZWdyaXR5Ijoic2hhMjU2LWFiYyJ9.9LssileKUOd4HxYz714TvGPhVIXgvBT_5ePP-qvfxSNHqmhShnhI1-ENi9IzECbJf5xgEaD3ereiz3Sa2NjGDQ~WyJwaG9uZS1zYWx0IiwicGhvbmVfbnVtYmVyIiwiKzE1NTUwMDAwMDAwIl0~eyJ0eXAiOiJrYitqd3QiLCJhbGciOiJFZERTQSJ9.eyJhdWQiOiJodHRwczovL2RpcmVjdG9yeS5leGFtcGxlIiwibm9uY2UiOiJjaGFsbGVuZ2Utbm9uY2UiLCJpYXQiOjE4MDAwMDAwMDAsInNkX2hhc2giOiJxMUJlQ0t1NDVnNjFVR0RGajNwQzJjMEFLbWlUVDdGbHBnRTZ6MEVueGFRIn0.wGFBu-Q16QwVHATZPXbZgrlPsnRjBy2X81QS6iW1rOjYexxg3IoSKvoNY5Uk3DUdB_lHTWMX6EpgDycpeV0VDA',
};

const GOLDEN_COMMANDS: Record<string, { code: number; output: string }> = {
  success: {
    code: 0,
    output:
      '{\n  "presentation": "eyJ0eXAiOiJkYytzZC1qd3QiLCJhbGciOiJFZERTQSIsImtpZCI6ImZpeHR1cmUifQ.eyJpc3MiOiJodHRwczovL2FwaS5saW5rLmNvbSIsInZjdCI6Imh0dHBzOi8vYXBpLmxpbmsuY29tL2NyZWRlbnRpYWxzL2FhcC92MSIsImlhdCI6MTc5OTk5OTk0MCwiZXhwIjoxODAwMDAzNjAwLCJjbmYiOnsiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiRTVqMkxHMGFSWHhSdW1wTFh6MjlMMm44cVRJV0lZM0ltWDVCYTlGOWs4byJ9fSwiX3NkIjpbInBHYUFrS3NnUm5GNXFkSC1aaWJHRlFDYU1uUlB3N2NLdVl5emcwaDlWS3MiLCJvelFuc21jSXFVSzVkaTg3eWM1N0dsak1yQkFwV0Q1Qkd5UUJqZjM4SmtvIiwiYl9aZ2RPSE93Zm1TRnZJR0hMU24ycENILXZHS1Z3eWJrV2hyTmpYN2xfVSJdLCJfc2RfYWxnIjoic2hhLTI1NiJ9.9mb2aTCwb6lEXo974WqaJA8YnJsxGa7JQz9zltcYkWL9esH82WUGzZI8gC3DyjqSYtMfG-5-NZF2o7NoorMEBQ~WyJlbWFpbC1zYWx0IiwiZW1haWwiLCJwcml2YXRlQGV4YW1wbGUudGVzdCJd~WyJwaG9uZS1zYWx0IiwicGhvbmVfbnVtYmVyIiwiKzE1NTUwMDAwMDAwIl0~eyJ0eXAiOiJrYitqd3QiLCJhbGciOiJFZERTQSJ9.eyJhdWQiOiJodHRwczovL2RpcmVjdG9yeS5leGFtcGxlIiwibm9uY2UiOiJjaGFsbGVuZ2Utbm9uY2UiLCJpYXQiOjE4MDAwMDAwMDAsInNkX2hhc2giOiI2U0EtYzZXZGZJZmtIdXhEbzNRWGpqOFlKZWxneGt3TVZ6RlJJblF1bGFnIn0.nUdJ35WTp-i1ya14PRKmALiSybCmy2MXuhgDO3OnTpMYZaoT3gkLalk2ZsUUB6umgrWyaAEBD1kjaXUzvC_EDw"\n}\n',
  },
  'unavailable claim': {
    code: 1,
    output:
      '{\n  "code": "INVALID_INPUT",\n  "message": "Requested claim is not available for selective disclosure: address"\n}\n',
  },
  'expired credential': {
    code: 1,
    output:
      '{\n  "code": "INVALID_INPUT",\n  "message": "Saved identity credential has expired. Run identity credentials request again."\n}\n',
  },
  'unsupported cnf.jwk': {
    code: 1,
    output:
      '{\n  "code": "configuration_error",\n  "message": "Holder public key must be an Ed25519 OKP JWK with an x member"\n}\n',
  },
  'missing holder key': {
    code: 1,
    output:
      '{\n  "code": "INVALID_INPUT",\n  "message": "Unable to load the saved holder key. It must exist, contain a valid private JWK, and not be a symbolic link."\n}\n',
  },
  'different holder key': {
    code: 1,
    output:
      '{\n  "code": "INVALID_INPUT",\n  "message": "Saved holder key does not match the credential cnf.jwk. Request a new credential."\n}\n',
  },
};

describe('golden presentations', () => {
  it.each<{
    name: string;
    credential?: Credential;
    aud?: string;
    nonce?: string;
    claim: string[];
  }>([
    { name: 'email', claim: ['email'] },
    {
      name: 'repeated claims in requested order',
      claim: ['phone_number', 'email', 'email'],
    },
    {
      name: 'all claims',
      claim: ['email', 'given_name', 'phone_number'],
    },
    {
      name: 'exact audience and unicode nonce',
      aud: 'https://directory.example:443/path/',
      nonce: 'challenge+/=with unicode é',
      claim: ['given_name'],
    },
    {
      name: 'vc+sd-jwt with default _sd_alg',
      credential: {
        header: { typ: 'vc+sd-jwt', alg: 'EdDSA' },
        payload: { _sd_alg: undefined },
      },
      claim: ['email'],
    },
    {
      name: 'audience restriction naming this audience',
      credential: {
        payload: { aud: ['https://other.example', AUD], nbf: NOW },
      },
      claim: ['email'],
    },
    {
      name: 'optional profile members',
      credential: {
        payload: { status: { idx: 1 }, 'vct#integrity': 'sha256-abc' },
      },
      claim: ['phone_number'],
    },
  ])('$name', async ({ name, credential, aud, nonce, claim }) => {
    await saveCredential(mint(credential));
    const result = await presentIdentityCredential({
      aud: aud ?? AUD,
      nonce: nonce ?? NONCE,
      claim,
    });
    expect(Object.keys(result)).toEqual(['presentation']);
    expect(result.presentation).toBe(GOLDEN_PRESENTATIONS[name]);
  });
});

const profileError =
  'Saved credential does not use the supported Link SD-JWT profile (flat disclosures, SHA-256, no plaintext user claims).';
const holderLoadError =
  'Unable to load the saved holder key. It must exist, contain a valid private JWK, and not be a symbolic link.';

describe('golden error messages', () => {
  it.each<{
    name: string;
    credential?: Credential | string;
    setup?: () => Promise<void>;
    claim?: string[];
    aud?: string;
    error: string;
    message: string | (() => string);
  }>([
    {
      name: 'missing credential artifact',
      setup: () => fs.unlink(file),
      error: 'Error',
      message:
        'No saved identity credential. Run identity credentials request first.',
    },
    {
      name: 'artifact is not JSON',
      setup: () => fs.writeFile(file, 'not JSON: private@example.test'),
      error: 'Error',
      message: () => `Invalid JSON in ${file}.`,
    },
    {
      name: 'artifact has the wrong shape',
      setup: () => fs.writeFile(file, JSON.stringify({ version: 2 })),
      error: 'Error',
      message: () => `Invalid or unsupported identity artifact in ${file}.`,
    },
    ...[
      ['trailing Key Binding JWT', { suffix: 'kb.jwt.sig' }],
      ['no tilde', 'a.b.c'],
      ['empty issuer JWT', '~'],
    ].map(([name, credential]) => ({
      name: name as string,
      credential: credential as Credential | string,
      error: 'Error',
      message: 'Saved credential must be an SD-JWT without a Key Binding JWT.',
    })),
    ...['a.b~', 'a.b.c.d~', 'a..c~', 'e30=.e30.c~', 'a.b.c!~'].map(
      (credential) => ({
        name: `issuer JWT ${credential}`,
        credential,
        error: 'Error',
        message: 'Saved credential has an invalid issuer JWT.',
      }),
    ),
    ...(
      [
        ['header is not JSON', { headerSegment: raw('not json') }],
        ['payload is not JSON', { payloadSegment: raw('{"email":') }],
        [
          'BOM-prefixed header',
          {
            headerSegment: raw(
              Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from('{}')]),
            ),
          },
        ],
        ['non-canonical header', { headerSegment: 'e31' }],
        ['disclosure is not JSON', { disclosures: [raw('private-invalid')] }],
        ['empty disclosure', { disclosures: [EMAIL, ''] }],
      ] as const
    ).map(([name, credential]) => ({
      name,
      credential,
      error: 'Error',
      message: 'Saved credential contains invalid base64url JSON.',
    })),
    ...(
      [
        ['typ JWT', { header: { typ: 'JWT', alg: 'EdDSA' } }],
        ['header array', { header: ['dc+sd-jwt'] }],
        ['other issuer', { payload: { iss: 'https://evil.example' } }],
        ['plaintext claim', { payload: { email: 'private@example.test' } }],
        ['missing exp', { payload: { exp: undefined } }],
        ['sha-512', { payload: { _sd_alg: 'sha-512' } }],
        [
          'extra cnf member',
          { payload: { cnf: { jwk: holderPublicJwk, kid: 'k' } } },
        ],
      ] as const
    ).map(([name, credential]) => ({
      name: `profile: ${name}`,
      credential,
      error: 'Error',
      message: profileError,
    })),
    {
      name: 'expired',
      credential: { payload: { exp: NOW } },
      error: 'Error',
      message:
        'Saved identity credential has expired. Run identity credentials request again.',
    },
    {
      name: 'expired with a missing holder key',
      credential: { payload: { exp: NOW } },
      setup: () => fs.unlink(keyFile),
      error: 'Error',
      message:
        'Saved identity credential has expired. Run identity credentials request again.',
    },
    {
      name: 'not yet valid',
      credential: { payload: { nbf: NOW + 1 } },
      error: 'Error',
      message: 'Saved identity credential is not yet valid.',
    },
    {
      name: 'different audience',
      credential: { payload: { aud: 'https://other.example' } },
      error: 'Error',
      message: 'Saved credential is restricted to a different audience.',
    },
    {
      name: 'duplicate commitments',
      credential: { sd: [hash(EMAIL), hash(EMAIL)] },
      error: 'Error',
      message: 'Saved credential contains duplicate disclosure commitments.',
    },
    ...(
      [
        ['payload', { payload: { status: { _sd: [] } } }],
        [
          'disclosure',
          { disclosures: [encode(['s', 'address', { _sd: ['d'] }])] },
        ],
      ] as const
    ).map(([name, credential]) => ({
      name: `nested in ${name}`,
      credential,
      error: 'Error',
      message: 'Nested selective disclosure is not supported.',
    })),
    ...(
      [
        ['uncommitted', { sd: [] }],
        ['array element', { disclosures: [encode(['salt', 'value'])] }],
        ['non-string name', { disclosures: [encode(['salt', 1, 'v'])] }],
      ] as const
    ).map(([name, credential]) => ({
      name: `disclosure: ${name}`,
      credential,
      error: 'Error',
      message:
        'Saved credential contains an invalid or uncommitted disclosure.',
    })),
    ...(
      [
        ['reserved exp', { disclosures: [encode(['salt', 'exp', 1])] }],
        ['reserved ...', { disclosures: [encode(['salt', '...', 1])] }],
        [
          'duplicate',
          { disclosures: [EMAIL, encode(['o', 'email', 'o@example.test'])] },
        ],
      ] as const
    ).map(([name, credential]) => ({
      name: `claim: ${name}`,
      credential,
      error: 'Error',
      message:
        'Saved credential contains a reserved or duplicate disclosure claim.',
    })),
    {
      name: 'unavailable claim',
      claim: ['email', 'address'],
      error: 'Error',
      message:
        'Requested claim is not available for selective disclosure: address',
    },
    {
      name: 'unavailable claim with a missing holder key',
      claim: ['address'],
      setup: () => fs.unlink(keyFile),
      error: 'Error',
      message:
        'Requested claim is not available for selective disclosure: address',
    },
    {
      name: 'missing holder key',
      setup: () => fs.unlink(keyFile),
      error: 'Error',
      message: holderLoadError,
    },
    {
      name: 'holder key is not JSON',
      setup: () => fs.writeFile(keyFile, 'not JSON'),
      error: 'Error',
      message: holderLoadError,
    },
    {
      name: 'holder key is a symbolic link',
      setup: async () => {
        await fs.rename(keyFile, `${keyFile}.real`);
        await fs.symlink(`${keyFile}.real`, keyFile);
      },
      error: 'Error',
      message: holderLoadError,
    },
    {
      name: 'holder key is not Ed25519',
      setup: () =>
        saveHolderKey(
          generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
            format: 'jwk',
          }),
        ),
      error: 'Error',
      message: holderLoadError,
    },
    {
      name: 'different holder key',
      setup: () => saveHolderKey(otherPrivateJwk),
      error: 'Error',
      message:
        'Saved holder key does not match the credential cnf.jwk. Request a new credential.',
    },
    {
      name: 'malformed cnf.jwk x',
      credential: {
        payload: { cnf: { jwk: { kty: 'OKP', crv: 'Ed25519', x: 'AAAA' } } },
      },
      error: 'Error',
      message:
        'Saved holder key does not match the credential cnf.jwk. Request a new credential.',
    },
    {
      name: 'cnf.jwk is not an object',
      credential: { payload: { cnf: { jwk: 'jwk' } } },
      error: 'LinkConfigurationError',
      message: 'Holder public key must be a JWK object',
    },
    {
      name: 'cnf.jwk is missing',
      credential: { payload: { cnf: {} } },
      error: 'Error',
      message: profileError,
    },
    {
      name: 'cnf.jwk has no kty',
      credential: { payload: { cnf: { jwk: { kty: 1 } } } },
      error: 'LinkConfigurationError',
      message: 'Holder public key is missing kty',
    },
    {
      name: 'cnf.jwk is not Ed25519',
      credential: {
        payload: { cnf: { jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } } },
      },
      error: 'LinkConfigurationError',
      message: 'Holder public key must be an Ed25519 OKP JWK with an x member',
    },
  ])('$name', async ({ credential, setup, claim, aud, error, message }) => {
    if (credential !== undefined) {
      await saveCredential(
        typeof credential === 'string' ? credential : mint(credential),
      );
    }
    await setup?.();
    const thrown = await presentIdentityCredential({
      aud: aud ?? AUD,
      nonce: NONCE,
      claim: claim ?? ['email'],
    }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(thrown?.constructor.name).toBe(error);
    expect(thrown?.message).toBe(
      typeof message === 'function' ? message() : message,
    );
  });
});

describe('golden command output', () => {
  async function run(args: string[]) {
    const cli = createIdentityCredentialsCli(() => {
      throw new Error('Unexpected API access');
    });
    let output = '';
    let code = 0;
    await cli.serve(['present', ...args, '--format', 'json'], {
      stdout: (text) => {
        output += text;
      },
      exit: (status) => {
        code = status;
      },
    });
    return { output, code };
  }

  it.each<{
    name: string;
    credential?: Credential;
    setup?: () => Promise<void>;
    args: string[];
  }>([
    {
      name: 'success',
      args: [
        '--aud',
        AUD,
        '--nonce',
        NONCE,
        '--claim',
        'email',
        '--claim',
        'phone_number',
      ],
    },
    {
      name: 'unavailable claim',
      args: ['--aud', AUD, '--nonce', NONCE, '--claim', 'address'],
    },
    {
      name: 'expired credential',
      credential: { payload: { exp: NOW } },
      args: ['--aud', AUD, '--nonce', NONCE, '--claim', 'email'],
    },
    {
      name: 'unsupported cnf.jwk',
      credential: { payload: { cnf: { jwk: { kty: 'EC' } } } },
      args: ['--aud', AUD, '--nonce', NONCE, '--claim', 'email'],
    },
    {
      name: 'missing holder key',
      setup: () => fs.unlink(keyFile),
      args: ['--aud', AUD, '--nonce', NONCE, '--claim', 'email'],
    },
    {
      name: 'different holder key',
      setup: () => saveHolderKey(otherPrivateJwk),
      args: ['--aud', AUD, '--nonce', NONCE, '--claim', 'email'],
    },
  ])('$name', async ({ name, credential, setup, args }) => {
    if (credential) await saveCredential(mint(credential));
    await setup?.();
    const { output, code } = await run(args);
    expect({ code, output }).toEqual(GOLDEN_COMMANDS[name]);
  });
});
