/**
 * analytic.ts — ゼロ次・内側灌流・外側無流束の解析解と壊死前縁
 *
 * 軸対称・径方向の定常ゼロ次反応拡散:
 *     D·(1/r)·d/dr( r·dC/dr ) = R0          (R0 = const)
 * 無流束面 r_f（dC/dr=0）と Dirichlet C(a)=C0 から:
 *     C(r) = C0 + (R0/4D)(r² − a²) − (R0·r_f²/2D)·ln(r/a)
 *
 * 壊死が無い場合は r_f = b（外面無流束）。これが spec の検証用解析解:
 *     C(r) = C0 + (R0/4D)(r² − a²) − (R0·b²/2D)·ln(r/a)
 *
 * 壊死コアが生じる場合、前縁 r_p では C=0 かつ dC/dr=0 を同時に満たし、
 * 上式に r_f=r_p, C(r_p)=0 を代入して超越方程式が得られる:
 *     C0 = (R0/4D)(a² − r_p²) + (R0·r_p²/2D)·ln(r_p/a)
 * これを二分法で解く。r_p 以遠 (C<0 領域) が低酸素/壊死コア。
 *
 * 平板片側灌流の臨界厚（指標表示用）:
 *     L_crit = sqrt(2·D·C0/R0)
 */

import type { Params } from "./presets";
import { R0 as R0of, outerRadius } from "./presets";
import type { Grid } from "./grid";

/** 無流束面 r_f を指定した生の解析濃度（負値もそのまま返す＝線形解） */
export function analyticZeroOrder(
  r: number,
  a: number,
  rf: number,
  R0: number,
  D: number,
  C0: number,
): number {
  return C0 + (R0 / (4 * D)) * (r * r - a * a) - ((R0 * rf * rf) / (2 * D)) * Math.log(r / a);
}

/**
 * 検証用: 外面無流束 (r_f=b) のゼロ次解析プロファイル（クランプ無し・生値）。
 * ゼロ次は線形なので数値解と厳密に一致するはず（負値も比較対象に含める）。
 */
export function zeroOrderAnalyticProfileRaw(grid: Grid, p: Params): Float64Array {
  const R0 = R0of(p);
  const b = outerRadius(p);
  const out = new Float64Array(grid.N);
  for (let i = 0; i < grid.N; i++) {
    out[i] = analyticZeroOrder(grid.r[i], grid.a, b, R0, p.D, p.C0);
  }
  return out;
}

/**
 * 検証用: 両側 Dirichlet（C(a)=C0, C(b)=Cb）のゼロ次定常解（クランプ無し・生値）。
 * 一般解 C(r) = (R0/4D)r² + C1·ln r + C2 を 2 つの Dirichlet 条件で決める。
 * 培地浴(Cb=C0) や O2 空気接触で k_L が十分大きい場合(Cb=C_air)の検証に使う。
 */
export function zeroOrderTwoSidedDirichlet(grid: Grid, p: Params, Cb: number): Float64Array {
  const R0 = R0of(p);
  const D = p.D;
  const a = grid.a;
  const b = grid.b;
  const q = R0 / (4 * D);
  // Ca = q a² + C1 ln a + C2 ;  Cb = q b² + C1 ln b + C2
  const C1 = (Cb - p.C0 - q * (b * b - a * a)) / Math.log(b / a);
  const C2 = p.C0 - q * a * a - C1 * Math.log(a);
  const out = new Float64Array(grid.N);
  for (let i = 0; i < grid.N; i++) {
    const r = grid.r[i];
    out[i] = q * r * r + C1 * Math.log(r) + C2;
  }
  return out;
}

/**
 * 表示用ゼロ次解析プロファイル（物理的・クランプ済み）。
 * 壊死がある場合は無流束面を r_p に置き、r ≥ r_p で C=0 を返す（負値を返さない）。
 * 壊死が無ければ無流束面 r_f=b。いずれも C は 0 以上にクランプ。
 */
export function zeroOrderAnalyticProfileClamped(grid: Grid, p: Params): Float64Array {
  const R0 = R0of(p);
  const b = outerRadius(p);
  const rp = necrosisFront(p);
  const rf = rp ?? b;
  const out = new Float64Array(grid.N);
  for (let i = 0; i < grid.N; i++) {
    const r = grid.r[i];
    if (rp != null && r >= rp) {
      out[i] = 0; // 壊死コア
      continue;
    }
    out[i] = Math.max(0, analyticZeroOrder(r, grid.a, rf, R0, p.D, p.C0));
  }
  return out;
}

/**
 * 壊死前縁 r_p を二分法で解く。
 * g(rp) = (R0/4D)(a²−rp²) + (R0·rp²/2D)·ln(rp/a)  は rp について単調増加で g(a)=0。
 * g(rp)=C0 の解が (a,b) にあれば壊死あり (r_p)、無ければ null（全域生存）。
 */
export function necrosisFront(p: Params): number | null {
  const R0 = R0of(p);
  const D = p.D;
  const a = p.a;
  const b = outerRadius(p);
  if (R0 <= 0) return null; // 消費が無ければ壊死なし

  const g = (rp: number) =>
    (R0 / (4 * D)) * (a * a - rp * rp) + ((R0 * rp * rp) / (2 * D)) * Math.log(rp / a);

  // g は単調増加。g(b) <= C0 なら壊死無し（外面まで C>=0 を維持できる）
  if (g(b) <= p.C0) return null;

  // g(a)=0 < C0 < g(b) → (a,b) に唯一の根
  let lo = a;
  let hi = b;
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi);
    if (g(mid) < p.C0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return 0.5 * (lo + hi);
}

/** 平板片側灌流の臨界厚 L_crit = sqrt(2·D·C0/R0) [m] */
export function lCrit(p: Params): number {
  const R0 = R0of(p);
  if (R0 <= 0) return Infinity;
  return Math.sqrt((2 * p.D * p.C0) / R0);
}
