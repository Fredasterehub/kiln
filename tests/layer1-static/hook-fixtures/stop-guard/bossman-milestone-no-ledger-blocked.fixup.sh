#!/bin/bash
# Remove iter-log to simulate "bossman signaled MILESTONE_COMPLETE before writing the ledger"
rm -f "$1/.kiln/docs/iter-log.md"
