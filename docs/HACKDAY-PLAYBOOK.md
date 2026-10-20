# Hack Day playbook: fix a deliberately inefficient AI workflow

On the day, teams get an inefficient AI workflow and must **prove the savings**. TokenLens covers Claude Code itself. This playbook covers *any* LLM pipeline, in the same Observe → Diagnose → Optimize order.

## 0. Baseline first (15 min)

You cannot prove a saving without a baseline. Run the workflow unchanged on a fixed input set (10-20 representative cases) and record **cost, tokens, latency and output quality** per case. Save the outputs: they are your quality reference.

## 1. Observe: trace every call

- Quickest: [`hackday/step_tracer.py`](../hackday/step_tracer.py). Wrap each step in `with tracer.step("name"):` and call `tracer.record(resp)`; it writes `trace.jsonl` and prints a per-step table.
- If the team agreed on LangSmith or Langfuse, use it, but the attribution table is what you need.
- Use OpenTelemetry GenAI attribute names (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`) so traces work in any backend. `tokenlens export --format otel` uses the same names.

## 2. Diagnose: attribute spend to the step

Sort steps by cost share and look for these patterns (they are the usual "deliberate inefficiencies"):

| Symptom in the trace | Root cause | Fix |
|---|---|---|
| Same large system prompt / documents on every call, `cache_read_tokens = 0` | No prompt caching | Add `cache_control` (below) |
| Simple steps (classify, extract, route, format) on the top model | Over-sized model | Route to Haiku / Sonnet |
| Input tokens grow call after call | Full history or full documents resent | Trim history, summarize, retrieve only relevant chunks |
| Raw PDFs / HTML / JSON blobs in the prompt | Unconverted input | Convert to Markdown/plain text, strip boilerplate, select fields |
| Many sequential calls for independent items | No batching | Batch API (50% off) or one call with a list |
| Identical requests repeated | No response cache | Exact-match or semantic cache |
| Long outputs nobody reads | No output limit | `max_tokens`, structured output, "answer in ≤3 bullets" |
| Retries / failures | Fragile parsing | Structured outputs / tool schemas instead of regex on prose |

## 3. Optimize: the levers, in order of payoff

### Prompt caching (largest win for repeated context)

```python
resp = client.messages.create(
    model="claude-sonnet-5-5",
    max_tokens=1024,
    system=[{
        "type": "text",
        "text": LONG_INSTRUCTIONS_AND_DOCS,      # stable prefix
        "cache_control": {"type": "ephemeral"},   # 5-minute TTL; {"type": "ephemeral", "ttl": "1h"} for 1 hour
    }],
    messages=[{"role": "user", "content": question}],  # variable part last
)
```

Reads cost 5-10% of input price; writes cost 125% (5 min) or 200% (1 h). Keep the cached prefix byte-identical: no timestamps or IDs in it.

### Model routing (right-size each step)

```python
ROUTES = {"classify": "claude-haiku-5-5", "extract": "claude-haiku-5-5",
          "draft": "claude-sonnet-5-5", "hard_reasoning": "claude-opus-5-5"}
```

Validate on your baseline set that quality holds per step before switching.

### Trim the input

- Send only the relevant chunks (retrieval) instead of whole documents.
- Convert PDFs to Markdown (`tokenlens pdf2md file.pdf`): 60-90% fewer tokens.
- Keep a rolling summary instead of the full conversation history.

### Batch and cache responses

- Message Batches API for non-urgent bulk work: 50% off.
- An exact-match response cache (hash of model + prompt) for repeated questions; a semantic cache if near-duplicates are common.

### Cap the output

`max_tokens`, a structured output schema, and an explicit length instruction.

## 4. Prove it

Re-run the same input set and show a before/after table:

| Metric | Before | After | Change |
|---|---|---|---|
| Cost per run | | | |
| Input tokens | | | |
| Cache hit rate | | | |
| p50 latency | | | |
| Quality (same/better on N of M cases) | | | |

Attribute each saving to the lever that produced it (change one lever at a time if time allows). Report estimates as estimates.

## FinOps framing for the judges

- **Inform** (Observe): everyone sees cost per session/step: TokenLens statusline, dashboard, trace table.
- **Optimize** (Diagnose + Optimize): ranked, dollar-priced fixes.
- **Operate**: budgets, alerts, and a FOCUS-format export (`tokenlens export --format focus`) that drops into the same cost tools as cloud bills.
