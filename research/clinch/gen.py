"""Random instance generators shared by experiments."""
from __future__ import annotations

import random
from dataclasses import dataclass

from .engine import CPPool


@dataclass
class Instance:
    pool: CPPool
    sellY: list  # [(v, q)]
    sellX: list  # [(u, r)]


def rand_pool(rng: random.Random) -> CPPool:
    x0 = 10 ** rng.uniform(2, 4)
    p0 = 10 ** rng.uniform(-1, 1)
    return CPPool(x0, x0 * p0)


def rand_sellY(rng, p0, n, budget_scale):
    out = []
    for _ in range(n):
        v = p0 * (1 + 10 ** rng.uniform(-3, 0.3))        # eligible values above spot, up to ~3x
        if rng.random() < 0.1:
            v = p0 * rng.uniform(0.5, 1.0)                # some ineligible
        q = budget_scale * 10 ** rng.uniform(-1.5, 0.5)
        out.append((v, q))
    return out


def rand_sellX(rng, p0, n, budget_scale_x):
    out = []
    for _ in range(n):
        u = p0 / (1 + 10 ** rng.uniform(-3, 0.3))
        if rng.random() < 0.1:
            u = p0 * rng.uniform(1.0, 2.0)
        r = budget_scale_x * 10 ** rng.uniform(-1.5, 0.5)
        out.append((u, r))
    return out


def rand_instance(rng: random.Random, nY=6, nX=0, depth=0.05) -> Instance:
    """depth = typical single budget as a fraction of the pool's Y reserve."""
    pool = rand_pool(rng)
    sy = rand_sellY(rng, pool.p0, nY, depth * pool.y0)
    sx = rand_sellX(rng, pool.p0, nX, depth * pool.x0)
    return Instance(pool, sy, sx)
