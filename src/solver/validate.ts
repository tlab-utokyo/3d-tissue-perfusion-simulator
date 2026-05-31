/**
 * validate.ts — 起動時検証（spec 必須）
 *
 * ゼロ次（線形）定常で、数値解（後退Euler を収束まで反復, 反応クランプ無し）と
 * 解析解を全格子点で比較し相対誤差を算出する。複数の外側境界条件で検証する:
 *   - noflux : C(r)=C0+(R0/4D)(r²−a²)−(R0 b²/2D)ln(r/a)（内灌流・外無流束）
 *   - bath   : 両側 Dirichlet C(a)=C0, C(b)=C0
 *   - air(O2, k_L大): 両側 Dirichlet C(a)=C0, C(b)=C_air（ロバン→Dirichlet 極限）
 * いずれも相対誤差 < 1% をコンソールに出力する。
 */

import { PRESETS, peclet, hydraulicLeakiness, type Params, type Species, type OuterBC } from "./presets";
import { solveSteadyProfile, Solver } from "./pde";
import { interpAtRadius } from "./grid";
import { siToMM } from "./units";
import {
  zeroOrderAnalyticProfileRaw,
  zeroOrderTwoSidedDirichlet,
} from "./analytic";

export interface ValidationResult {
  label: string;
  relL2: number; // 相対 L2 誤差
  maxRel: number; // 最大点別相対誤差
  iterations: number;
  pass: boolean; // relL2 < 1%
}

function compare(label: string, p: Params, analytic: (g: ReturnType<typeof solveSteadyProfile>["grid"]) => Float64Array): ValidationResult {
  const { grid, field, iterations } = solveSteadyProfile(p, 200, { clampReaction: false });
  const ana = analytic(grid);
  let sumDiff2 = 0;
  let sumAna2 = 0;
  let maxAbsAna = 0;
  let maxAbsDiff = 0;
  for (let i = 0; i < grid.N; i++) {
    const diff = field[i] - ana[i];
    sumDiff2 += diff * diff;
    sumAna2 += ana[i] * ana[i];
    if (Math.abs(ana[i]) > maxAbsAna) maxAbsAna = Math.abs(ana[i]);
    if (Math.abs(diff) > maxAbsDiff) maxAbsDiff = Math.abs(diff);
  }
  const relL2 = Math.sqrt(sumDiff2) / Math.sqrt(sumAna2);
  const maxRel = maxAbsDiff / maxAbsAna;
  return { label, relL2, maxRel, iterations, pass: relL2 < 0.01 };
}

/** 全 BC ケースの検証を実行（副作用なし） */
export function runValidation(): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const sp of ["O2", "Glucose"] as Species[]) {
    // noflux（内灌流・外無流束）
    const pNoflux: Params = { ...PRESETS[sp], reaction: "zero", outerBC: "noflux" };
    results.push(
      compare(`${sp} noflux`, pNoflux, (g) => zeroOrderAnalyticProfileRaw(g, pNoflux)),
    );
    // bath（両側 Dirichlet, Cb=C0）
    const pBath: Params = { ...PRESETS[sp], reaction: "zero", outerBC: "bath" as OuterBC };
    results.push(
      compare(`${sp} bath`, pBath, (g) => zeroOrderTwoSidedDirichlet(g, pBath, pBath.C0)),
    );
  }
  // O2 空気接触は外面 Dirichlet C_air → 両側 Dirichlet（C0, C_air）の解析解と一致
  const pAir: Params = { ...PRESETS.O2, reaction: "zero", outerBC: "air" };
  results.push(
    compare("O2 air (C_air固定)", pAir, (g) => zeroOrderTwoSidedDirichlet(g, pAir, pAir.Cair)),
  );
  return results;
}

export interface MonotonicResult {
  label: string;
  maxRelOvershoot: number; // 定常値を超えた最大割合（0 が理想）
  maxRelDip: number; // 立ち上がり中の最大の落ち込み割合（0 が理想）
  pass: boolean;
}

