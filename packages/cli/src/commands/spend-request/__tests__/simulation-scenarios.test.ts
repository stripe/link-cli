import { describe, expect, it } from 'vitest';
import {
  declaredActionTypes,
  getScenarioIds,
  getSimulationScenario,
  listSimulationScenarios,
  resolutions,
  scenarioAliases,
  simulationActionSchema,
} from '../simulation-scenarios';

function requiredScenario(id: string) {
  const fixture = getSimulationScenario(id);
  if (!fixture) throw new Error(`Missing fixture: ${id}`);
  return fixture;
}
function requiredUrl(id: string) {
  const url = requiredScenario(id).action?.action_url;
  if (!url) throw new Error(`Missing URL: ${id}`);
  return url;
}

// Independent pinned inventory: removing a registry entry must fail coverage.
const expectedTypes = [
  'ssn_verification',
  'identity_verification',
  'credit_file_match_ca',
  'rfc_verification_mx',
  'doc_upload_ca',
  'contact_support',
  'select_payment_method',
  'retry_without_delegated_approval',
  'add_payment_method',
  'update_payment_method',
  're_authorize',
  'three_d_secure',
  'three_d_secure_retry',
  'partner_auth_challenge',
  'partner_auth_challenge_retry',
  'partner_create_card_enrollment',
  'reauthorize_additional_scope',
];
const A = 'auto_resume';
const N = 'create_new_spend_request';
const C = 'create_new_spend_request_after_completion';
const S = 'reauthorize_with_additional_scope';
const expectedResolutions = [C, C, C, C, C, C, N, N, C, N, N, A, N, A, N, A, S];
const variants = [
  'identity_verification_ca',
  'identity_verification_mx',
  'identity_verification_jp',
  'identity_verification_sg',
  'credit_file_match_ca_pending',
  'rfc_verification_mx_pending',
  'identity_verification_pending',
  'doc_upload_ca_pending',
  'update_payment_method_cvc',
  'update_payment_method_missing_cardholder_name',
  'update_payment_method_expired',
  'partner_auth_challenge_without_url',
  'no_next_action',
  'three_d_secure_expired',
  'three_d_secure_without_expiry',
  'null_action_type',
  'unknown_action_type',
];

