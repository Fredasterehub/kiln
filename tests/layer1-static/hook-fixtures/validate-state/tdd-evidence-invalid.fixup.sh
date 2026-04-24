#!/bin/bash
set -e
mkdir -p "$1/.kiln/archive/milestone-1/chunk-2"
printf 'testable: yes\nassignment_id: assign-1\n' > "$1/.kiln/archive/milestone-1/chunk-2/tdd-evidence.md"
