#!/bin/bash
# kb.sh — render transition banner + install spinner verbs
# Usage: kiln-banner.sh [conf_file]
# conf_file defaults to /tmp/kiln_banner.conf
# Format: line1=title, line2=quote, line3=source, line4=working_dir (opt), line5=spinner_json (opt)

CONF="${1:-/tmp/kiln_banner.conf}"
[[ -f "$CONF" ]] || { echo "No banner config found" >&2; exit 1; }

TITLE=$(sed -n '1p' "$CONF")
QUOTE_TEXT=$(sed -n '2p' "$CONF")
QUOTE_SOURCE=$(sed -n '3p' "$CONF")
WORKING_DIR=$(sed -n '4p' "$CONF")
SPINNER_JSON=$(sed -n '5p' "$CONF")

printf ' \033[38;5;173mKILN ►\033[0m %s\n \033[38;5;222m"%s"\033[0m \033[2m— %s\033[0m\n' \
  "$TITLE" "$QUOTE_TEXT" "$QUOTE_SOURCE"

if [[ -n "$WORKING_DIR" && -n "$SPINNER_JSON" ]]; then
  # SPINNER_JSON arrives as {"spinnerVerbs":["v1","v2",...]}
  # Claude Code expects {"spinnerVerbs":{"mode":"replace","verbs":[...]}}
  VERBS_ARRAY=$(echo "$SPINNER_JSON" | sed 's/{"spinnerVerbs":\(.*\)}/\1/')
  SETTINGS="{\"spinnerVerbs\":{\"mode\":\"replace\",\"verbs\":$VERBS_ARRAY}}"
  mkdir -p "$WORKING_DIR/.claude" && echo "$SETTINGS" > "$WORKING_DIR/.claude/settings.local.json"
fi
