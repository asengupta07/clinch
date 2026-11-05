"""Figures from results/*.json."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

R = Path(__file__).resolve().parents[1] / "results"
b = json.loads((R / "baselines.json").read_text())["whale"]
fig, ax = plt.subplots(figsize=(7, 4.2))
style = {"clinch": ("Clinch (even split)", "#1f6feb", "-"), "clinch_adversarial": ("Clinch (best split found)", "#1f6feb", "--"),
         "uniform": ("Uniform price, no cap (CCA-like)", "#8b949e", "-"), "uniform_cap": ("Uniform price, per-wallet cap", "#d29922", "-"),
         "fixed_cap": ("Fixed price, per-wallet cap", "#cf222e", "-")}
for k, (lab, c, ls) in style.items():
    rows = b[k]
    ax.plot([r["N"] for r in rows], [r["util"] for r in rows], ls, color=c, marker="o", ms=4, label=lab)
ax.set_xscale("log"); ax.set_xlabel("wallets the whale splits into"); ax.set_ylabel("whale utility (value − paid)")
ax.set_title("Splitting pays under per-wallet caps, never under Clinch")
ax.legend(fontsize=8, frameon=False); ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout(); fig.savefig(R / "fig_whale_split.png", dpi=160)

s = json.loads((R / "sybil.json").read_text())
fig, ax = plt.subplots(figsize=(6, 4))
for mode, c in [("amm", "#1f6feb"), ("rebate", "#2da44e"), ("misrep", "#8250df"), ("cross", "#d29922"), ("naive", "#cf222e")]:
    pts = [(float(k.split("=")[1]), v["max_gain"]) for k, v in s.items() if k.startswith(mode + "@")]
    if pts:
        pts.sort(); ax.plot([p for p, _ in pts], [max(g, 1e-9) for _, g in pts], "-o", color=c, label=mode)
ax.plot([1e-3, 1e-2], [1e-3, 1e-2], ":", color="k", label="gain = ε")
ax.set_xscale("log"); ax.set_yscale("log"); ax.set_xlabel("ladder step ε"); ax.set_ylabel("max deviation gain / budget")
ax.set_title("Best deviation found (200 instances × 400 evals)"); ax.legend(fontsize=8, frameon=False)
ax.spines[["top", "right"]].set_visible(False); fig.tight_layout(); fig.savefig(R / "fig_sybil_gain.png", dpi=160)
print("ok")