/**
 * 過渡の単調性検証: 初期 C=0 から、選んだ半径の C(t) が単調増加→飽和し、
 * 定常値を超えるオーバーシュートや途中の dip が無いことを確認する。
 * （反応の半陰的ラグによる非物理オーバーシュートの回帰検出）
 */
function validateMonotonic(label: string, p: Params): MonotonicResult {
  const s = new Solver(p, 200);
  const steady = solveSteadyProfile(p, 200).field;
  const g = s.grid;
  const rSel = p.a + p.L * 0.5; // 中間半径
  const cSteady = Math.max(0, interpAtRadius(g, steady, rSel));
  const dt = 0.02 * s.diffusionTime();
  let prev = Math.max(0, interpAtRadius(g, s.field, rSel));
  let maxV = prev;
  let maxDip = 0;
  for (let k = 0; k < 120; k++) {
    s.step(dt);
    const v = Math.max(0, interpAtRadius(g, s.field, rSel));
    if (v < prev) maxDip = Math.max(maxDip, prev - v);
    maxV = Math.max(maxV, v);
    prev = v;
  }
  const scale = Math.max(cSteady, 1e-12);
  const maxRelOvershoot = Math.max(0, (maxV - cSteady) / scale);
  const maxRelDip = maxDip / scale;
  // 許容: オーバーシュート・dip とも定常値の 1% 未満
  return { label, maxRelOvershoot, maxRelDip, pass: maxRelOvershoot < 0.01 && maxRelDip < 0.01 };
}

export interface BoundaryResult {
  label: string;
  detail: string;
  pass: boolean;
}

/**
 * 境界条件の単体検証（灌流 ΔP>0 でも外側BCが正しく効くこと）:
 *  1) 培地浴は任意の ΔP で C(b)=C0（相対誤差 <1e-6）。
 *  2) 培地浴と無流束で解が明確に異なる。
 *  3) 封止/無流束は ΔP をかけても解が変わらない（出口が無く u≡0）。
 */
