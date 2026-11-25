// Temporary guard for https://github.com/nodejs/node/issues/67048.
// Remove alongside postject once Node ships a verified fix.
import { readFileSync } from 'node:fs';

// Compatibility at 64 KiB also covers the 4 and 16 KiB ARM64 page sizes.
const PAGE_SIZE = 0x10000n;

export function assertArm64SeaLayout(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 64 ||
    view.getUint32(0, false) !== 0x7f454c46 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    view.getUint16(18, true) !== 183
  ) {
    throw new Error('Expected a little-endian ELF64 ARM64 executable.');
  }

  const tableOffset = Number(view.getBigUint64(32, true));
  const entrySize = view.getUint16(54, true);
  const count = view.getUint16(56, true);
  if (
    !Number.isSafeInteger(tableOffset) ||
    tableOffset < 64 ||
    entrySize !== 56 ||
    count === 0 ||
    tableOffset + entrySize * count > bytes.length
  ) {
    throw new Error('Invalid ELF program header table.');
  }

  const ranges = [];
  for (let index = 0; index < count; index++) {
    const header = tableOffset + index * entrySize;
    if (view.getUint32(header, true) !== 1) continue; // PT_LOAD
    const offset = view.getBigUint64(header + 8, true);
    const address = view.getBigUint64(header + 16, true);
    const fileSize = view.getBigUint64(header + 32, true);
    const memorySize = view.getBigUint64(header + 40, true);
    if (fileSize > memorySize || offset + fileSize > BigInt(bytes.length)) {
      throw new Error(`Invalid ELF LOAD segment ${index}.`);
    }
    if (offset % PAGE_SIZE !== address % PAGE_SIZE) {
      throw new Error(
        `ARM64 LOAD segment ${index} has incompatible file/address offsets for 64 KiB pages.`,
      );
    }
    if (memorySize === 0n) continue;

    // Include zero-filled .bss: the next mapping must not overwrite its page.
    const start = address / PAGE_SIZE;
    const end = (address + memorySize + PAGE_SIZE - 1n) / PAGE_SIZE;
    if (ranges.some((range) => start < range.end && range.start < end)) {
      throw new Error(
        `ARM64 LOAD segments overlap on a 64 KiB page (segment ${index}).`,
      );
    }
    ranges.push({ start, end });
  }
  if (ranges.length === 0)
    throw new Error('ELF executable has no LOAD segments.');
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3) {
      throw new Error('Usage: node scripts/check-arm64-sea.mjs <binary>');
    }
    assertArm64SeaLayout(readFileSync(process.argv[2]));
    console.log(
      'ARM64 ELF layout passes the 64 KiB page compatibility checks.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
