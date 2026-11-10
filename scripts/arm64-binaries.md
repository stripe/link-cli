# Building and validating Linux ARM64 standalone executables

Node's SEA builder embeds the JavaScript bundle in an ELF note using LIEF. In
Node 26.13.0, LIEF gives the new note load and relocated program-header table
4 KiB alignment. The resulting binary can fail before JavaScript starts on
ARM64 kernels with 16 or 64 KiB pages.

`scripts/fix-sea-elf.mjs` runs after SEA construction and before smoke tests,
checksums, or uploads. It appends a program-header table at a 64 KiB boundary,
keeps its mapping separate from writable data, and adjusts the read-only note
mapping so its address and file offset agree modulo 64 KiB. The original
runtime addresses, file offsets, code/data, and SEA payload bytes stay intact.
The script rejects unexpected layouts and validates all load mappings for
4, 16, and 64 KiB pages. It also corrects the PT_PHDR size and note-section
addresses. Reapplying it to a corrected binary makes no changes.

Upstream implementation:

- [Node's ELF injection](https://github.com/nodejs/node/blob/v26.13.0/src/node_sea_bin.cc)
- [LIEF's program-header relocation](https://github.com/nodejs/node/blob/v26.13.0/deps/LIEF/src/ELF/Binary.cpp)

## Native validation

Static layout checks and a smoke test on a 4 KiB-page ARM64 runner do **not**
establish that the binary runs on a 64 KiB-page kernel. Before publishing a
corrected build for Muse, run the actual artifact on a native ARM64 Linux host
with 64 KiB pages. From the directory containing the binary and its checksum:

```sh
set -eu
uname -a
test "$(uname -m)" = aarch64
test "$(getconf PAGESIZE)" = 65536
sha256sum -c link-cli-linux-arm64.sha256
chmod +x link-cli-linux-arm64
./link-cli-linux-arm64 --version
./link-cli-linux-arm64 --help
```

Record the artifact SHA-256, kernel version, page size, command output, and exit
statuses. Test the same artifact on a normal 4 KiB-page ARM64 host too. Running
through user-mode QEMU on a 4 KiB host does not substitute for the 64 KiB kernel
test.
