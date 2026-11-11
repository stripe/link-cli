"""Scratch, pinned-layout repair: put notes and PHDR in one read-only load."""
from collections import namedtuple
from pathlib import Path
import struct
import sys

PAGE = 65536
EH, PH, SH = struct.Struct('<16sHHIQQQIHHHHHH'), struct.Struct('<II6Q'), struct.Struct('<II4QII2Q')
Elf = namedtuple('Elf', 'ident kind machine version entry phoff shoff flags ehsize phsize phnum shsize shnum shstr')
Segment = namedtuple('Segment', 'kind flags offset address physical filesz memsz alignment')
Section = namedtuple('Section', 'name kind flags address offset size link info alignment entsize')
round_up = lambda n, size: (n + size - 1) // size * size

def one(items):
    assert len(items) == 1, 'Unexpected pinned Node/LIEF layout'
    return items[0]

def repair(original):
    elf = Elf(*EH.unpack_from(original))
    assert elf.ident[:7] == b'\x7fELF\x02\x01\x01' and (elf.kind, elf.machine) == (2, 183)
    assert (elf.phsize, elf.shsize) == (PH.size, SH.size)
    segments = [Segment(*PH.unpack_from(original, elf.phoff + i * PH.size)) for i in range(elf.phnum)]
    loads = [i for i, p in enumerate(segments) if p.kind == 1]
    phdr_i = one([i for i, p in enumerate(segments) if p.kind == 6])
    note_i = one([i for i, p in enumerate(segments) if p.kind == 4])
    table_i, blob_i = loads[-2:]
    table, blob, note = segments[table_i], segments[blob_i], segments[note_i]
    assert table.offset == elf.phoff and table.filesz >= elf.phnum * PH.size
    assert table.flags == blob.flags == 4 and blob.filesz == blob.memsz
    assert note.offset == blob.offset and note.address == blob.address and note.filesz <= blob.filesz
    assert b'NODE_SEA_BLOB\0' in original[note.offset:note.offset + note.filesz]
    base = segments[loads[0]].address - segments[loads[0]].offset
    assert base % PAGE == 0
    runtime_end = max(segments[i].address + segments[i].memsz for i in loads[:-2])
    blob_address = base + blob.offset
    assert blob_address // PAGE * PAGE >= round_up(runtime_end, PAGE)
    new_offset = round_up(len(original), 8)
    table_size = elf.phnum * PH.size
    new_size = new_offset + table_size - blob.offset
    segments[table_i] = Segment(0, 0, 0, 0, 0, 0, 0, 0)
    segments[blob_i] = blob._replace(address=blob_address, physical=blob_address,
        filesz=new_size, memsz=new_size, alignment=PAGE)
    segments[note_i] = note._replace(address=blob_address, physical=blob_address)
    segments[phdr_i] = segments[phdr_i]._replace(offset=new_offset, address=base + new_offset,
        physical=base + new_offset, filesz=table_size, memsz=table_size)
    result = bytearray(original)
    result.extend(bytes(new_offset + table_size - len(result)))
    EH.pack_into(result, 0, *elf._replace(phoff=new_offset))
    for i, p in enumerate(segments):
        PH.pack_into(result, new_offset + i * PH.size, *p)
    for i in range(elf.shnum):
        at = elf.shoff + i * SH.size
        s = Section(*SH.unpack_from(original, at))
        if s.kind == 7 and blob.offset <= s.offset and s.offset + s.size <= blob.offset + blob.filesz:
            SH.pack_into(result, at, *s._replace(address=base + s.offset))
    previous_end = 0
    for p in segments:
        if p.kind != 1:
            continue
        assert (p.address - p.offset) % PAGE == 0
        assert p.address // PAGE * PAGE >= previous_end
        previous_end = round_up(p.address + p.memsz, PAGE)
    return result

if __name__ == '__main__':
    source, destination = map(Path, sys.argv[1:])
    destination.write_bytes(repair(source.read_bytes()))
