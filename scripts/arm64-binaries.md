# Building Linux ARM64 standalone executables

Node 26.13.0's built-in SEA builder produces Linux ARM64 load mappings that can
fail on 16 or 64 KiB-page kernels. See [Node issue #67048](https://github.com/nodejs/node/issues/67048).

Linux ARM64 uses Node's [documented external postject flow](https://github.com/nodejs/node/blob/v26.13.0/doc/api/single-executable-applications.md#dumping-the-preparation-blob-to-disk):

1. Generate the SEA preparation blob from the bundled JavaScript.
2. Copy the same Node executable that produced the blob.
3. Embed the blob with the pinned `postject` build dependency.

CI and releases use Node 26.13.0 and postject 1.0.0-alpha.6. The other platforms
continue using the built-in SEA builder. Both Linux CI jobs run `--version` and
`--help`, record their kernel/page size, and upload the binaries and checksums.

The standard `ubuntu-24.04-arm` runner uses 4 KiB pages. A matching native
64 KiB ARM64 runner is still required to validate the Muse environment before
publishing. On that runner, test the actual artifact:

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
