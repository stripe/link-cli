// Work around Node/LIEF's 4 KiB alignment of injected ELF segments. Keep the
// runtime's code/data addresses and SEA bytes intact; relocate only the program
// header table and the read-only notes. See scripts/arm64-binaries.md.
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PAGE = 65536;
const LOAD = 1;
const NOTE = 4;
const PHDR = 6;
const NOTE_SECTION = 7;
const fields = ['offset', 'vaddr', 'paddr', 'filesz', 'memsz', 'align'];
const align = (value, boundary = PAGE) =>
  Math.ceil(value / boundary) * boundary;
const end = (segment) => segment.vaddr + segment.memsz;
const contains = (start, size, innerStart, innerSize) =>
  innerStart >= start && innerStart + innerSize <= start + size;

function requireLayout(condition, message) {
  if (!condition)
    throw new Error(`Unsupported ARM64 SEA ELF layout: ${message}`);
}

function u64(bytes, offset) {
  const value = Number(bytes.readBigUInt64LE(offset));
  requireLayout(Number.isSafeInteger(value), '64-bit value exceeds safe range');
  return value;
}

function put64(bytes, offset, value) {
  bytes.writeBigUInt64LE(BigInt(value), offset);
}

export function readElf(bytes) {
  requireLayout(
    bytes.length >= 64 &&
      bytes.subarray(0, 7).equals(Buffer.from([127, 69, 76, 70, 2, 1, 1])),
    'expected a little-endian ELF64 executable',
  );
  requireLayout(
    bytes.readUInt16LE(16) === 2 && bytes.readUInt16LE(18) === 183,
    'expected ET_EXEC/AArch64',
  );
  const phoff = u64(bytes, 32);
  const shoff = u64(bytes, 40);
  const phnum = bytes.readUInt16LE(56);
  const shnum = bytes.readUInt16LE(60);
  requireLayout(
    bytes.readUInt16LE(54) === 56 && phnum > 0 && phnum < 65535,
    'unexpected program header format',
  );
  requireLayout(
    contains(0, bytes.length, phoff, phnum * 56),
    'truncated program headers',
  );
  requireLayout(
    (shoff === 0 && shnum === 0) ||
      (shnum > 0 &&
        bytes.readUInt16LE(58) === 64 &&
        contains(0, bytes.length, shoff, shnum * 64)),
    'unexpected or truncated section headers',
  );
  const segments = Array.from({ length: phnum }, (_, index) => {
    const offset = phoff + index * 56;
    const segment = {
      type: bytes.readUInt32LE(offset),
      flags: bytes.readUInt32LE(offset + 4),
    };
    for (const [i, field] of fields.entries())
      segment[field] = u64(bytes, offset + 8 + i * 8);
    requireLayout(
      contains(0, bytes.length, segment.offset, segment.filesz),
      'segment outside file',
    );
    requireLayout(
      segment.memsz >= segment.filesz,
      'segment file size exceeds memory size',
    );
    return segment;
  });
  const sections = Array.from({ length: shnum }, (_, index) => {
    const headerOffset = shoff + index * 64;
    return {
      headerOffset,
      type: bytes.readUInt32LE(headerOffset + 4),
      flags: u64(bytes, headerOffset + 8),
      vaddr: u64(bytes, headerOffset + 16),
      offset: u64(bytes, headerOffset + 24),
      size: u64(bytes, headerOffset + 32),
    };
  });
  return {
    phoff,
    entry: u64(bytes, 24),
    tableSize: phnum * 56,
    segments,
    sections,
  };
}

function seaNote(bytes, elf) {
  const matches = [];
  for (const segment of elf.segments.filter((s) => s.type === NOTE)) {
    for (
      let offset = segment.offset;
      offset + 12 <= segment.offset + segment.filesz;
    ) {
      const namesz = bytes.readUInt32LE(offset);
      const descsz = bytes.readUInt32LE(offset + 4);
      const size = 12 + align(namesz, 4) + align(descsz, 4);
      requireLayout(
        contains(segment.offset, segment.filesz, offset, size),
        'truncated ELF note',
      );
      if (
        bytes.subarray(offset + 12, offset + 12 + namesz).toString() ===
        'NODE_SEA_BLOB\0'
      ) {
        matches.push(segment);
      }
      offset += size;
    }
  }
  requireLayout(
    matches.length === 1,
    'expected exactly one NODE_SEA_BLOB note',
  );
  return matches[0];
}

export function checkElf(bytes) {
  const elf = readElf(bytes);
  seaNote(bytes, elf);
  const loads = elf.segments.filter((s) => s.type === LOAD);
  for (const page of [4096, 16384, PAGE]) {
    let previousEnd = 0;
    for (const segment of loads) {
      requireLayout(
        segment.align >= page &&
          Number.isInteger(Math.log2(segment.align)) &&
          (segment.vaddr - segment.offset) % segment.align === 0,
        `PT_LOAD offset/address alignment is incompatible with ${page}-byte pages`,
      );
      requireLayout(
        Math.floor(segment.vaddr / page) * page >= previousEnd,
        `PT_LOAD mappings overlap on ${page}-byte pages`,
      );
      previousEnd = align(end(segment), page);
    }
  }
  requireLayout(
    loads.some((s) => s.flags & 1 && contains(s.vaddr, s.memsz, elf.entry, 1)),
    'entry point is not executable',
  );
  const phdrs = elf.segments.filter((s) => s.type === PHDR);
  requireLayout(phdrs.length === 1, 'expected exactly one PT_PHDR');
  const phdr = phdrs[0];
  requireLayout(
    phdr.offset === elf.phoff &&
      phdr.filesz === elf.tableSize &&
      phdr.memsz === elf.tableSize,
    'PT_PHDR does not describe the full program header table',
  );
  for (const segment of [
    phdr,
    ...elf.segments.filter((s) => s.type === NOTE),
  ]) {
    requireLayout(
      loads.some(
        (s) =>
          s.flags === 4 &&
          contains(s.offset, s.filesz, segment.offset, segment.filesz) &&
          segment.vaddr === s.vaddr + segment.offset - s.offset,
      ),
      'program headers or notes are not correctly mapped read-only',
    );
  }
  for (const section of elf.sections.filter(
    (s) => s.type === NOTE_SECTION && s.flags & 2,
  )) {
    requireLayout(
      loads.some(
        (s) =>
          contains(s.offset, s.filesz, section.offset, section.size) &&
          section.vaddr === s.vaddr + section.offset - s.offset,
      ),
      'allocated note section has an incorrect address',
    );
  }
  return elf;
}

