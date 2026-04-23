# _kiln-agents.sh — canonical Kiln agent roster for hook scripts.
#
# Sourced (not executed) by every hook that needs to distinguish Kiln
# pipeline agents from third-party subagents (Explore, statusline-setup,
# general-purpose, simplify-*, plugin-dev-*). Keeping this list out of
# _kiln-lib.sh lets the roster change without touching utility code.
#
# Source of truth: plugins/kiln/data/agents.json. This file is a flat
# shell mirror of those names — keep it in sync when the roster
# changes. Four call sites used to inline the same list; they now all
# route through _kiln_is_known_agent.

_kiln_is_known_agent() {
  # Returns 0 if $1 is a named Kiln pipeline agent (prefix already
  # stripped), 1 otherwise. No output. The case block uses the same
  # role names callers already compare against — runtime spawn names
  # ("krs-one", "plato") are NOT in this list; callers must pass the
  # agent_type / subagent_type field, which carries the role name.
  case "$1" in
    the-beginning-of-the-end|the-discovery-begins|the-anatomist|trust-the-science|follow-the-scent|\
    the-creator|the-foundation|\
    alpha-team-deploy|unit-deployed|\
    the-plan-maker|pitie-pas-les-crocos|mystical-inspiration|art-of-war|divergences-converge|e-pluribus-unum|straight-outta-olympia|gracefully-degrading|\
    bossman|dropping-science|algalon-the-observer|lore-keepah|dial-a-coder|backup-coder|la-peintresse|critical-thinker|the-curator|\
    team-red|team-blue|the-negotiator|i-am-the-law|\
    release-the-giant|le-plexus-exploseur|style-maker|\
    the-end-of-the-beginning)
      return 0 ;;
    *)
      return 1 ;;
  esac
}
