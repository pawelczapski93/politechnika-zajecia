"""Ćw. 14 - axisymmetric CalculiX model of the pressure vessel (Rys. 14.1), p = 1 MPa.

Flat bottom (a=170, h=15, ø370) bonded to the welded ring flange over r = 170..185
(bolted joint idealised as tied), cylinder ø400 x 5.3, torispherical head R450/r45 x 5.4.
x = r (radial), y = z (axial). Writes data/zbiornik.json (results per 1 MPa).
"""

import json
import math

import numpy as np

from ccx_tools import DATA, SCRATCH, Mesh, read_frd, run_ccx, write_nodes_elems

E, NU = 210000.0, 0.3
RO, TC = 200.0, 5.3          # cylinder outer radius, wall
RI = RO - TC
TH = 5.4                      # head wall
RC, RK = 450.0, 45.0          # crown / knuckle inner radii
ZT = 945.0                    # head tangent line
A_PL, H_PL, R_PL = 170.0, 15.0, 185.0
Z_RING = (15.0, 40.0)
NT = 4                        # elements through shell thickness


def lin(a, b, h):
    n = max(1, int(round((b - a) / h)))
    return np.linspace(a, b, n + 1)


def build(r_bond):
    m = Mesh()
    # flat bottom plate r 0..185, z 0..15
    r_pl = np.concatenate([lin(0, A_PL, 2.5)[:-1], lin(A_PL, R_PL, 1.25)])
    z_pl = lin(0, H_PL, 1.25)
    R, Z = np.meshgrid(r_pl, z_pl, indexing="ij")
    m.grid(R, Z, "plate", sep=lambda x, y: abs(y - H_PL) < 1e-9 and x < r_bond - 1e-9)
    # ring flange r 170..194.7, z 15..40
    r_rg = np.concatenate([lin(A_PL, R_PL, 1.25)[:-1], lin(R_PL, RI, 1.25)])
    z_rg = lin(*Z_RING, 1.25)
    R, Z = np.meshgrid(r_rg, z_rg, indexing="ij")
    m.grid(R, Z, "ring")

    # shell meridian: inner points + outward normals + thickness
    pts, nrm, thk, kind = [], [], [], []
    zc = np.concatenate([lin(0, 60, 1.25)[:-1], lin(60, ZT, 4.0)[:-1]])
    for z in zc:
        pts.append((RI, z)); nrm.append((1, 0)); thk.append(TC); kind.append("cyl")
    rk_c = RI - RK
    phi = math.asin(rk_c / (RC - RK))            # crown half-angle
    dz = (RC - RK) * math.cos(phi)
    zcc = ZT - dz                                # crown centre
    th_end = math.pi / 2 - phi
    for th in np.linspace(0, th_end, int(th_end * RK / 1.5) + 1)[:-1]:
        n = (math.cos(th), math.sin(th))
        pts.append((rk_c + RK * n[0], ZT + RK * n[1])); nrm.append(n); thk.append(TH); kind.append("knuckle")
    for ps in np.linspace(th_end, math.pi / 2, int(phi * RC / 2.0) + 1):
        n = (math.cos(ps), math.sin(ps))
        pts.append((RC * n[0], zcc + RC * n[1])); nrm.append(n); thk.append(TH); kind.append("crown")
    pts, nrm, thk = np.array(pts), np.array(nrm), np.array(thk)
    pts[-1, 0] = 0.0
    nrm[-1] = (0.0, 1.0)
    tt = np.linspace(0, 1, NT + 1)
    X = pts[:, 0:1] + np.outer(thk, tt) * nrm[:, 0:1]
    Y = pts[:, 1:2] + np.outer(thk, tt) * nrm[:, 1:2]
    ids = m.grid(X, Y, "shell")
    # outer-surface arc length S from the pole (gauges 16-20 use S)
    outer = np.c_[X[:, -1], Y[:, -1]]
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(outer, axis=0).T))]
    s_pole = seg[-1] - seg
    shell = dict(inner=ids[:, 0], outer=ids[:, -1], kind=kind, s_pole=s_pole, nrm=nrm)
    return m, shell, dict(phi=math.degrees(phi), zcc=zcc, zpole=zcc + RC + TH)


