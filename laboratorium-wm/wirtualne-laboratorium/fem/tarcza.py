"""Ćw. 16 - plane-stress CalculiX model of the 400 x 600 x 2 mm plate with a ø40 hole.

Quarter model (x = load direction, half-length 300; y = across, half-width 200),
uniform traction sigma0 = 1 MPa on x = 300. Writes data/tarcza.json (per 1 MPa).
"""

import json
import math

import numpy as np

from ccx_tools import DATA, SCRATCH, Mesh, read_frd, run_ccx, write_nodes_elems

E, NU = 200000.0, 0.3
R0, HX, HY, T = 20.0, 300.0, 200.0, 2.0
NA, NR = 80, 60   # elements around the quarter hole, radially


def build():
    """Hole-to-rectangle mapped mesh in two blocks split at the diagonal to (HY, HY)."""
    m = Mesh()
    s = np.linspace(0, 1, NR + 1)
    g = (np.exp(3.2 * s) - 1) / (np.exp(3.2) - 1)        # radial grading towards the hole
    # square HY x HY around the hole in two blocks (0..45 deg, 45..90 deg), then a strip HY..HX
    th1 = np.linspace(0, math.pi / 4, NA // 2 + 1)
    hole1 = np.c_[R0 * np.cos(th1), R0 * np.sin(th1)]
    out1 = np.c_[np.full_like(th1, HY), HY * np.tan(th1)]
    th2 = np.linspace(math.pi / 4, math.pi / 2, NA // 2 + 1)
    hole2 = np.c_[R0 * np.cos(th2), R0 * np.sin(th2)]
    out2 = np.c_[HY / np.tan(th2), np.full_like(th2, HY)]
    out2[-1, 0] = 0.0
    for hole, outer in ((hole1, out1), (hole2, out2)):
        X = hole[:, 0:1] + (outer[:, 0:1] - hole[:, 0:1]) * g[None, :]
        Y = hole[:, 1:2] + (outer[:, 1:2] - hole[:, 1:2]) * g[None, :]
        m.grid(X, Y, "sq")
    # strip x = HY..HX, y = 0..HY (continues block 1's outer edge)
    xs = HY + (HX - HY) * np.linspace(0, 1, 13) ** 1.3
    X, Y = np.meshgrid(xs, out1[:, 1], indexing="ij")
    m.grid(X, Y, "strip")
    return m


def main():
    m = build()
    xy, el8 = m.quad8()
    wd = SCRATCH / "tarcza"
    wd.mkdir(parents=True, exist_ok=True)
    symx = [i + 1 for i, (x, y) in enumerate(xy) if abs(y) < 1e-7]   # y = 0 plane: uy = 0
    symy = [i + 1 for i, (x, y) in enumerate(xy) if abs(x) < 1e-7]   # x = 0 plane: ux = 0
    load = []
    for e, face, n1, n2 in m.boundary_faces():
        if abs(m.xy[n1][0] - HX) < 1e-7 and abs(m.xy[n2][0] - HX) < 1e-7:
            load.append((e + 1, face))
    with open(wd / "tz.inp", "w") as f:
        write_nodes_elems(f, xy, el8, "CPS8")
        f.write("*NSET, NSET=SYMX\n" + "\n".join(map(str, symx)) + "\n")
        f.write("*NSET, NSET=SYMY\n" + "\n".join(map(str, symy)) + "\n")
        f.write("*BOUNDARY\nSYMX, 2, 2\nSYMY, 1, 1\n")
        f.write(f"*MATERIAL, NAME=STAL\n*ELASTIC\n{E}, {NU}\n*SOLID SECTION, ELSET=EALL, MATERIAL=STAL\n{T}\n")
        f.write("*STEP\n*STATIC\n*DLOAD\n")
        for e, face in load:
            f.write(f"{e}, P{face}, -1.0\n")       # negative pressure = tension
        f.write("*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")
    print(f"{len(xy)} nodes, {len(el8)} elements")
    run_ccx(wd, "tz")
    st = read_frd(wd / "tz.frd")["steps"][-1]
    U, S = st["DISP"], st["STRESS"]
    nodes = []
    for i, (x, y) in enumerate(m.xy):
        sx, sy, _, sxy = S[i + 1][:4]
        nodes.append([round(x, 3), round(y, 3), round(U[i + 1][0], 7), round(U[i + 1][1], 7),
                      round(sx, 4), round(sy, 4), round(sxy, 4)])
    out = {"E": E, "nu": NU, "r0": R0, "b": 2 * HY, "L": 2 * HX, "g": T, "sigma0": 1.0,
           "nodes": nodes, "quads": [[int(n) for n in q] for q in m.quads]}
    DATA.mkdir(exist_ok=True)
    (DATA / "tarcza.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    # checks against Kirsch: sigma_x at (0, r0) = 3, along y axis
    edge = max((n for n in nodes if abs(n[0]) < 1e-6), key=lambda n: -abs(n[1] - R0))
    print("sigma_x at hole edge (0, r0):", edge[4], " Kirsch 3.0;  Heywood finite width:",
          round((2 + (1 - R0 / HY) ** 3) / (1 - R0 / HY), 3), "(net)")
    far = min(nodes, key=lambda n: abs(n[0] - 150) + abs(n[1]))
    print("sigma_x at x=150 on axis:", far[4])


if __name__ == "__main__":
    main()
