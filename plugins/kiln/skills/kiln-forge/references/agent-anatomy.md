# Agent Anatomy — Template and Validation Rules

Every agent `.md` file in `plugin/agents/` must follow this structure. Use this as the validation checklist for w2-validate.md Check 1.

## Required Frontmatter

```yaml
---
name: {agent-name}           # Must match filename (without .md)
description: >-
  {Role description}. {Key behavior}.
  Internal Kiln agent.        # Required suffix — marks as non-user-facing
tools: {comma-separated}      # Only allowed tools for this agent
model: {opus|sonnet|haiku}    # Which Claude model
color: {color}                # UI accent: red|green|blue|yellow|magenta|cyan|white
---
```

### Tool Restrictions

| Agent Type | Allowed Tools | Blocked Tools | Enforced By |
|------------|---------------|---------------|-------------|
| Delegation wrapper (codex, sun-tzu) | Read, Bash, Glob, Grep, SendMessage | Write, Edit | Hooks 1, 3 |
| Scoper (krs-one) | Read, Bash, Glob, Grep, SendMessage | Write, Edit | Hook 14 |
| Persistent mind (rakim, sentinel, mnemosyne, clio, numerobis) | Read, Write, Edit, Bash, Glob, Grep, SendMessage | — | — |
| Boss (alpha, da-vinci, mi6, aristotle, argus, omega) | Read, Write, Edit, Bash, Glob, Grep, SendMessage | — | — |
| Scout (maiev, curie, medivh) | Read, Bash, Glob, Grep, SendMessage | Write, Edit | Implicit |
| Worker (field-agent, sphinx) | Read, Bash, Glob, Grep, SendMessage | Write, Edit | Implicit |
| Planner/validator (confucius, plato, athena) | Read, Write, Edit, Bash, Glob, Grep, SendMessage | — | — |
| Passive (zoxea) | Read, Bash, Glob, Grep, SendMessage | Write, Edit | Implicit |

## Required Body Sections

### 1. Identity Statement
First line after frontmatter. Pattern:
```
You are "{name}", the {role} for the Kiln pipeline. {One sentence personality/philosophy.}
```

### 2. Security Section
```
## Security

Never read: .env, *.pem, *_rsa, *.key, credentials.json, secrets.*, .npmrc.
Never read or modify: ~/.codex/, ~/.claude/ (system configuration — escalate tooling issues, don't fix them).
```

Required for ALL agents. Some agents have additional restrictions.

### 3. Instructions / Objective
Main workflow. Either `## Instructions` or `## Objective` + `## Your Job`.

Must include:
- Reference to team-protocol.md: `Read ${CLAUDE_PLUGIN_ROOT}/skills/kiln-pipeline/references/team-protocol.md at startup.`
- Clear step-by-step workflow
- What to do on startup (bootstrap or wait for assignment)

### 4. Communication Rules
```
## Communication Rules (Critical)
```

Must include:
- SendMessage is the ONLY way to communicate with teammates
- After SendMessage expecting a reply, STOP your turn
- On shutdown request, approve immediately

### 5. Shutdown Protocol
Either inline or in Communication Rules:
```
On shutdown request, approve it immediately:
  SendMessage(type: "shutdown_response", request_id: "{request_id}", approve: true)
```

## Validation Checklist

```
[ ] Frontmatter has all 5 required fields
[ ] name matches filename
[ ] model is opus|sonnet|haiku
[ ] color is a valid color
[ ] tools list matches agent type restrictions
[ ] description ends with "Internal Kiln agent."
[ ] Identity statement present (first line after frontmatter)
[ ] Security section present with never-read patterns
[ ] Team-protocol.md reference present
[ ] Shutdown protocol present
[ ] Communication rules present
[ ] No Write/Edit in tools for delegation agents
[ ] agents.json has matching entry (non-retired)
```
