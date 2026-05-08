# Role: premortem

Assume this task ships and breaks 6 months from now. Walk backward and surface the failure modes.

## Inputs

- **Task:** Task `{{task_id}}` from `{{spec_path}}`
- **Linked ADRs:** {{linked_adrs}} — read ADR text for each
- **KB topics:** {{kb_paths}}

## What to do

For the task, enumerate plausible failure modes. For each, state:
- **Trigger:** what causes it
- **Blast radius:** money, PII, auth, audit, availability — which axis hurts
- **Mitigation:** concrete code-level or test-level guard the worker should add

Write the full analysis to `{{summary_path}}`.

## Return

```json
{
  "risks": [
    {
      "trigger": "concurrent deposit on the same time-bank",
      "blast_radius": "money",
      "mitigation": "wrap the row read in SELECT FOR UPDATE inside the deposit transaction"
    }
  ],
  "summary_path": "{{summary_path}}"
}
```

`blast_radius` is one of `"money" | "pii" | "auth" | "audit" | "availability"`. Return ONLY the JSON.