export function fixElf(bytes) {
  const elf = readElf(bytes);
  const note = seaNote(bytes, elf);
  try {
    checkElf(bytes);
    return bytes;
  } catch {
    // The checks below restrict the repair to the two segments added by LIEF.
  }
  const loads = elf.segments.filter((s) => s.type === LOAD);
  const phdrs = elf.segments.filter((s) => s.type === PHDR);
  requireLayout(phdrs.length === 1, 'expected exactly one PT_PHDR');
  const phdr = phdrs[0];
  const tableLoad = loads.find(
    (s) => s.offset === elf.phoff && s.filesz >= elf.tableSize,
  );
  const noteLoad = loads.find((s) =>
    contains(s.offset, s.filesz, note.offset, note.filesz),
  );
  requireLayout(
    tableLoad &&
      noteLoad &&
      tableLoad !== noteLoad &&
      tableLoad.flags === 4 &&
      noteLoad.flags === 4 &&
      noteLoad.filesz === noteLoad.memsz &&
      phdr.offset === elf.phoff &&
      phdr.vaddr === tableLoad.vaddr &&
      note.vaddr === noteLoad.vaddr + note.offset - noteLoad.offset,
    'expected dedicated read-only program-header and note loads',
  );
  requireLayout(
    loads.at(-2) === tableLoad && loads.at(-1) === noteLoad,
    'injected loads must follow the original runtime loads',
  );
  const moved = [tableLoad, noteLoad, phdr, note];
  for (const s of elf.segments.filter(
    (s) => !moved.includes(s) && s.memsz > 0,
  )) {
    requireLayout(
      !contains(tableLoad.vaddr, tableLoad.memsz, s.vaddr, s.memsz) &&
        !contains(noteLoad.vaddr, noteLoad.memsz, s.vaddr, s.memsz),
      'other segments refer to injected loads',
    );
  }
  const noteSections = elf.sections.filter(
    (s) =>
      contains(noteLoad.offset, noteLoad.filesz, s.offset, s.size) &&
      s.size > 0,
  );
  requireLayout(
    noteSections.every((s) => s.type === NOTE_SECTION),
    'injected note load contains non-note sections',
  );
  requireLayout(
    !elf.sections.some(
      (s) =>
        s.flags & 2 &&
        s.size > 0 &&
        contains(tableLoad.vaddr, tableLoad.memsz, s.vaddr, s.size),
    ),
    'program-header load contains allocated sections',
  );

  const runtimeLoads = loads.slice(0, -2);
  requireLayout(runtimeLoads.length > 0, 'no runtime loads');
  const base = runtimeLoads[0].vaddr - runtimeLoads[0].offset;
  requireLayout(
    base >= 0 && base % PAGE === 0,
    'image base is not 64 KiB aligned',
  );
  const runtimeEnd = Math.max(...runtimeLoads.map(end));
  // Append, rather than insert: LIEF's old table can sit inside debug sections.
  // This preserves all existing file offsets and all runtime code/data bytes.
  const newOffset = align(Math.max(bytes.length, runtimeEnd - base));
  const newAddress = base + newOffset;
  const result = Buffer.alloc(newOffset + elf.tableSize);
  bytes.copy(result);
  const noteAddress =
    align(Math.max(noteLoad.vaddr, newAddress + elf.tableSize)) +
    (noteLoad.offset % PAGE);
  note.vaddr = noteAddress + note.offset - noteLoad.offset;
  note.paddr = note.vaddr;
  noteLoad.vaddr = noteAddress;
  noteLoad.paddr = noteAddress;
  noteLoad.align = PAGE;
  for (const section of noteSections) {
    put64(
      result,
      section.headerOffset + 16,
      noteAddress + section.offset - noteLoad.offset,
    );
  }
  for (const segment of [tableLoad, phdr]) {
    Object.assign(segment, {
      offset: newOffset,
      vaddr: newAddress,
      paddr: newAddress,
      filesz: elf.tableSize,
      memsz: elf.tableSize,
    });
  }
  tableLoad.align = PAGE;
  put64(result, 32, newOffset);
  for (const [index, segment] of elf.segments.entries()) {
    const offset = newOffset + index * 56;
    result.writeUInt32LE(segment.type, offset);
    result.writeUInt32LE(segment.flags, offset + 4);
    for (const [i, field] of fields.entries())
      put64(result, offset + 8 + i * 8, segment[field]);
  }
  checkElf(result);
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3)
    throw new Error(
      'Usage: node scripts/fix-sea-elf.mjs <ARM64 SEA executable>',
    );
  const original = readFileSync(file);
  const repaired = fixElf(original);
  if (repaired !== original) {
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, repaired, {
      flag: 'wx',
      mode: statSync(file).mode,
    });
    renameSync(temporary, file);
  }
  console.log(
    'ARM64 SEA ELF layout validated for 4, 16, and 64 KiB pages (native execution still required).',
  );
}
