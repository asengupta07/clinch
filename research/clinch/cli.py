"""FFI entry point for Foundry differential tests.

usage: python3 -I cli.py <kind> <S0> <x0> <y0> <p0> <M> <eps> <pmax> <limits,csv> <budgets,csv>
prints JSON with hex strings: {"qty": [...], "paid": [...], "X": .., "Y": .., "pF": .., "steps": ..}
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from clinch import wad  # noqa: E402


def main(argv):
    kind, S0, x0, y0, p0, M, eps, pmax = (int(a, 0) for a in argv[:8])
    lim = [int(a, 0) for a in argv[8].split(",") if a]
    bud = [int(a, 0) for a in argv[9].split(",") if a]
    q, pd, pF, st, X, Y = wad.settle(list(zip(lim, bud)), wad.Supply(kind, S0=S0, x0=x0, y0=y0, p0=p0, M=M), eps, pmax=pmax)
    h = lambda v: hex(v)
    print(json.dumps({"qty": [h(v) for v in q], "paid": [h(v) for v in pd], "X": h(X), "Y": h(Y), "pF": h(pF), "steps": h(st)}))


if __name__ == "__main__":
    main(sys.argv[1:])
