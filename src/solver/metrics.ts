/**
 * metrics.ts — 無次元数と分布指標
 *
 * 無次元数:
 *   Da = R0·L²/(D·C0)              （>2 で平板片側灌流は壊死コア発生の目安）
 *   φ  = L·sqrt(ρ·q_max/(D·K_m))   Thiele 数
 *   κ  = C0/K_m                    飽和度
 *
 * 分布指標は与えられた濃度場（定常 or 過渡）から計算する:
 *   浸透深さ      = r_p − a            （r_p: ルーメンから外向きに見て初めて C<閾値 となる点）
 *   生存体積率    = ∫_alive r dr / ∫_a^b r dr   （環状なので体積重み ∝ r）
 *   最小濃度      = min C
 *   コア低酸素    = どこかで C<閾値 か
 *   L_crit       = analytic.lCrit
 */

import type { Params } from "./presets";
import { R0 as R0of, outerRadius, peclet, filtrationUa } from "./presets";
import type { Grid } from "./grid";
import { lCrit } from "./analytic";

/**
 * 壊死閾値 [mol/m^3]。O2 は生理値 C_necrosis（編集可）、グルコースは半飽和の一部で代用。
 * 低酸素ライン・壊死ライン・ゾーン塗り・壊死前縁検出すべてがこの単一の真実を共有する。
 */
export function necrosisThreshold(p: Params): number {
  return p.species === "O2" ? p.Cnecrosis : 0.1 * p.Km;
}

/** 低酸素閾値 [mol/m^3]。O2 のみ（C_hypoxia）。グルコースは概念が無いため null。 */
export function hypoxiaThreshold(p: Params): number | null {
  return p.species === "O2" ? p.Chypoxia : null;
}

/** ルーメンから外向きに見て初めて C<閾値 となる半径 r [m]（無ければ null） */
export function firstCrossingRadius(
  grid: Grid,
  field: Float64Array,
  threshold: number,
): number | null {
  for (let i = 0; i < grid.N; i++) {
    if (field[i] < threshold) return grid.r[i];
  }
  return null;
}

export interface Metrics {
  Da: number;
  phi: number; // Thiele
  kappa: number;
  Pe: number; // Péclet 数 u_a·L/D（移流/拡散比）
  uA: number; // 壁面濾過速度 [m/s]
  // 以下は「現在の数値解」から算出（反応律=MM でも数値解ベース）
  penetrationDepth: number; // r_p − a [m]（壊死前縁基準）
  survivalFraction: number; // 0..1
  minConc: number; // [mol/m^3]
  hasNecroticCore: boolean; // 壊死コア（C<壊死閾値）あり
  hasHypoxicCore: boolean; // 低酸素コア（C<低酸素閾値）あり（O2のみ）
  necrosisRadius: number | null; // 壊死前縁 r_p [m]（C<壊死閾値の最初の点, 無ければ null）
  hypoxiaRadius: number | null; // 低酸素境界 [m]（C<低酸素閾値の最初の点, O2のみ）
  threshold: number; // 壊死閾値 [mol/m^3]
  hypoxiaThresh: number | null; // 低酸素閾値 [mol/m^3]（O2のみ, 無ければ null）
  // L_crit は平板片側灌流の臨界厚（ゼロ次・BC非依存の指標）
  lCrit: number; // [m]
}

export function computeMetrics(p: Params, grid: Grid, field: Float64Array): Metrics {
  const R0 = R0of(p);
  const Da = (R0 * p.L * p.L) / (p.D * p.C0);
  const phi = p.L * Math.sqrt((p.rho * p.qmax) / (p.D * p.Km));
  const kappa = p.C0 / p.Km;
  const Pe = peclet(p);
  const uA = filtrationUa(p);
  const thr = necrosisThreshold(p);
  const hypThr = hypoxiaThreshold(p);

  // 指標は表示と同じく負値を 0 にクランプした場（壊死コアは 0）で評価する。
  // 内部場の微小負値（数値誤差）を拾って過剰に壊死判定しないため。
  const c = field.slice();
  for (let i = 0; i < c.length; i++) if (c[i] < 0) c[i] = 0;

  // 外向きスキャンで初めて閾値を下回る点 = 壊死前縁 / 低酸素境界
  const necrosisRadius = firstCrossingRadius(grid, c, thr);
  const hypoxiaRadius = hypThr != null ? firstCrossingRadius(grid, c, hypThr) : null;
  const penetrationDepth = (necrosisRadius ?? outerRadius(p)) - p.a;

  // 生存体積率（環状重み r·dr の台形）
  let aliveW = 0;
  let totalW = 0;
  for (let i = 0; i < grid.N; i++) {
    const w = grid.r[i]; // dr は共通なので比に効かない
    totalW += w;
    if (c[i] >= thr) aliveW += w;
  }
  const survivalFraction = totalW > 0 ? aliveW / totalW : 0;

  let minConc = Infinity;
  for (let i = 0; i < grid.N; i++) if (c[i] < minConc) minConc = c[i];

  return {
    Da,
    phi,
    kappa,
    Pe,
    uA,
    penetrationDepth,
    survivalFraction,
    minConc,
    hasNecroticCore: necrosisRadius != null,
    hasHypoxicCore: hypoxiaRadius != null,
    necrosisRadius,
    hypoxiaRadius,
    threshold: thr,
    hypoxiaThresh: hypThr,
    lCrit: lCrit(p),
  };
}
