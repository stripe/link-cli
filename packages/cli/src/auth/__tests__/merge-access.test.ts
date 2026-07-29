import { describe, expect, it } from 'vitest';
import { computeMergedAccess } from '../merge-access';
import type { JsonValue } from '../types';

describe('computeMergedAccess', () => {
  it('returns the requested access unchanged when it already covers the existing access', () => {
    const merged = computeMergedAccess({
      requestedScope: 'userinfo:read payment_methods.agentic',
      requestedAuthorizationDetails: [],
      existingScope: 'userinfo:read payment_methods.agentic',
      existingAuthorizationDetails: [],
    });

    expect(merged.mergedScope).toBe('userinfo:read payment_methods.agentic');
    expect(merged.mergedAuthorizationDetails).toEqual([]);
  });

  it('merges scopes present in the existing session but absent from the request', () => {
    const merged = computeMergedAccess({
      requestedScope: 'userinfo:read',
      requestedAuthorizationDetails: [],
      existingScope:
        'userinfo:read payment_methods.agentic spend_requests:approve',
      existingAuthorizationDetails: [],
    });

    expect(merged.mergedScope).toBe(
      'userinfo:read payment_methods.agentic spend_requests:approve',
    );
  });

  it('treats comma-delimited existing scope the same as space-delimited', () => {
    const merged = computeMergedAccess({
      requestedScope: 'userinfo:read payment_methods.agentic',
      requestedAuthorizationDetails: [],
      existingScope: 'userinfo:read,payment_methods.agentic',
      existingAuthorizationDetails: [],
    });

    // Nothing missing — comma form parses to the same tokens as the request.
    expect(merged.mergedScope).toBe('userinfo:read payment_methods.agentic');
  });

  it('falls back to the default scope for both sides when scope is unset', () => {
    const merged = computeMergedAccess({
      requestedAuthorizationDetails: [],
      existingAuthorizationDetails: [],
    });

    expect(merged.mergedScope).toBe('userinfo:read payment_methods.agentic');
  });

  it('unions source actions across requested and existing (keeps already-granted actions)', () => {
    const merged = computeMergedAccess({
      requestedScope: 'userinfo:read payment_methods.agentic',
      requestedAuthorizationDetails: [
        { type: 'source', actions: ['read_external_transactions'] },
      ],
      existingScope: 'userinfo:read payment_methods.agentic',
      existingAuthorizationDetails: [
        {
          type: 'source',
          resource_id: 'src_123',
          actions: ['read_balances'],
        },
      ],
    });

    // The requested action does NOT drop the already-granted action — union.
    expect(merged.mergedAuthorizationDetails).toEqual([
      {
        type: 'source',
        actions: ['read_external_transactions', 'read_balances'],
      },
    ]);
  });

  it('rebuilds existing source access (unioned by type) when it is not re-requested', () => {
    const merged = computeMergedAccess({
      requestedScope: 'userinfo:read payment_methods.agentic',
      requestedAuthorizationDetails: [],
      existingScope: 'userinfo:read payment_methods.agentic',
      existingAuthorizationDetails: [
        {
          type: 'source',
          resource_id: 'src_123',
          actions: ['read_source_details'],
        },
        {
          type: 'source',
          resource_id: 'src_456',
          actions: ['read_link_transactions'],
        },
      ],
    });

    expect(merged.mergedAuthorizationDetails).toEqual([
      {
        type: 'source',
        actions: ['read_source_details', 'read_link_transactions'],
      },
    ]);
  });

  it('preserves opaque (non-{type,actions}) existing details verbatim', () => {
    const opaque: JsonValue = { type: 'account', filters: ['current'] };

    const merged = computeMergedAccess({
      requestedScope: 'userinfo:read payment_methods.agentic',
      requestedAuthorizationDetails: [],
      existingScope: 'userinfo:read payment_methods.agentic',
      existingAuthorizationDetails: [opaque],
    });

    expect(merged.mergedAuthorizationDetails).toEqual([opaque]);
  });

  it('unions action-based details by type and keeps opaque requested/passthrough entries', () => {
    const passthrough: JsonValue = { type: 'account', filters: ['current'] };

    const merged = computeMergedAccess({
      requestedScope: 'userinfo:read payment_methods.agentic',
      requestedAuthorizationDetails: [
        { type: 'account', actions: ['transfer'] },
        passthrough,
        true,
      ],
      existingScope: 'userinfo:read payment_methods.agentic',
      existingAuthorizationDetails: [
        { type: 'account', resource_id: 'acct_123', actions: ['read'] },
      ],
    });

    // The action-based 'account' detail unions requested + existing actions;
    // the opaque passthrough entries are preserved. First-seen order.
    expect(merged.mergedAuthorizationDetails).toEqual([
      { type: 'account', actions: ['transfer', 'read'] },
      passthrough,
      true,
    ]);
  });
});