def main(variant, r_bond):
    m, shell, geo = build(r_bond)
    xy, el8 = m.quad8()
    inner = set(shell["inner"].tolist())
    wet = []
    for e, face, n1, n2 in m.boundary_faces():
        (x1, y1), (x2, y2) = m.xy[n1], m.xy[n2]
        xm, ym = 0.5 * (x1 + x2), 0.5 * (y1 + y2)
        tag = m.tags[e]
        ok = False
        if tag == "plate" and abs(ym - H_PL) < 1e-6 and xm < A_PL:
            ok = True
        elif tag == "ring" and (abs(xm - A_PL) < 1e-6 or abs(ym - Z_RING[1]) < 1e-6):
            ok = True
        elif tag == "shell" and n1 in inner and n2 in inner and ym > Z_RING[1]:
            ok = True
        if ok:
            wet.append((e + 1, face))

    wd = SCRATCH / f"zbiornik_{variant}"
    wd.mkdir(parents=True, exist_ok=True)
    axis = [i + 1 for i, (x, y) in enumerate(xy) if abs(x) < 1e-9]
    fix = min(range(len(xy)), key=lambda i: abs(xy[i][0] - RO) + abs(xy[i][1] - 500.0)) + 1
    with open(wd / "zb.inp", "w") as f:
        write_nodes_elems(f, xy, el8, "CAX8")
        f.write("*NSET, NSET=AXIS\n" + "\n".join(str(n) for n in axis) + "\n")
        f.write(f"*BOUNDARY\nAXIS, 1, 1\n{fix}, 2, 2\n")
        f.write(f"*MATERIAL, NAME=STAL\n*ELASTIC\n{E}, {NU}\n*SOLID SECTION, ELSET=EALL, MATERIAL=STAL\n")
        f.write("*STEP\n*STATIC\n*DLOAD\n")
        for e, face in wet:
            f.write(f"{e}, P{face}, 1.0\n")
        f.write("*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")
    print(f"{len(xy)} nodes, {len(el8)} elements, {len(wet)} wetted faces")
    run_ccx(wd, "zb")
    res = read_frd(wd / "zb.frd")
    st = res["steps"][-1]
    U, S = st["DISP"], st["STRESS"]

    def sig(n):  # 0-based corner id -> (sr, sz, st, srz)
        v = S[n + 1]
        return v[0], v[1], v[2], v[3]

    def mises(a, b):
        return math.sqrt(a * a + b * b - a * b)

    out = {"variant": variant, "r_bond": r_bond, "p": 1.0, "E": E, "nu": NU, "geo": dict(RO=RO, TC=TC, TH=TH, RC=RC, RK=RK, ZT=ZT, a=A_PL, h=H_PL, **geo)}
    # flat bottom, outer face z = 0
    pl = sorted([(x, i) for i, (x, y) in enumerate(m.xy) if abs(y) < 1e-9 and x <= R_PL + 1e-9])
    out["dno"] = [dict(r=round(x, 3), sr=sig(i)[0], st=sig(i)[2]) for x, i in pl]
    # cylinder, outer (r = 200) and inner (r = 194.7) surfaces, z from the plate face
    cyl = [(m.xy[n][1], n, ni) for n, ni, k in zip(shell["outer"], shell["inner"], shell["kind"]) if k == "cyl"]
    out["plaszcz"] = [dict(z=round(z, 3), sz=sig(n)[1], st=sig(n)[2], sz_in=sig(ni)[1], st_in=sig(ni)[2]) for z, n, ni in cyl]
    # head outer surface vs S (from pole): meridional and hoop
    hd = []
    for n, k, s, nv in zip(shell["outer"], shell["kind"], shell["s_pole"], shell["nrm"]):
        if k == "cyl":
            continue
        sr, sz, sth, srz = sig(n)
        t = (-nv[1], nv[0])  # meridian tangent
        smer = sr * t[0] ** 2 + sz * t[1] ** 2 + 2 * srz * t[0] * t[1]
        hd.append(dict(S=round(float(s), 3), sm=smer, st=sth))
    out["dennica"] = sorted(hd, key=lambda d: d["S"])
    # whole section for the colour map: corner nodes, quads, displacement, von Mises (plane at surface approx.)
    nodes = []
    for i, (x, y) in enumerate(m.xy):
        sr, sz, sth, srz = S[i + 1][:4]
        vm = math.sqrt(0.5 * ((sr - sz) ** 2 + (sz - sth) ** 2 + (sth - sr) ** 2) + 3 * srz ** 2)
        nodes.append([round(x, 3), round(y, 3), round(U[i + 1][0], 6), round(U[i + 1][1], 6), round(vm, 2)])
    out["siatka"] = {"nodes": nodes, "quads": [[int(n) for n in q] for q in m.quads]}
    for k in ("dno", "plaszcz", "dennica"):
        for d in out[k]:
            for kk, v in d.items():
                d[kk] = round(v, 3)
    DATA.mkdir(exist_ok=True)
    (DATA / f"zbiornik_{variant}.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    c = out["plaszcz"][len(out["plaszcz"]) // 2]
    print("plate centre sr,st:", out["dno"][0], " cyl mid:", c, " pole:", out["dennica"][0])
    print("membrane theory: hoop", 1 * 400 / (2 * TC), "axial", 400 / (4 * TC), "sphere", 900 / (4 * TH))
    print("plate theory: SS", 1.24 * (A_PL / H_PL) ** 2, "clamped", 0.75 * (A_PL / H_PL) ** 2)


if __name__ == "__main__":
    main("klejone", A_PL)        # plate bonded to the ring over r = 170..185
    main("sruby", 177.5)         # bolt line r = 177.5: inner part may lift, outer part bears (prying)
