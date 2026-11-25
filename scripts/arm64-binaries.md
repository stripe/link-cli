# Building Linux ARM64 standalone executables

Node 26.13.1's built-in SEA builder produces Linux ARM64 load mappings that can
fail on 16 or 64 KiB-page kernels. See [Node issue #67048](https://github.com/nodejs/node/issues/67048).

As a temporary workaround, Linux ARM64 uses Node's [documented external postject flow](https://github.com/nodejs/node/blob/v26.13.1/doc/api/single-executable-applications.md#dumping-the-preparation-blob-to-disk),
also used in [T3 Code's fix](https://github.com/pingdotgg/t3code/pull/25825):

1. Generate the SEA preparation blob from the bundled JavaScript.
2. Copy the same Node executable that produced the blob.
3. Embed the blob with the pinned `postject` build dependency.

CI and releases use Node 26.13.1 and postject 1.0.0-alpha.6. The other platforms
continue using the built-in SEA builder. Both Linux CI jobs run `--version` and
`--help`, record their kernel/page size, and upload the binaries and checksums.

Before uploading a Linux ARM64 binary, CI and releases run
`node scripts/check-arm64-sea.mjs sea-output`. This checks that ELF LOAD segments
have matching file/address offsets modulo 64 KiB and do not share a 64 KiB page,
including zero-filled `.bss`. These layout checks cover the 4, 16, and 64 KiB
page sizes; they do not prove that the executable runs on each kernel.
Run the guard's regression tests with `node --test scripts/check-arm64-sea.test.mjs`.

The standard `ubuntu-24.04-arm` runner uses 4 KiB pages. The separate
`arm64-large-page-smoke` CI matrix downloads that job's exact ARM64 binary and
checksum, then boots full-system QEMU guests with these distro kernels:

| Page size | Kernel source | Package |
| --- | --- | --- |
| 16 KiB | Debian trixie | `linux-image-arm64-16k` |
| 64 KiB | Ubuntu 24.04 | `linux-image-generic-64k` |

The guests use a minimal initramfs with the runner's ARM64 libraries and have no
network access. Each guest checks `uname -m`, the actual `getconf PAGESIZE`, and
the artifact checksum before executing the CLI. Both commands must exit zero,
the version must match the checkout, and help must contain `Usage: link-cli` so
an ordinary Node executable cannot pass. Timeouts and missing pass markers fail
the job. CI uploads the serial console and kernel provenance as
`arm64-16384-page-smoke-log` and `arm64-65536-page-smoke-log`.

These jobs exercise the affected kernel page sizes. Validation on native Muse
hardware remains pending; when a matching host is available, test the same artifact:

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

Remove the workaround when an official Node release fixes #67048. First run the
existing layout guard and both QEMU jobs against its built-in `--build-sea` output;
both 16 and 64 KiB kernels must pass before removing or simplifying the validation.
Search for `nodejs/node/issues/67048` to find the workflow branches and guard,
return Linux ARM64 to `--build-sea`, remove the guard and its test step, and remove
`postject` from `package.json` and the lockfile. Keep the binary smoke tests.
