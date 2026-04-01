---
name: kiln-update
description: Check for and install Kiln plugin updates.
argument-hint: [no arguments needed]
allowed-tools: Read, Bash, Glob, Grep
---

# /kiln-update

Check for and install Kiln plugin updates.

1. **Check for updates**:
   ```bash
   claude plugin update kiln --dry-run
   ```

2. **Run update**:
   ```bash
   claude plugin update kiln
   ```

3. **Verify**:
   After update, run `/kiln-doctor` to ensure everything is still correct.

4. **Self-Update Notice**:
   If the update changes the plugin structure significantly, you may need to restart Claude Code.
