"""Ćw. 2 - axisymmetric CalculiX compression of a d0 = 20 mm cylinder (NLGEOM, J2 plasticity).

Half model (symmetry at mid-height). Two end conditions: full sticking friction
(top face ur = 0) and frictionless (lubricated). Cylinder shortened by 30 %.
Writes data/sciskanie.json: force-shortening curves and deformed shapes with PEEQ.
"""

import json
import math
import re
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from ccx_tools import DATA, SCRATCH, Mesh, read_frd, run_ccx, write_nodes_elems

D0 = 20.0
NINC = 30
SHORT = 0.3          # final relative shortening (beyond ~30 % the bulge folds onto the platen; no contact modelled)

# true stress [MPa] vs equivalent plastic strain; stal has a short yield plateau
EP = np.r_[0, 0.004, 0.008, 0.012, 0.016, np.geomspace(0.02, 2.0, 30)]
MATS = {
    "stal": dict(E=210000.0, nu=0.3,
                 curve=lambda e: np.where(e < 0.016, 260.0, 260.0 + 560.0 * np.maximum(e - 0.016, 0) ** 0.45)),
    "aluminium": dict(E=70000.0, nu=0.33, curve=lambda e: 110.0 + 260.0 * e ** 0.35),
    "miedz": dict(E=120000.0, nu=0.34, curve=lambda e: 70.0 + 430.0 * e ** 0.5),
}
FRICTION = {"przyleganie": True, "bez_tarcia": False}
HD = [1.0, 1.5, 2.0]


def build(h):
    m = Mesh()
    nr, nz = 10, int(round(10 * h / D0 * 2))
    R, Z = np.meshgrid(np.linspace(0, D0 / 2, nr + 1), np.linspace(0, h / 2, nz + 1), indexing="ij")
    m.grid(R, Z)
    return m


def run(mat, fric, hd):
    h = hd * D0
    m = build(h)
    xy, el8 = m.quad8()
    name = f"{mat}_{fric}_{hd:g}"
    wd = SCRATCH / "sciskanie" / name
    wd.mkdir(parents=True, exist_ok=True)
    top = [i + 1 for i, (x, y) in enumerate(xy) if abs(y - h / 2) < 1e-7]
    bot = [i + 1 for i, (x, y) in enumerate(xy) if abs(y) < 1e-7]
    axis = [i + 1 for i, (x, y) in enumerate(xy) if abs(x) < 1e-7]
    p = MATS[mat]
    with open(wd / "sc.inp", "w") as f:
        write_nodes_elems(f, xy, el8, "CAX8R")
        for nm, ns in (("TOP", top), ("BOT", bot), ("AXIS", axis)):
            f.write(f"*NSET, NSET={nm}\n" + "\n".join(map(str, ns)) + "\n")
        f.write(f"*MATERIAL, NAME=M\n*ELASTIC\n{p['E']}, {p['nu']}\n*PLASTIC\n")
        for e, s in zip(EP, p["curve"](EP)):
            f.write(f"{float(s):.4f}, {e:.6f}\n")
        f.write("*SOLID SECTION, ELSET=EALL, MATERIAL=M\n")
        f.write("*BOUNDARY\nBOT, 2, 2\nAXIS, 1, 1\n")
        if FRICTION[fric]:
            f.write("TOP, 1, 1\n")
        f.write(f"*TIME POINTS, NAME=TP, GENERATE\n{1.0 / NINC}, 1.0, {1.0 / NINC}\n")
        f.write(f"*STEP, NLGEOM, INC=5000\n*STATIC\n{0.5 / NINC}, 1.0, 1e-6, {1.0 / NINC}\n")
        f.write(f"*BOUNDARY\nTOP, 2, 2, {-SHORT * h / 2:.6f}\n")
        f.write("*NODE FILE, TIME POINTS=TP\nU\n*EL FILE, TIME POINTS=TP\nPEEQ\n"
                "*NODE PRINT, NSET=TOP, TOTALS=ONLY, TIME POINTS=TP\nRF\n*END STEP\n")
    run_ccx(wd, "sc", threads=2)
    # total reaction on TOP per increment
    dat = (wd / "sc.dat").read_text()
    F = [0.0]
    for blk in re.finditer(r"total force \(fx,fy,fz\) for set TOP and time\s+(\S+)\s*\n\s*(\S+)\s+(\S+)\s+(\S+)", dat):
        F.append(-float(blk.group(3)))
    frd = read_frd(wd / "sc.frd")
    frames = []
    for st in frd["steps"]:
        U, PE = st["DISP"], st.get("PE", {})
        u = [[round(U[i + 1][0], 3), round(U[i + 1][1], 3)] for i in range(len(m.xy))]
        pe = [round(PE.get(i + 1, [0])[0], 3) for i in range(len(m.xy))]
        frames.append({"t": st["time"], "u": u, "peeq": pe})
    return name, dict(mat=mat, fric=fric, hd=hd, h0=h, F=F, xy=[[round(x, 4), round(y, 4)] for x, y in m.xy],
                      quads=[[int(n) for n in q] for q in m.quads], frames=frames)


def main():
    jobs = [(m, f, hd) for m in MATS for f in FRICTION for hd in HD]
    with ThreadPoolExecutor(6) as ex:
        res = dict(ex.map(lambda a: run(*a), jobs))
    # axisymmetric reaction scaling check: frictionless = homogeneous upsetting, F = sigma(ep) * A0 h0/h
    r = res["stal_bez_tarcia_1.5"]
    k = len(r["F"]) - 1
    eps = math.log(1 / (1 - SHORT))
    A = math.pi * D0 ** 2 / 4 / (1 - SHORT)
    f_th = float(MATS["stal"]["curve"](np.array(eps))) * A
    print("frictionless check: F_fe =", r["F"][k], " F_theory =", round(f_th), " ratio", r["F"][k] / f_th)
    scale = 180.0   # CalculiX axisymmetric reactions are per 2 degree slice
    out = {"D0": D0, "short": SHORT, "ninc": NINC, "force_scale": scale,
           "curves": {m: {"E": p["E"], "ep": EP.tolist(), "s": [float(v) for v in p["curve"](EP)]} for m, p in MATS.items()},
           "runs": res}
    for v in res.values():
        v["F"] = [round(f * scale, 1) for f in v["F"]]
        print(f"{v['mat']:10s} {v['fric']:12s} h/d={v['hd']}: F(15%)={v["F"][NINC // 2]:.0f} N  F(30%)={v["F"][-1]:.0f} N  frames={len(v['frames'])}")
    DATA.mkdir(exist_ok=True)
    (DATA / "sciskanie.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
