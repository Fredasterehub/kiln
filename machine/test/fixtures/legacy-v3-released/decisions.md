## ADR-1 — one config file, not three

The run pins a single config path so a torn write can never leave two sources
of truth disagreeing about the same knob.

## ADR-2 — the parser refuses, it never defaults

A defaulted value is indistinguishable from a value the operator chose.
