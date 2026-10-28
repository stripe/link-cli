#!/bin/sh
# Inert stand-in for a repository-supplied @stripe/link-cli. It only records
# that it ran; the test fails if this file is ever written.
echo "$0" >> "$LINK_TEST_MARKER_DIR/repo-marker"
