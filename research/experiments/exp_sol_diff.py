"""Reproduce test_diffInstance in Python WAD engine; compare with forge output."""
import re, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from clinch import wad
W = wad.W
n, depth = 20, 100
y0, p0 = 2_000_000 * W, 2 * W
per = y0 * depth // 10_000 // n
bids = [(p0 + p0 * ((i * 7919) % 1000 + 1) // 500, per * ((i * 104729) % 997 + 1) // 500) for i in range(n)]
q, pd, pF, st, X, Y = wad.settle(bids, wad.Supply(1, x0=1_000_000 * W, y0=y0, p0=p0), 10 ** 15)
out = subprocess.run(["forge", "test", "-vv", "--match-test", "test_diffInstance"], cwd=Path(__file__).resolve().parents[1] / "sol",
                     capture_output=True, text=True).stdout
sol = {k: int(v) for k, v in re.findall(r"DIFF (\w+) (\d+)", out)}
py = {"X": X, "Y": Y, "pF": pF, "steps": st}
print("python:", py); print("solidity:", sol); print("MATCH" if py == sol else "MISMATCH")