describe('simulation catalog', () => {
  it('pins all 17 declared types, four resolutions, and 34 ordered IDs independently', () => {
    expect(declaredActionTypes).toEqual(expectedTypes);
    expect(resolutions).toEqual([A, N, C, S]);
    expect(getScenarioIds()).toEqual([...expectedTypes, ...variants]);
    expect(new Set(getScenarioIds()).size).toBe(34);
    const canonical = expectedTypes.map((id) => requiredScenario(id));
    expect(canonical.map((row) => row.action?.type)).toEqual(expectedTypes);
    expect(canonical.map((row) => row.action?.resolution)).toEqual(
      expectedResolutions,
    );
    expect(new Set(canonical.map((row) => row.resolution))).toEqual(
      new Set([A, N, C, S]),
    );
    expect(scenarioAliases).toEqual({ visa_otp: 'partner_auth_challenge' });
    expect(getSimulationScenario('visa_otp')).toEqual(
      getSimulationScenario('partner_auth_challenge'),
    );
    expect(getSimulationScenario('__proto__')).toBeUndefined();
  });

  it.each([...expectedTypes, ...variants])(
    'validates deterministic shape, URL policy, and fresh copies: %s',
    (id) => {
      const fixture = requiredScenario(id);
      expect(simulationActionSchema.parse(fixture.action)).toEqual(
        fixture.action,
      );
      const original = structuredClone(fixture);
      const { action } = fixture;
      if (action) {
        expect(action.type).toBe(fixture.type);
        expect(action.resolution).toBe(fixture.resolution);
        if (fixture.url_kind === 'present') {
          const url = new URL(requiredUrl(id));
          expect(url.protocol).toBe('https:');
          expect(url.host).toBe('example.invalid');
          expect([
            '/link-simulation/finish_setup',
            '/link-simulation/wallet',
            '/link-simulation/activity/approve/lsrq_simulation',
            '/link-simulation/',
            '/link-simulation/null_action_type',
            '/link-simulation/unknown_action_type',
          ]).toContain(url.pathname);
          expect(url.username + url.password).toBe('');
          expect(
            [...url.searchParams.keys()].every((key) =>
              [
                'verify',
                'regional_verification',
                'link_action',
                'spend_request_id',
                'intended_email',
                'fromEmail',
              ].includes(key),
            ),
          ).toBe(true);
        } else if (fixture.url_kind === 'null')
          expect(action.action_url).toBeNull();
        else expect(action).not.toHaveProperty('action_url');
        action.display_message = 'mutated';
      }
      fixture.aliases.push('mutated');
      expect(getSimulationScenario(id)).toEqual(original);
      expect(getSimulationScenario(id)).not.toBe(original);
    },
  );

  it('preserves exact producer-shaped URLs with fixed synthetic values', () => {
    expect(requiredUrl('ssn_verification')).toBe(
      'https://example.invalid/link-simulation/finish_setup?verify=ssn_collection&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
    );
    expect(requiredUrl('credit_file_match_ca')).toBe(
      'https://example.invalid/link-simulation/finish_setup?verify=credit_file_match_ca&regional_verification=ca&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
    );
    expect(requiredUrl('three_d_secure')).toBe(
      'https://example.invalid/link-simulation/finish_setup?verify=3ds_complete&spend_request_id=lsrq_simulation&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
    );
    expect(requiredUrl('add_payment_method')).toBe(
      'https://example.invalid/link-simulation/wallet?link_action=add_payment_method&spend_request_id=lsrq_simulation',
    );
    expect(requiredUrl('update_payment_method')).toBe(
      'https://example.invalid/link-simulation/wallet?link_action=update_payment_method&spend_request_id=lsrq_simulation',
    );
    for (const variant of ['cvc', 'missing_cardholder_name', 'expired'])
      expect(requiredUrl(`update_payment_method_${variant}`)).toBe(
        requiredUrl('update_payment_method'),
      );
    expect(requiredUrl('partner_auth_challenge')).toBe(
      'https://example.invalid/link-simulation/activity/approve/lsrq_simulation',
    );
    expect(requiredUrl('partner_create_card_enrollment')).toBe(
      requiredUrl('partner_auth_challenge'),
    );
    expect(requiredUrl('contact_support')).toBe(
      'https://example.invalid/link-simulation/',
    );
    for (const id of getScenarioIds()) {
      const row = requiredScenario(id);
      if (row.action?.action_url) {
        const params = new URL(row.action.action_url).searchParams;
        for (const key of ['intended_email', 'fromEmail'])
          if (params.has(key))
            expect(params.get(key)).toBe('agent+simulation@example.invalid');
        if (params.has('spend_request_id'))
          expect(params.get('spend_request_id')).toBe('lsrq_simulation');
        expect(params.has('action')).toBe(false);
      }
    }
  });

  it('pins the variant mappings and continuation semantics', () => {
    const mappings = [
      ...['ca', 'mx', 'jp', 'sg'].map((country) => [
        `identity_verification_${country}`,
        'identity_verification',
        C,
      ]),
      ...[
        'credit_file_match_ca',
        'rfc_verification_mx',
        'identity_verification',
        'doc_upload_ca',
      ].map((type) => [`${type}_pending`, type, C]),
      ...['cvc', 'missing_cardholder_name', 'expired'].map((suffix) => [
        `update_payment_method_${suffix}`,
        'update_payment_method',
        N,
      ]),
      ['partner_auth_challenge_without_url', 'partner_auth_challenge', A],
      ['three_d_secure_expired', 'three_d_secure', A],
      ['three_d_secure_without_expiry', 'three_d_secure', A],
      ['null_action_type', null, A],
      ['unknown_action_type', 'future_verification_example', A],
    ];
    for (const [id, type, resolution] of mappings) {
      expect(requiredScenario(String(id)).action).toMatchObject({
        type,
        resolution,
      });
    }
    const continuation = {
      [A]: 'keep_same_request',
      [N]: 'create_new_request',
      [C]: 'complete_then_create_new_request',
      [S]: 'obtain_required_scope',
    };
    for (const id of getScenarioIds()) {
      const row = requiredScenario(id);
      expect(row.expected_continuation).toBe(
        row.resolution ? continuation[row.resolution] : 'no_action',
      );
    }
  });

  it('preserves absent versus null fields and fixed expiry cases', () => {
    const scope = requiredScenario('reauthorize_additional_scope');
    expect(scope.source_envelope).toBe('error_next_action');
    expect(scope.action).not.toHaveProperty('action_url');
    expect(scope.action).not.toHaveProperty('expires_at');
    expect(
      getSimulationScenario('select_payment_method')?.action,
    ).toMatchObject({ action_url: null, expires_at: null });
    expect(getSimulationScenario('three_d_secure')?.action?.expires_at).toBe(
      '2099-01-01T00:30:00Z',
    );
    expect(
      getSimulationScenario('three_d_secure_expired')?.action?.expires_at,
    ).toBe('2000-01-01T00:00:00Z');
    expect(
      getSimulationScenario('three_d_secure_without_expiry')?.action,
    ).not.toHaveProperty('expires_at');
    expect(getSimulationScenario('null_action_type')?.action?.type).toBeNull();
    expect(getSimulationScenario('unknown_action_type')?.action?.type).toBe(
      'future_verification_example',
    );
    expect(getSimulationScenario('no_next_action')?.action).toBeNull();
  });

  it('lists fresh descriptors in manifest order with explicit provenance', () => {
    const list = listSimulationScenarios();
    expect(list.map(({ scenario }) => scenario)).toEqual([
      ...expectedTypes,
      ...variants,
    ]);
    expect(list.every((row) => !('action' in row))).toBe(true);
    expect(
      list.find((row) => row.scenario === 'partner_auth_challenge_retry'),
    ).toMatchObject({
      evidence_kind: 'documented_compatibility',
      source_envelope: 'documented_compatibility',
    });
    expect(
      list
        .filter((row) => row.scenario.endsWith('_pending'))
        .every((row) => row.evidence_kind === 'contract_variant'),
    ).toBe(true);
    expect(list.filter((row) => row.aliases.length)).toEqual([
      expect.objectContaining({
        scenario: 'partner_auth_challenge',
        aliases: ['visa_otp'],
      }),
    ]);
    list[0].description = 'changed';
    list[13].aliases.push('changed');
    expect(listSimulationScenarios()).not.toEqual(list);
  });

  it.each(['ca', 'mx', 'jp', 'sg'])(
    'preserves regional parameters for %s',
    (country) => {
      expect(
        new URL(
          requiredUrl(`identity_verification_${country}`),
        ).searchParams.get('regional_verification'),
      ).toBe(country);
    },
  );
});
