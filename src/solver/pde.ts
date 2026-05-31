/**
 * pde.ts — 軸対称・径方向の移流拡散反応方程式ソルバ（既定: 後退Euler / θ法）
 *
 *   ∂C/∂t = D·(1/r)·∂/∂r( r·∂C/∂r ) − u(r)·∂C/∂r − R(C)
 *
 * 空間離散化（保存形フラックス, 円筒座標）:
 *   拡散 Lap_i = (1/(r_i·Δr²))·[ r_{i+½}(C_{i+1}−C_i) − r_{i−½}(C_i−C_{i−1}) ]
 *     重み wp_i=r_{i+½}/(r_i·Δr²), wm_i=r_{i−½}/(r_i·Δr²), r_{i±½}=r_i±Δr/2
 *   移流 −u·∂C/∂r は風上(後退)差分（u>0 外向き, cell-Pe 大でも安定）。
 *   行作用素 A = 拡散 + 移流。
 *
 * 反応項 R(C):
 *   MM:      R = R0·C/(Km+C),  R0 = ρ·q_max
 *   ゼロ次:  飽和した MM として微小正則化幅 δ=10⁻³·C0 で C→0 に滑らかに 0 へ落とす
 *            （壊死前縁の不連続・数値振動を回避。検証用の clampReaction=false 時のみ純 R0 一定）
 *   線形化 R(C)≈k·C+s（k=R'(C), s=R−k·C）。各ステップ内で線形化点を Picard 反復し陰的化。
 *
 * 時間積分: θ法。既定 θ=1（後退Euler, L-安定）。
 *   鋭い壊死前縁では Crank–Nicolson(θ=0.5) は剛性モードに対し増幅率→−1 で振動するため、
 *   既定を後退Euler とする（θ は SolverOptions で切替可能）。
 *   (I − θΔt·A + θΔt·diag(k)) C^{n+1} = C^n + (1−θ)Δt·(A C^n) − (1−θ)Δt·R(C^n) − θΔt·s
 *   三重対角を Thomas 法で解く。
 *
 * 境界条件（r=a は常に Dirichlet C=C0。r=b は effectiveOuterBC で分岐）:
 *   dirichlet: 培地浴 C(b)=C0 / 空気O2 C(b)=C_air（固定）
 *   neumann:   完全封止 ∂C/∂r=0（ゴースト C_N=C_{N−2}, u≡0）
 *   robin:     薄水層 −D∂C/∂r=k_ext(C_b−C_ext)（溶質交換のみ。k_ext=0→neumann, 大→Dirichlet）
 *   outflow:   空気グルコース / 微小漏れ。拡散無流束 + 風上移流で流出（u=leakiness·Darcy）
 * 流体流出(移流)は hydraulicLeakiness で別管理: 封止/薄水層=0, 培地浴/空気=1, 微小漏れ=可変。
 */

import type { Params } from "./presets";
import { R0 as R0of, effectiveOuterBC, dirichletValue, cExtValue, filtrationUa } from "./presets";
import { makeGrid, type Grid, N_DEFAULT } from "./grid";

// 時間離散の θ。θ=0.5: Crank–Nicolson（2次精度）, θ=1: 後退Euler（L-安定）。
// 壊死前縁のような鋭い界面では CN は剛性モードに対し増幅率→−1 で振動（period-2）し
// 残差が収束しないため、既定は L-安定な後退Euler とする（spec の「陰的・剛性対応」を満たす）。
const THETA_DEFAULT = 1.0;

// ゼロ次消費の正則化幅 δ = ZERO_ORDER_REG·C0。C ≫ δ で R≈R0、C→0 で滑らかに 0 へ。
// 壊死前縁の不連続を避けて数値振動を防ぐためのごく狭い遷移帯（C0 の 0.1%）。
const ZERO_ORDER_REG = 1e-3;

// 各ステップ内で反応線形化を陰的化する Picard 反復の上限と収束許容。
const PICARD_MAX = 6;
const PICARD_TOL = 1e-7;

