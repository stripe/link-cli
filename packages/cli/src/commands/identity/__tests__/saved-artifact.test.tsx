import { render } from 'ink-testing-library';
import { expect, it } from 'vitest';
import { SavedArtifact } from '../saved-artifact';

it('renders a consistent success summary for saved identity artifacts', () => {
  const { lastFrame } = render(
    <SavedArtifact
      message="Identity credential saved"
      outputFile="/tmp/credential.json"
      details={[{ label: 'Expires', value: '2026-09-18T00:00:00Z' }]}
    />,
  );

  expect(lastFrame()).toContain('✓ Identity credential saved');
  expect(lastFrame()).toContain('Saved to: /tmp/credential.json');
  expect(lastFrame()).toContain('Expires: 2026-09-18T00:00:00Z');
});
