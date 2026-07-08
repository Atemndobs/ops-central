# Routing Policy

## Provider Defaults

| Task Type | Preferred Provider |
|---|---|
| Deep reasoning / architecture | claude-code |
| Test-driven implementation | codex |
| IDE-native edits | cursor |
| Cheap/simple edits | opencode or openrouter |
| Boilerplate/docs | openrouter or local-model |
| Manual review | manual |

## Rules

- If tests must be run, prefer codex or claude-code.
- If the task is mostly reasoning, prefer claude-code.
- If the task is interactive editing inside the IDE, prefer cursor.
- If the task is cheap and low risk, prefer opencode/openrouter/local-model.
- If the task touches auth, security, payments, infrastructure, or migrations, require validation and human review.