export function runBoundaryValidation(): BoundaryResult[] {
  const base: Params = { ...PRESETS.O2, reaction: "mm" };
  const C0 = base.C0;
  const cb = (p: Params) => {
    const f = solveSteadyProfile(p, 200).field;
    return f[f.length - 1];
  };
  const out: BoundaryResult[] = [];

  // 1) 培地浴は ΔP に依らず C(b)=C0
  let worst = 0;
  for (const dP of [0, 500, 2000]) {
    const e = Math.abs(cb({ ...base, outerBC: "bath", deltaP: dP }) - C0) / C0;
    worst = Math.max(worst, e);
  }
  out.push({
    label: "培地浴 C(b)=C0 (∀ΔP)",
    detail: `最大相対誤差 ${(worst * 100).toExponential(2)}%`,
    pass: worst < 1e-6,
  });

  // 2) 培地浴 vs 無流束 は明確に異なる
  const fb = solveSteadyProfile({ ...base, outerBC: "bath", deltaP: 0 }, 200).field;
  const fn = solveSteadyProfile({ ...base, outerBC: "noflux", deltaP: 0 }, 200).field;
  let md = 0;
  for (let i = 0; i < fb.length; i++) md = Math.max(md, Math.abs(fb[i] - fn[i]));
  out.push({
    label: "培地浴 ≠ 無流束",
    detail: `最大差 ${(md / C0 * 100).toFixed(1)}% of C0`,
    pass: md > 0.01 * C0,
  });

  // 3) 封止/無流束は ΔP で解が変わらない（u≡0）
  const s0 = solveSteadyProfile({ ...base, outerBC: "noflux", deltaP: 0 }, 200).field;
  const s2 = solveSteadyProfile({ ...base, outerBC: "noflux", deltaP: 2000 }, 200).field;
  let md2 = 0;
  for (let i = 0; i < s0.length; i++) md2 = Math.max(md2, Math.abs(s0[i] - s2[i]));
  out.push({
    label: "封止は ΔP 無効 (u≡0)",
    detail: `ΔP=0 と 2000 の最大差 ${(md2 / C0).toExponential(2)}`,
    pass: md2 < 1e-9,
  });

  // 4) O2 空気接触は任意の ΔP で C(b)=C_air（外界酸素に固定）
  const Cair = base.Cair;
  let worstAir = 0;
  for (const dP of [0, 500, 2000]) {
    const e = Math.abs(cb({ ...base, outerBC: "air", deltaP: dP }) - Cair) / Cair;
    worstAir = Math.max(worstAir, e);
  }
  out.push({
    label: "空気O₂ C(b)=C_air (∀ΔP)",
    detail: `最大相対誤差 ${(worstAir * 100).toExponential(2)}%`,
    pass: worstAir < 1e-6,
  });

  // 5) グルコース空気: ΔP=0 は無流束と一致 / ΔP>0 は流出で外面が無流束より枯れる
  const gluBase: Params = { ...PRESETS.Glucose, reaction: "mm" };
  const gAir0 = solveSteadyProfile({ ...gluBase, outerBC: "air", deltaP: 0 }, 200).field;
  const gNof = solveSteadyProfile({ ...gluBase, outerBC: "noflux", deltaP: 0 }, 200).field;
  let mdG = 0;
  for (let i = 0; i < gAir0.length; i++) mdG = Math.max(mdG, Math.abs(gAir0[i] - gNof[i]));
  out.push({
    label: "グルコース空気 ΔP=0 = 無流束",
    detail: `最大差 ${(mdG / gluBase.C0).toExponential(2)}`,
    pass: mdG < 1e-9,
  });
  // 流出端の正しい挙動: 外面は C0 に固定されない自由端だが、外向き移流が
  // ルーメン(源)からグルコースを供給するため、無流束より濃く・C0 未満になる。
  //   無流束(消費のみ) < 空気流出(移流供給+流出) < C0(培地浴Dirichlet)
  const gAirP = solveSteadyProfile({ ...gluBase, outerBC: "air", deltaP: 2000 }, 200).field;
  const cbAirP = gAirP[gAirP.length - 1];
  const cbNof = gNof[gNof.length - 1];
  out.push({
    label: "グルコース空気 ΔP>0 流出端 (無流束<流出<C0)",
    detail: `C(b): 無流束 ${siToMM(cbNof).toFixed(3)} < 流出 ${siToMM(cbAirP).toFixed(3)} < C0 ${siToMM(gluBase.C0).toFixed(1)} mM`,
    pass: cbNof < cbAirP && cbAirP < gluBase.C0 - 1e-9,
  });

  // 6) 薄水層 Robin: k_ext=0 で無流束に一致
  const r0 = solveSteadyProfile({ ...base, outerBC: "thin_water_layer", kExt: 0 }, 200).field;
  let mdR = 0;
  for (let i = 0; i < r0.length; i++) mdR = Math.max(mdR, Math.abs(r0[i] - s0[i]));
  out.push({
    label: "薄水層 k_ext=0 = 無流束",
    detail: `最大差 ${(mdR / C0).toExponential(2)}`,
    pass: mdR < 1e-9,
  });

  // 7) 薄水層 Robin: k_ext 大で C_ext=C0 に固定（Dirichlet 極限）
  const cbRobinBig = cb({ ...base, outerBC: "thin_water_layer", kExt: 1.0, cExtMode: "C0" });
  out.push({
    label: "薄水層 k_ext大 → C(b)=C_ext(=C0)",
    detail: `C(b)=${siToMM(cbRobinBig).toFixed(4)} (→${siToMM(C0).toFixed(2)} mM)`,
    pass: Math.abs(cbRobinBig - C0) / C0 < 0.02,
  });

  // 8) 薄水層 中間 k_ext は 無流束 と Dirichlet(C_ext) の中間。
  //    純拡散(qmax=0)・C_ext=0 のクリーンな系で:  k_ext=0→C(b)=C0, 大→0, 中間→その間。
  const diffBase: Params = { ...base, reaction: "zero", qmax: 0, cExtMode: "zero" };
  const cbThinNo = cb({ ...diffBase, outerBC: "thin_water_layer", kExt: 0 }); // = C0
  const cbThinMid = cb({ ...diffBase, outerBC: "thin_water_layer", kExt: 1e-5 });
  const cbThinBig = cb({ ...diffBase, outerBC: "thin_water_layer", kExt: 1 }); // → C_ext=0
  out.push({
    label: "薄水層 中間 k_ext は無流束(C0)とDirichlet(0)の中間",
    detail: `C(b): Dirichlet ${siToMM(cbThinBig).toFixed(3)} < 中間 ${siToMM(cbThinMid).toFixed(3)} < 無流束 ${siToMM(cbThinNo).toFixed(3)}`,
    pass: cbThinBig < cbThinMid && cbThinMid < cbThinNo,
  });

  // 9) 薄水層は Robin 交換があっても流体流出 leakiness=0 → Pe=0
  const pThin: Params = { ...base, outerBC: "thin_water_layer", kExt: 5e-6, deltaP: 2000 };
  out.push({
    label: "薄水層は Pe=0（溶質交換のみ）",
    detail: `Pe=${peclet(pThin).toExponential(2)}, leakiness=${hydraulicLeakiness(pThin)}`,
    pass: peclet(pThin) === 0,
  });

  // 10) 微小漏れ: leakiness を上げると Pe が 0→full の中間値、解も中間
  const peSealed = peclet({ ...base, outerBC: "noflux", deltaP: 2000 });
  const peOpen = peclet({ ...base, outerBC: "bath", deltaP: 2000 });
  const peLeak = peclet({ ...base, outerBC: "leaky", leakiness: 0.3, deltaP: 2000 });
  out.push({
    label: "微小漏れ Pe は封止と開放の中間",
    detail: `Pe: 封止 ${peSealed.toFixed(2)} < 漏れ0.3 ${peLeak.toFixed(2)} < 開放 ${peOpen.toFixed(2)}`,
    pass: peSealed < peLeak && peLeak < peOpen && Math.abs(peLeak - 0.3 * peOpen) < 1e-6,
  });

  return out;
}

