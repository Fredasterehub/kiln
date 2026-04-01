#!/bin/bash
for f in plugins/kiln/agents/*.md; do
  TOOLS=$(awk '/^tools:/ {print $0}' "$f" | sed 's/tools: \[//; s/\]//; s/ //g')
  
  # Check for typical tool usage signatures in the text
  HAS_BASH=$(grep -qiE '```bash|Bash tool|invoke bash' "$f" && echo "true" || echo "false")
  HAS_WRITE=$(grep -qiE 'Write tool|write `|write to `|cat <<' "$f" && echo "true" || echo "false")
  HAS_READ=$(grep -qiE 'Read tool|Read `|Read |read ' "$f" && echo "true" || echo "false")
  HAS_SEND=$(grep -qiE 'SendMessage|Send a message' "$f" && echo "true" || echo "false")
  
  MISSING=""
  
  if [[ "$HAS_BASH" == "true" && "$TOOLS" != *"Bash"* ]]; then
    MISSING="$MISSING Bash"
  fi
  if [[ "$HAS_WRITE" == "true" && "$TOOLS" != *"Write"* && "$TOOLS" != *"Edit"* ]]; then
    MISSING="$MISSING Write"
  fi
  if [[ "$HAS_SEND" == "true" && "$TOOLS" != *"SendMessage"* ]]; then
    MISSING="$MISSING SendMessage"
  fi
  
  if [[ -n "$MISSING" ]]; then
    echo "Agent $(basename $f) may be missing tools:$MISSING (Granted: $TOOLS)"
  fi
done
