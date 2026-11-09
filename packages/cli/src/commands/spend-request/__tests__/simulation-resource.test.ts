import { describe, expect, it } from 'vitest';
import {
  ResourceFactory,
  sanitizeResource,
} from '../../../utils/resource-factory';
import { FixtureSpendRequestSimulationResource } from '../simulation-resource';

describe('fixture spend-request simulation provider', () => {
  it('returns backend-compatible catalog framing and fresh descriptors', async () => {
    const provider = new FixtureSpendRequestSimulationResource();
    const catalog = await provider.listScenarios();
    expect(catalog.catalog_version).toBe(1);
    expect(catalog.data).toHaveLength(34);
    expect(catalog.data[0]).toMatchObject({
      id: 'ssn_verification',
      evidence_kind: 'production',
    });
    expect(
      catalog.data.every((row) => !('scenario' in row) && !('action' in row)),
    ).toBe(true);
    catalog.data[0].id = 'mutated';
    expect((await provider.listScenarios()).data[0].id).toBe(
      'ssn_verification',
    );
    const alias = await provider.simulate('visa_otp');
    expect(alias).toEqual(await provider.simulate('partner_auth_challenge'));
    if (alias.next_action) alias.next_action.action_url = 'changed';
    expect(await provider.simulate('visa_otp')).toEqual(
      await provider.simulate('partner_auth_challenge'),
    );
  });

  it('caches the provider instance, not mutable output or credentials', async () => {
    const factory = new ResourceFactory();
    const provider = factory.createSpendRequestSimulationResource();
    expect(factory.createSpendRequestSimulationResource()).toBe(provider);
    expect(await provider.simulate('no_next_action')).toEqual({
      next_action: null,
    });
    const scope = await provider.simulate('reauthorize_additional_scope');
    expect(scope.next_action).not.toHaveProperty('action_url');
    expect(scope.next_action).not.toHaveProperty('expires_at');
    await expect(provider.simulate('unknown')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('sanitizes future-provider values without changing URL queries or fragments', async () => {
    const url =
      'https://example.invalid/verify?value=a%2Bb&callback=%2Fdone#step';
    const provider = sanitizeResource({
      simulate: async () => ({
        next_action: {
          type: 'future',
          resolution: 'future',
          display_message: '\u001b[31mPlease verify\u001b[0m',
          action_url: url,
          nested: { extra: '\u0007value' },
        },
      }),
    });
    expect(await provider.simulate()).toEqual({
      next_action: {
        type: 'future',
        resolution: 'future',
        display_message: 'Please verify',
        action_url: url,
        nested: { extra: 'value' },
      },
    });
  });
});