/** 三重対角系 (sub a, diag b, super c) x = d を Thomas 法で解く（破壊的・新配列返却） */
export function thomas(
  a: Float64Array, // 下対角 a[1..n-1]（a[0] 未使用）
  b: Float64Array, // 主対角 b[0..n-1]
  c: Float64Array, // 上対角 c[0..n-2]
  d: Float64Array, // 右辺
): Float64Array {
  const n = b.length;
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Float64Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

export interface SolverOptions {
  /** R(C) を C<=0 でゼロにクランプ（物理表示用 true / 線形解検証用 false） */
  clampReaction?: boolean;
  /** 時間離散 θ（0.5=Crank–Nicolson, 1=後退Euler）。既定は後退Euler。 */
  theta?: number;
}

/**
 * 初期場: 組織は空 (C=0)、r=a は C0。外面が Dirichlet（培地浴 C0 / 空気O2 C_air）の場合は
 * その固定値で初期化する（t=0 の表示・時系列が境界条件と整合するように）。前縁が外向きに進行。
 */
export function initField(grid: Grid, p: Params): Float64Array {
  const f = new Float64Array(grid.N); // すべて 0
  f[0] = p.C0;
  if (effectiveOuterBC(p) === "dirichlet") f[grid.N - 1] = dirichletValue(p);
  return f;
}

export class Solver {
  readonly grid: Grid;
  readonly p: Params;
  readonly clampReaction: boolean;
  readonly theta: number;
  field: Float64Array;
  t = 0;
  /** 直近ステップの相対変化 max|C^{n+1}-C^n| / max(C,ε) ∈ [0,1]（収束残差） */
  lastResidual = 1;

  // 幾何重み（行作用素 A 用, i=1..N-1）
  private wm: Float64Array;
  private wp: Float64Array;
  private u: Float64Array; // 径方向移流速度 u(r)=u_a·a/r [m/s]（外向き, ≥0）
  private readonly R0: number;
  readonly uA: number; // 壁面濾過速度 [m/s]
  readonly perfusion: boolean; // 灌流(移流)有効か

  constructor(p: Params, N: number = N_DEFAULT, opts: SolverOptions = {}) {
    this.p = p;
    this.grid = makeGrid(p.a, p.L, N);
    this.clampReaction = opts.clampReaction ?? true;
    this.theta = opts.theta ?? THETA_DEFAULT;
    this.R0 = R0of(p);
    const { r, dr } = this.grid;
    const dr2 = dr * dr;
    this.wm = new Float64Array(N);
    this.wp = new Float64Array(N);
    this.u = new Float64Array(N);
    this.uA = filtrationUa(p);
    this.perfusion = this.uA > 0;
    for (let i = 0; i < N; i++) {
      this.wp[i] = (r[i] + dr / 2) / (r[i] * dr2);
      this.wm[i] = (r[i] - dr / 2) / (r[i] * dr2);
      this.u[i] = (this.uA * p.a) / r[i]; // 質量保存より 1/r 減衰
    }
    this.field = initField(this.grid, p);
  }

  /** R(C^n)_i, 線形化係数 k_i, s_i を返す */
  private reactionCoeffs(C: Float64Array): {
    k: Float64Array;
    s: Float64Array;
    R: Float64Array;
  } {
    const n = this.grid.N;
    const k = new Float64Array(n);
    const s = new Float64Array(n);
    const R = new Float64Array(n);
    const R0 = this.R0;

    // 検証用（clampReaction=false）のゼロ次は、純粋に R=R0 一定の線形問題として扱う
    // （解析解と厳密比較するため。負値も許容）。
    if (this.p.reaction === "zero" && !this.clampReaction) {
      for (let i = 0; i < n; i++) {
        R[i] = R0;
        s[i] = R0;
      }
      return { k, s, R };
    }

    // 物理表示: MM はそのまま、ゼロ次は「飽和した MM」として微小な正則化幅 δ で
    // 消費を滑らかに 0 へ落とす（C→0 で R→0）。これにより壊死前縁が不連続にならず、
    // C は自然に 0 以上に保たれ、後退Euler が単調収束する（前縁の period-2 振動を排除）。
    const Km = this.p.reaction === "mm" ? this.p.Km : ZERO_ORDER_REG * this.p.C0;
    for (let i = 0; i < n; i++) {
      const c = C[i];
      if (c <= 0) {
        R[i] = 0;
        k[i] = 0;
        s[i] = 0;
        continue;
      }
      const denom = Km + c;
      R[i] = (R0 * c) / denom;
      k[i] = (R0 * Km) / (denom * denom); // R'(c)
      s[i] = R[i] - k[i] * c;
    }
    return { k, s, R };
  }

  /**
   * θ法 1 ステップ（Δt 秒進める）。既定 θ=1（後退Euler）。
   *
   * 非線形反応 R(C) は半陰的に線形化するが、線形化の基準点 C^n のみを使う「ラグ」だと
   * 大きな Δt で初期過渡に非物理的オーバーシュート（peak→dip）を生む。これは t=0 で
   * 全域 C=0 → 反応オフのまま拡散だけ大きく進み、次ステップで消費が遅れて効くため。
   * 対策として各ステップ内で反応の線形化を Picard 反復し、実質的に陰的化する
   * （R(C^{n+1}) を C^{n+1} まわりで評価）。これで単調な飽和挙動になる。
   */
  step(dt: number): void {
    const n = this.grid.N;
    const D = this.p.D;
    const TH = this.theta;
    const C = this.field; // C^n（時間項・陽的項に使用, 固定）
    const Rn = this.reactionCoeffs(C).R; // 陽的反応 R(C^n)（(1-θ) 項用）
    const invDr = 1 / this.grid.dr;
    const eff = effectiveOuterBC(this.p);
    const last = n - 1;

    // 線形化基準 lin（→C^{n+1}）で 1 回解く。Picard で lin を更新して陰的反応に近づける。
    const solveOnce = (lin: Float64Array): Float64Array => {
      const { k, s } = this.reactionCoeffs(lin);
      const sub = new Float64Array(n);
      const diag = new Float64Array(n);
      const sup = new Float64Array(n);
      const rhs = new Float64Array(n);

      // 行作用素 A = 拡散 + 移流（風上後退差分, u>0 外向き）
      for (let i = 1; i < n - 1; i++) {
        const adv = this.u[i] * invDr;
        const aL = D * this.wm[i] + adv;
        const aU = D * this.wp[i];
        const aC = -(D * this.wm[i] + D * this.wp[i]) - adv;
        sub[i] = -TH * dt * aL;
        diag[i] = 1 - TH * dt * aC + TH * dt * k[i];
        sup[i] = -TH * dt * aU;
        const AC = aL * C[i - 1] + aC * C[i] + aU * C[i + 1];
        rhs[i] = C[i] + (1 - TH) * dt * AC - (1 - TH) * dt * Rn[i] - TH * dt * s[i];
      }

      // r=a Dirichlet C0
      diag[0] = 1;
      sup[0] = 0;
      rhs[0] = this.p.C0;

      // r=b: 選択中の外側BCを正しく課す。
      if (eff === "dirichlet") {
        // 培地浴: C(b)=C0 / 空気接触(O2): C(b)=C_air を厳密固定（移流があっても右端は固定値）。
        // 移流は内部セルにのみ効く（右端は移流に引きずられない）。
        sub[last] = 0;
        diag[last] = 1;
        rhs[last] = dirichletValue(this.p);
      } else {
        // neumann(封止) / outflow(空気G・微小漏れ) / robin(薄水層) を単一の組立てで:
        //   拡散は無流束ゴースト(∂C/∂r≈0, C_N=C_{N-2}) + 風上(後退)移流を最外セルにも適用。
        //     封止/薄水層: filtrationUa=0 → u[last]=0 で純拡散境界（移流流出なし）。
        //     空気G・微小漏れ: u[last]=leakiness·Darcy → 上流から運ばれ外面から流出。
        //   robin（薄水層）は -D∂C/∂r=k_ext(C_b−C_ext) を反応増補として加える（移流とは独立）:
        //     g=2·dr·k_ext·wp[last] [1/s] → k+=g, s−=g·C_ext, R+=g·(C−C_ext)。
        //     k_ext=0 で Neumann に一致、k_ext 大で C_b→C_ext（Dirichlet）に漸近。
        const aLU = D * (this.wm[last] + this.wp[last]);
        const adv = this.u[last] * invDr;
        const aL = aLU + adv;
        const aC = -D * (this.wp[last] + this.wm[last]) - adv;
        let kLast = k[last];
        let sLast = s[last];
        let RLast = Rn[last];
        if (eff === "robin") {
          const cExt = cExtValue(this.p);
          const g = 2 * this.grid.dr * this.p.kExt * this.wp[last];
          kLast += g;
          sLast -= g * cExt;
          RLast += g * (C[last] - cExt);
        }
        sub[last] = -TH * dt * aL;
        diag[last] = 1 - TH * dt * aC + TH * dt * kLast;
        sup[last] = 0;
        const AC = aL * C[last - 1] + aC * C[last];
        rhs[last] = C[last] + (1 - TH) * dt * AC - (1 - TH) * dt * RLast - TH * dt * sLast;
      }

      return thomas(sub, diag, sup, rhs);
    };

    // Picard 反復（反応の陰的化）。ゼロ次・線形なら 1 回で厳密、MM/正則化でも数回で収束。
    let lin = C;
    let next = C;
    for (let it = 0; it < PICARD_MAX; it++) {
      next = solveOnce(lin);
      let md = 0;
      let mx = 1e-12;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(next[i] - lin[i]);
        if (d > md) md = d;
        if (Math.abs(next[i]) > mx) mx = Math.abs(next[i]);
      }
      lin = next;
      if (md / mx < PICARD_TOL) break;
    }

    // 内部場はハードクランプしない（表示時のみ 0 クランプ）。残差は前ステップとの相対変化。
    let maxDelta = 0;
    let maxC = 1e-12;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(next[i] - C[i]);
      if (d > maxDelta) maxDelta = d;
      if (next[i] > maxC) maxC = next[i];
      if (C[i] > maxC) maxC = C[i];
    }
    this.field = next;
    this.lastResidual = maxDelta / maxC;
    this.t += dt;
  }

  /** 表示用の濃度場（負値を 0 にクランプしたコピー）。壊死コアは 0 として描画される。 */
  displayField(): Float64Array {
    const out = this.field.slice();
    if (this.clampReaction) for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;
    return out;
  }

  /** 特性拡散時間 τ = L²/D [s] */
  diffusionTime(): number {
    return (this.p.L * this.p.L) / this.p.D;
  }

  /**
   * 定常解を、過渡と同じ後退Euler スキームを中程度の固定 Δt=0.02τ で収束まで反復して求める。
   * ※ 巨大 Δt（旧実装の漸増→1e4τ）は、培地浴・厚壁などの自由境界(壊死前縁)ケースで
   *    Picard が基底間を行き来して別の不動点（過剰枯渇）に誤収束する。Δt≲0.02τ なら
   *    前縁が滑らかに進み過渡解と同じ正しい定常へ収束する（全 L で ≤~100 反復・数ms）。
   * 過渡アニメ(0.01τ)と同系の値に揃うので、プロファイルの破線(定常)＝実線の終端 となる。
   * L-安定なので振動しない。反復回数を返す。
   */
  steadySolve(tol = 1e-7, maxIter = 3000): number {
    const dt = 0.02 * this.diffusionTime();
    let it = 0;
    for (; it < maxIter; it++) {
      this.step(dt);
      if (this.lastResidual < tol) break;
    }
    this.t = Infinity; // 定常（時間情報は無効）
    this.lastResidual = 0;
    return it;
  }

  /** 現在場を初期状態へ戻し t=0 に */
  reset(): void {
    this.field = initField(this.grid, this.p);
    this.t = 0;
    this.lastResidual = 1;
  }
}

/** 定常場を直接計算して返すユーティリティ（破壊しないコピー版） */
export function solveSteadyProfile(
  p: Params,
  N: number = N_DEFAULT,
  opts: SolverOptions = {},
): { grid: Grid; field: Float64Array; iterations: number } {
  const solver = new Solver(p, N, opts);
  const iterations = solver.steadySolve();
  return { grid: solver.grid, field: solver.field, iterations };
}
