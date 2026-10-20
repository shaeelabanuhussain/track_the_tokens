"""
Per-step token, latency and cost tracer for any Anthropic-SDK workflow.

Wrap each step of a pipeline, run it, and get a table that attributes spend to
the step that causes it (the "Diagnose" phase of Track the Tokens).

    from step_tracer import Tracer
    tracer = Tracer()
    with tracer.step("classify"):
        resp = client.messages.create(...)
        tracer.record(resp)
    tracer.report()            # prints the table, writes trace.jsonl

No dependencies beyond the anthropic SDK you already use.
"""
import json
import time
from contextlib import contextmanager

# USD per million tokens (input, output, cache-read multiplier).
PRICES = {
    "claude-opus-5-5": (4, 20, 0.05),
    "claude-opus-4-5": (5, 25, 0.1),
    "claude-sonnet-5-5": (2, 10, 0.05),
    "claude-sonnet-4": (3, 15, 0.1),
    "claude-haiku-5-5": (0.10, 0.50, 0.1),
    "claude-haiku-4-5": (1, 5, 0.1),
}


def price(model):
    best = max((k for k in PRICES if model.startswith(k)), key=len, default="claude-sonnet-4")
    return PRICES[best]


class Tracer:
    def __init__(self, path="trace.jsonl"):
        self.path = path
        self.rows = []
        self._step = None
        self._t0 = None

    @contextmanager
    def step(self, name):
        self._step, self._t0 = name, time.perf_counter()
        try:
            yield
        finally:
            self._step = None

    def record(self, resp):
        u = resp.usage
        inp, out, mult = price(resp.model)
        cw = getattr(u, "cache_creation_input_tokens", 0) or 0
        cr = getattr(u, "cache_read_input_tokens", 0) or 0
        cost = (u.input_tokens * inp + cw * inp * 1.25 + cr * inp * mult + u.output_tokens * out) / 1e6
        row = {
            "step": self._step or "unnamed",
            "model": resp.model,
            "input_tokens": u.input_tokens,
            "cache_write_tokens": cw,
            "cache_read_tokens": cr,
            "output_tokens": u.output_tokens,
            "latency_s": round(time.perf_counter() - (self._t0 or time.perf_counter()), 3),
            "cost_usd": round(cost, 6),
        }
        self.rows.append(row)
        with open(self.path, "a") as f:
            f.write(json.dumps(row) + "\n")
        return row

    def report(self):
        by = {}
        for r in self.rows:
            b = by.setdefault(r["step"], {"calls": 0, "in": 0, "cached": 0, "out": 0, "s": 0.0, "usd": 0.0})
            b["calls"] += 1
            b["in"] += r["input_tokens"] + r["cache_write_tokens"]
            b["cached"] += r["cache_read_tokens"]
            b["out"] += r["output_tokens"]
            b["s"] += r["latency_s"]
            b["usd"] += r["cost_usd"]
        total = sum(b["usd"] for b in by.values()) or 1
        print(f"{'step':<22}{'calls':>6}{'input':>10}{'cached':>10}{'output':>9}{'secs':>8}{'cost':>10}{'share':>7}")
        for name, b in sorted(by.items(), key=lambda x: -x[1]["usd"]):
            print(f"{name:<22}{b['calls']:>6}{b['in']:>10}{b['cached']:>10}{b['out']:>9}{b['s']:>8.1f}{b['usd']:>10.4f}{b['usd'] / total:>7.0%}")
        print(f"{'TOTAL':<22}{'':>43}{sum(b['s'] for b in by.values()):>8.1f}{total:>10.4f}")
