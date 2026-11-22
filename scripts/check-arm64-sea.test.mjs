// Regression checks for https://github.com/nodejs/node/issues/67048.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertArm64SeaLayout } from './check-arm64-sea.mjs';

function elf(loads) {
  const bytes = new Uint8Array(0x40000);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  view.setUint16(18, 183, true);
  view.setBigUint64(32, 64n, true);
  view.setUint16(54, 56, true);
  view.setUint16(56, loads.length, true);
  loads.forEach(({ offset, address, size, fileSize = size }, index) => {
    const header = 64 + index * 56;
    view.setUint32(header, 1, true);
    view.setBigUint64(header + 8, offset, true);
    view.setBigUint64(header + 16, address, true);
    view.setBigUint64(header + 32, fileSize, true);
    view.setBigUint64(header + 40, size, true);
    // A small p_align alone does not make a segment incompatible.
    view.setBigUint64(header + 48, 0x1000n, true);
  });
  return bytes;
}

const validLoad = { offset: 0n, address: 0x400000n, size: 0x10000n };

test('accepts adjacent compatible mappings despite 4 KiB declared alignment', () => {
  assert.doesNotThrow(() =>
    assertArm64SeaLayout(
      elf([validLoad, { offset: 0x11000n, address: 0x411000n, size: 0x1000n }]),
    ),
  );
});

test('rejects offsets that match at 4 or 16 KiB but disagree at 64 KiB', () => {
  for (const address of [0x401000n, 0x404000n]) {
    assert.throws(
      () => assertArm64SeaLayout(elf([{ ...validLoad, address }])),
      /incompatible file\/address offsets for 64 KiB/,
    );
  }
});

test('rejects a relocated program-header mapping that shares the .bss page', () => {
  assert.throws(
    () =>
      assertArm64SeaLayout(
        elf([
          { ...validLoad, size: 0x11000n, fileSize: 0x10000n },
          { offset: 0x11000n, address: 0x411000n, size: 0x1000n },
        ]),
      ),
    /overlap on a 64 KiB page/,
  );
});

test('reads a Uint8Array view without including surrounding bytes', () => {
  const fixture = elf([validLoad]);
  const buffer = new Uint8Array(fixture.length + 16);
  buffer.set(fixture, 8);
  assert.doesNotThrow(() =>
    assertArm64SeaLayout(buffer.subarray(8, 8 + fixture.length)),
  );
});

test('rejects non-ARM64, truncated, or missing program headers', () => {
  const wrongArchitecture = elf([validLoad]);
  new DataView(wrongArchitecture.buffer).setUint16(18, 62, true);
  assert.throws(() => assertArm64SeaLayout(wrongArchitecture), /ELF64 ARM64/);
  assert.throws(() => assertArm64SeaLayout(new Uint8Array(0)), /ELF64 ARM64/);
  assert.throws(
    () => assertArm64SeaLayout(elf([validLoad]).subarray(0, 80)),
    /program header table/,
  );
  assert.throws(() => assertArm64SeaLayout(elf([])), /program header table/);
  const unsafeOffset = elf([validLoad]);
  new DataView(unsafeOffset.buffer).setBigUint64(32, 2n ** 60n, true);
  assert.throws(
    () => assertArm64SeaLayout(unsafeOffset),
    /program header table/,
  );
});

test('rejects invalid segment sizes and executables without loaded memory', () => {
  for (const load of [
    { ...validLoad, fileSize: validLoad.size + 1n },
    { ...validLoad, offset: 0x40000n },
  ]) {
    assert.throws(() => assertArm64SeaLayout(elf([load])), /Invalid ELF LOAD/);
  }
  assert.throws(
    () => assertArm64SeaLayout(elf([{ ...validLoad, size: 0n }])),
    /no LOAD segments/,
  );
});
