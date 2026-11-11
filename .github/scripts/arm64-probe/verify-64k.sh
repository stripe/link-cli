#!/usr/bin/env bash
# Run on a 4 KiB-page ARM64 Ubuntu host with Docker and qemu-system-aarch64.
# Input directory: stock-node, original (unmodified CLI 1.4.1), candidate-*.
# This boots a real ARM64 Linux kernel using TCG CPU emulation, not qemu-user.
set -euo pipefail
artifacts=$(realpath "$1")
mkdir -p "$2"
evidence=$(realpath "$2")
work=$(mktemp -d)
container="link-cli-kernel-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
cd "$work"
mkdir -p payload/{bin,etc,root,cases,proc,sys,dev,tmp} kernel
test "$(uname -m)" = aarch64
test "$(getconf PAGESIZE)" = 4096
uname -a | tee "$evidence/host.txt"
getconf PAGESIZE | tee -a "$evidence/host.txt"
qemu-system-aarch64 --version | tee -a "$evidence/host.txt"
printf '%s\n' 'Execution mode: full-system QEMU TCG (emulated CPU)' >> "$evidence/host.txt"

cp "$artifacts/stock-node" payload/stock-node
cp "$artifacts/original" payload/cases/original
for binary in "$artifacts"/candidate-*; do
  test -f "$binary"
  cp "$binary" payload/cases/
done
chmod +x payload/stock-node payload/cases/*
ulimit -c 0
payload/stock-node --version | tee payload/stock-version
payload/cases/original --version | tee "$evidence/original-host-version.txt"
grep -Fx '1.4.1' "$evidence/original-host-version.txt"
for binary in payload/cases/*; do
  readelf -h -l -W "$binary" > "$evidence/$(basename "$binary").readelf.txt"
done
(cd payload && sha256sum stock-node cases/*) > payload/SHA256SUMS
cp payload/SHA256SUMS "$evidence/"

# A distribution-supplied kernel avoids compiling Linux or constructing a VM disk.
kernel_image=${KERNEL_IMAGE:-ubuntu:24.04}
kernel_package=${KERNEL_PACKAGE:-linux-image-generic-64k}
docker pull "$kernel_image"
docker image inspect "$kernel_image" > "$evidence/kernel-image.json"
docker run --name "$container" -e DEBIAN_FRONTEND=noninteractive "$kernel_image" \
  sh -euxc 'apt-get update; apt-get install -y --no-install-recommends "$1"; dpkg-query -W' \
  sh "$kernel_package" 2>&1 | tee "$evidence/kernel-packages.txt"
docker cp "$container":/boot/. kernel/
kernel_path=$(find kernel -maxdepth 1 -name 'vmlinuz-*-generic-64k' -print -quit)
test -n "$kernel_path"
cp "$kernel_path" vmlinuz
cp "${kernel_path/vmlinuz-/config-}" "$evidence/kernel-config.txt"
grep -Fx 'CONFIG_ARM64_64K_PAGES=y' "$evidence/kernel-config.txt"
sha256sum vmlinuz > "$evidence/kernel-sha256.txt"

cp /bin/busybox payload/bin/busybox
for applet in sh mount uname cat poweroff sync timeout grep sha256sum; do
  ln -s busybox "payload/bin/$applet"
done
cp /usr/bin/getconf payload/bin/
printf '%s\n' 'root:x:0:0:root:/root:/bin/sh' > payload/etc/passwd
printf '%s\n' 'root:x:0:' > payload/etc/group
for binary in payload/stock-node payload/cases/* /usr/bin/getconf; do
  ldd "$binary" | tee -a "$evidence/shared-libraries.txt"
  while read -r library; do
    cp --parents -L "$library" payload/
  done < <(ldd "$binary" | awk '/=> \// {print $3} /^[[:space:]]*\// {print $1}')
done
printf '%s\n' "${EXPECTED_CLI_VERSION:-1.4.1}" > payload/expected-version
cat > payload/init <<'GUEST'
#!/bin/sh
export PATH=/bin
export NO_COLOR=1
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
ulimit -c 0
cd /
ok=1
echo CLI_64K_GUEST_BEGIN
uname -a
page=$(getconf PAGESIZE)
echo "PAGE_SIZE=$page ACCEL=tcg"
[ "$page" = 65536 ] || ok=0
sha256sum -c SHA256SUMS || ok=0
timeout 90 /stock-node --version > /tmp/stock.txt 2>&1
stock_rc=$?
cat /tmp/stock.txt
[ "$stock_rc" = 0 ] && grep -Fx "$(cat /stock-version)" /tmp/stock.txt || ok=0
echo "STOCK_NODE_EXIT=$stock_rc"
for binary in /cases/*; do
  name=${binary##*/}
  timeout 90 "$binary" --version > /tmp/version.txt 2>&1
  version_rc=$?
  timeout 90 "$binary" --help > /tmp/help.txt 2>&1
  help_rc=$?
  echo "RESULT name=$name page=$page version_exit=$version_rc help_exit=$help_rc"
  cat /tmp/version.txt /tmp/help.txt
  if [ "$name" = original ]; then
    case "$version_rc:$help_rc" in
      126:126|126:139|139:126|139:139) : ;;
      *) ok=0 ;;
    esac
  else
    [ "$version_rc" = 0 ] && [ "$help_rc" = 0 ] || ok=0
    grep -Fx "$(cat /expected-version)" /tmp/version.txt || ok=0
    grep -q '^Usage: link-cli' /tmp/help.txt || ok=0
  fi
done
if [ "$ok" = 1 ]; then echo CLI_64K_PASS; else echo CLI_64K_FAIL; fi
sync
poweroff -f
GUEST
chmod +x payload/init
(cd payload && find . -print0 | cpio --null -o --format=newc --owner=0:0 | gzip -1) > initramfs.cpio.gz
timeout 900 qemu-system-aarch64 \
  -machine virt -cpu max -accel tcg -smp 2 -m 4096 \
  -nographic -no-reboot -nic none \
  -kernel vmlinuz -initrd initramfs.cpio.gz \
  -append 'console=ttyAMA0 rdinit=/init panic=-1' \
  2>&1 | tee "$evidence/guest-console.txt"
grep -q '^CLI_64K_PASS' "$evidence/guest-console.txt"
