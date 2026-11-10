import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkElf, fixElf, readElf } from './fix-sea-elf.mjs';

// Model both failures in the released Node SEA: a PHDR load immediately after
// .bss on a 4 KiB boundary, and a note load whose offset and address differ mod
// 64 KiB. Include a debug section spanning the old table to catch unsafe inserts.
function fixture({ size = 0x29000, noteAddress = 0x805000 } = {}) {
  const bytes = Buffer.alloc(size);
  bytes.set([127, 69, 76, 70, 2, 1, 1]);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(183, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(0x400080n, 24);
  bytes.writeBigUInt64LE(0x23000n, 32);
  bytes.writeBigUInt64LE(0x28100n, 40);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(7, 56);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(3, 60);
  const note = Buffer.concat([
    Buffer.from('NODE_SEA_BLOB\0\0\0'),
    Buffer.alloc(64, 0x5a),
  ]);
  bytes.writeUInt32LE(14, 0x27000);
  bytes.writeUInt32LE(64, 0x27004);
  note.copy(bytes, 0x2700c);
  const noteSize = 12 + note.length;
  const segments = [
    [6, 4, 0x23000, 0x423000, 0x423000, 5 * 56, 5 * 56, 8],
    [1, 5, 0, 0x400000, 0x400000, 0x10000, 0x10000, 0x10000],
    [1, 6, 0x10000, 0x410000, 0x410000, 0x12480, 0x12480, 0x10000],
    [1, 4, 0x23000, 0x423000, 0x423000, 0x400, 0x400, 0x1000],
    [1, 4, 0x27000, noteAddress, noteAddress, 0x1000, 0x1000, 0x1000],
    [4, 4, 0x27000, noteAddress, noteAddress, noteSize, noteSize, 4],
    [0x6474e551, 6, 0, 0, 0, 0, 0, 16],
  ];
  for (const [index, segment] of segments.entries()) {
    const offset = 0x23000 + index * 56;
    bytes.writeUInt32LE(segment[0], offset);
    bytes.writeUInt32LE(segment[1], offset + 4);
    for (let i = 2; i < segment.length; i++)
      bytes.writeBigUInt64LE(BigInt(segment[i]), offset + 8 + (i - 2) * 8);
  }
  bytes.writeUInt32LE(7, 0x28140 + 4);
  bytes.writeBigUInt64LE(2n, 0x28140 + 8);
  bytes.writeBigUInt64LE(0x27000n, 0x28140 + 24);
  bytes.writeBigUInt64LE(BigInt(noteSize), 0x28140 + 32);
  bytes.writeUInt32LE(1, 0x28180 + 4);
  bytes.writeBigUInt64LE(0x22200n, 0x28180 + 24);
  bytes.writeBigUInt64LE(0x2000n, 0x28180 + 32);
  return bytes;
}

test('repairs both large-page failures and maps every program header', () => {
  const original = fixture();
  assert.throws(() => checkElf(original), /alignment|overlap/);
  const corrected = fixElf(original);
  const elf = checkElf(corrected);
  const loads = elf.segments.filter((s) => s.type === 1);
  const phdr = elf.segments.find((s) => s.type === 6);
  assert.equal(elf.phoff % 65536, 0);
  assert.ok(elf.phoff >= original.length);
  assert.equal(phdr.vaddr, 0x400000 + elf.phoff);
  assert.equal(phdr.filesz, 7 * 56);
  assert.equal(phdr.memsz, 7 * 56);
  for (const page of [4096, 16384, 65536]) {
    for (const [index, load] of loads.entries()) {
      assert.equal(load.offset % page, load.vaddr % page);
      if (index > 0) {
        const previous = loads[index - 1];
        assert.ok(
          Math.floor(load.vaddr / page) >=
            Math.ceil((previous.vaddr + previous.memsz) / page),
        );
      }
    }
  }
  assert.equal(elf.sections[1].vaddr, loads.at(-1).vaddr);
});

test('preserves runtime mappings, bytes, SEA payload, debug sections, and file offsets', () => {
  const original = fixture();
  const before = readElf(original);
  const corrected = fixElf(original);
  const after = readElf(corrected);
  assert.deepEqual(after.segments.slice(1, 3), before.segments.slice(1, 3));
  assert.equal(after.entry, before.entry);
  assert.deepEqual(
    corrected.subarray(64, 0x22480),
    original.subarray(64, 0x22480),
  );
  assert.deepEqual(
    corrected.subarray(0x22200, 0x24200),
    original.subarray(0x22200, 0x24200),
  );
  assert.deepEqual(
    corrected.subarray(0x27000, 0x28000),
    original.subarray(0x27000, 0x28000),
  );
  assert.deepEqual(
    after.sections.map((s) => [s.offset, s.size]),
    before.sections.map((s) => [s.offset, s.size]),
  );
});

test('repair is idempotent', () => {
  const corrected = fixElf(fixture());
  assert.strictEqual(fixElf(corrected), corrected);
});

test('rejects shared larger pages even when all load offsets and addresses are congruent', () => {
  const bytes = fixture({ noteAddress: 0x807000 });
  for (const index of [3, 4]) {
    bytes.writeBigUInt64LE(65536n, 0x23000 + index * 56 + 48);
  }
  assert.throws(() => checkElf(bytes), /mappings overlap on 16384-byte pages/);
  checkElf(fixElf(bytes));
});

test('keeps loads ordered when the appended table would occupy the old note address', () => {
  checkElf(fixElf(fixture({ size: 0x60000, noteAddress: 0x440000 })));
});

test('refuses unrelated formats, truncated files, or an unknown injected layout', () => {
  for (const mutate of [
    (b) => b.writeUInt16LE(62, 18),
    (b) => b.writeUInt16LE(3, 16),
    (b) => b.writeUInt32LE(5, 0x23000 + 4 * 56 + 4),
    (b) => b.writeUInt32LE(1, 0x28140 + 4),
    (b) => b.writeUInt32LE(0xffffffff, 0x27004),
    (b) => b.fill(0, 0x2700c, 0x2701c),
    (b) => b.writeBigUInt64LE(0x10001n, 0x23000 + 2 * 56 + 8),
  ]) {
    const bytes = fixture();
    mutate(bytes);
    const copy = Buffer.from(bytes);
    assert.throws(() => fixElf(bytes), /Unsupported ARM64 SEA ELF layout/);
    assert.deepEqual(bytes, copy);
  }
  assert.throws(() => fixElf(Buffer.alloc(10)), /ELF64/);
  assert.throws(() => fixElf(fixture().subarray(0, 0x23001)), /truncated/);
});
