"""Shared helpers: quad8 mesh assembly, CalculiX run in podman, .frd reader."""

import os
import pathlib
import subprocess

import numpy as np

PODMAN = r"C:\Program Files\RedHat\Podman\podman.exe"
IMAGE = "ghcr.io/pcengineeringservices/calculix:2.21-r4"
SCRATCH = pathlib.Path.home() / "cae-scratch" / "politechnika-lab"
DATA = pathlib.Path(__file__).resolve().parent.parent / "data"


class Mesh:
    """Corner-node quads merged by coordinate; midside nodes added per edge."""

    def __init__(self, tol=1e-6):
        self.tol = tol
        self.key2id = {}
        self.xy = []
        self.quads = []  # corner node ids (0-based), counter-clockwise
        self.tags = []

    def node(self, x, y, sep=None):
        k = (round(x / self.tol), round(y / self.tol), sep)
        if k not in self.key2id:
            self.key2id[k] = len(self.xy)
            self.xy.append((x, y))
        return self.key2id[k]

    def grid(self, X, Y, tag=None, sep=None):
        """Structured block: X, Y arrays of shape (ni, nj) of corner coords.
        sep(x, y) -> True keeps that node from merging with other blocks."""
        ni, nj = X.shape
        ids = np.empty((ni, nj), int)
        for i in range(ni):
            for j in range(nj):
                ids[i, j] = self.node(X[i, j], Y[i, j], tag if sep and sep(X[i, j], Y[i, j]) else None)
        for i in range(ni - 1):
            for j in range(nj - 1):
                q = [ids[i, j], ids[i + 1, j], ids[i + 1, j + 1], ids[i, j + 1]]
                # enforce counter-clockwise ordering
                p = np.array([self.xy[n] for n in q])
                a = 0.5 * np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])
                if a < 0:
                    q = [q[0], q[3], q[2], q[1]]
                self.quads.append(q)
                self.tags.append(tag)
        return ids

    def quad8(self):
        """Return (coords, elems8) with midside nodes; elems use 1-based ids."""
        xy = list(self.xy)
        edge_mid = {}
        el8 = []
        for q in self.quads:
            mids = []
            for a in range(4):
                n1, n2 = q[a], q[(a + 1) % 4]
                k = (min(n1, n2), max(n1, n2))
                if k not in edge_mid:
                    edge_mid[k] = len(xy)
                    xy.append(tuple(0.5 * (np.array(self.xy[n1]) + np.array(self.xy[n2]))))
                mids.append(edge_mid[k])
            el8.append([n + 1 for n in q + mids])
        self.edge_mid = edge_mid
        return np.array(xy), el8

    def boundary_faces(self):
        """Faces (elem index, face number 1..4, n1, n2) used by one element only."""
        count = {}
        for e, q in enumerate(self.quads):
            for a in range(4):
                k = (min(q[a], q[(a + 1) % 4]), max(q[a], q[(a + 1) % 4]))
                count.setdefault(k, []).append((e, a + 1, q[a], q[(a + 1) % 4]))
        return [v[0] for v in count.values() if len(v) == 1]


def write_nodes_elems(f, xy, el8, etype):
    f.write("*NODE, NSET=NALL\n")
    for i, (x, y) in enumerate(xy, 1):
        f.write(f"{i}, {x:.6f}, {y:.6f}, 0.0\n")
    f.write(f"*ELEMENT, TYPE={etype}, ELSET=EALL\n")
    for i, e in enumerate(el8, 1):
        f.write(f"{i}, " + ", ".join(str(n) for n in e) + "\n")


def run_ccx(workdir, job, threads=4):
    workdir = pathlib.Path(workdir)
    cmd = [PODMAN, "run", "--rm", "--entrypoint", "sh",
           "-v", f"{workdir}:/w", IMAGE, "-c",
           f"mkdir -p /tmp/r && cp /w/{job}.inp /tmp/r/ && cd /tmp/r && "
           f"OMP_NUM_THREADS={threads} ccx -i {job} > ccx.log 2>&1; rc=$?; "
           f"cp {job}.frd {job}.dat {job}.sta ccx.log /w/ 2>/dev/null; exit $rc"]
    env = dict(os.environ, MSYS_NO_PATHCONV="1")
    r = subprocess.run(cmd, env=env)
    log = (workdir / "ccx.log").read_text(errors="replace")
    if r.returncode != 0 or "Job finished" not in log:
        raise RuntimeError(f"ccx failed in {workdir}:\n" + log[-3000:])
    return log


def read_frd(path):
    """Return dict(coords={id: xyz}, steps=[{time, DISP:{id:vals}, STRESS:{...}}])."""
    coords = {}
    steps = []
    cur = None
    block = None
    with open(path, errors="replace") as f:
        lines = f.readlines()
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("    2C"):
            i += 1
            while not lines[i].startswith(" -3"):
                s = lines[i]
                coords[int(s[3:13])] = [float(s[13 + 12 * k:25 + 12 * k]) for k in range(3)]
                i += 1
        elif ln.startswith("  100CL"):
            t = float(ln[12:24])
            name = lines[i + 1][5:13].strip()
            if cur is None or abs(cur["time"] - t) > 1e-12:
                cur = {"time": t}
                steps.append(cur)
            block = {}
            cur[name] = block
            i += 2
            while lines[i].startswith(" -5"):
                i += 1
            while not lines[i].startswith(" -3"):
                s = lines[i]
                if s.startswith(" -1"):
                    nid = int(s[3:13])
                    rest = s[13:].rstrip("\n")
                    vals = [float(rest[12 * k:12 * k + 12]) for k in range(len(rest) // 12)]
                    block[nid] = vals
                elif s.startswith(" -2"):
                    rest = s[13:].rstrip("\n")
                    block[nid] += [float(rest[12 * k:12 * k + 12]) for k in range(len(rest) // 12)]
                i += 1
        i += 1
    return {"coords": coords, "steps": steps}