export function runMonotonicValidation(): MonotonicResult[] {
  return [
    validateMonotonic("O2 MM bath", { ...PRESETS.O2, reaction: "mm", outerBC: "bath" }),
    validateMonotonic("Glucose MM bath", { ...PRESETS.Glucose, reaction: "mm", outerBC: "bath" }),
    validateMonotonic("O2 純拡散(qmax=0) bath", {
      ...PRESETS.O2,
      reaction: "zero",
      outerBC: "bath",
      qmax: 0,
    }),
  ];
}

/** 起動時にコンソールへ検証結果を出力する */
export function logValidation(): ValidationResult[] {
  const results = runValidation();
  console.groupCollapsed("%c[Chikuwa] 解析解 vs 数値定常 検証（ゼロ次・各境界条件）", "font-weight:bold");
  for (const r of results) {
    const pct = (r.relL2 * 100).toFixed(4);
    const maxPct = (r.maxRel * 100).toFixed(4);
    const tag = r.pass ? "✓ PASS (<1%)" : "✗ FAIL (>=1%)";
    console.log(
      `${r.label}: 相対L2誤差 = ${pct}% , 最大相対誤差 = ${maxPct}% , 反復 = ${r.iterations}  → ${tag}`,
    );
  }
  console.groupEnd();

  const mono = runMonotonicValidation();
  console.groupCollapsed("%c[Chikuwa] 過渡 C(r,t) 単調性検証（オーバーシュート/dip 検出）", "font-weight:bold");
  for (const r of mono) {
    const tag = r.pass ? "✓ PASS（単調飽和）" : "✗ FAIL（非物理オーバーシュート）";
    console.log(
      `${r.label}: overshoot=${(r.maxRelOvershoot * 100).toFixed(3)}% , dip=${(r.maxRelDip * 100).toFixed(3)}%  → ${tag}`,
    );
  }
  console.groupEnd();

  const bnd = runBoundaryValidation();
  console.groupCollapsed("%c[Chikuwa] 外側境界条件 単体検証（灌流時も BC が効くか）", "font-weight:bold");
  for (const r of bnd) {
    console.log(`${r.label}: ${r.detail}  → ${r.pass ? "✓ PASS" : "✗ FAIL"}`);
  }
  console.groupEnd();
  return results;
}
