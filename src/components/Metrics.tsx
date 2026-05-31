/**
 * Metrics — 指標パネル。支配PDEを KaTeX 表示し、無次元数と分布指標を並べる。
 */
import type { Params } from "../solver/presets";
import { hasPerfusion, effectiveOuterBC, hydraulicLeakiness, cExtValue } from "../solver/presets";
import type { Metrics as M } from "../solver/metrics";
import { mToUm, siToMM } from "../solver/units";
import { Math } from "./Katex";
import styles from "./Metrics.module.css";

interface Props {
  params: Params;
  metrics: M;
}

const EFF_LABEL: Record<ReturnType<typeof effectiveOuterBC>, string> = {
  dirichlet: "Dirichlet",
  neumann: "Neumann",
  robin: "Robin",
  outflow: "Outflow",
};

/** 外側境界の説明文（局所1D径方向モデル） */
function outerBCLabel(p: Params): string {
  const perf = hasPerfusion(p);
  switch (p.outerBC) {
    case "bath":
      return `外面 r=b: 培地浴（C=C₀ Dirichlet）${perf ? "＋内部に灌流移流" : ""}`;
    case "noflux":
      return p.deltaP > 0
        ? `外面 r=b: 完全封止（出口が無く定常流ゼロ → ΔP_localをかけても u≡0）`
        : `外面 r=b: 完全封止（∂C/∂r=0）`;
    case "thin_water_layer":
      return `外面 r=b: 薄水層（Robin, k_ext=${p.kExt.toExponential(0)} m/s, C_ext=${siToMM(cExtValue(p)).toFixed(3)}mM）溶質交換のみ・流体流出なし`;
    case "air":
      return p.species === "O2"
        ? `外面 r=b: 空気接触＝外界O₂に固定（C=C_air=${siToMM(p.Cair).toFixed(2)}mM, Dirichlet）`
        : perf
          ? `外面 r=b: 空気接触＝対流流出（ΔP_local=${p.deltaP.toFixed(0)}Pa, グルコースが濾液とともに流出）`
          : `外面 r=b: 空気接触（ΔP=0 では無流束と同一。外界供給なし）`;
    case "leaky":
      return `外面 r=b: 微小漏れ（流体が一部流出, leakiness=${hydraulicLeakiness(p).toFixed(2)}）`;
  }
}

export function Metrics({ params, metrics: m }: Props) {
  const reactionTex =
    params.reaction === "mm"
      ? "R(C)=\\rho\\,q_{max}\\dfrac{C}{K_m+C}"
      : "R(C)=R_0=\\rho\\,q_{max}";
  const isAirOrThin = params.outerBC === "air" || params.outerBC === "thin_water_layer";

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>指標 &amp; 支配方程式</div>

      {/* 横長 4 カラム（広い時は横並び、狭い時は折返し） */}
      <div className={styles.cols}>
        {/* 1. 支配方程式 + 境界条件 */}
        <section className={styles.col}>
          <div className={styles.pde}>
            <Math
              block
              tex={"\\frac{\\partial C}{\\partial t}=D\\,\\frac{1}{r}\\frac{\\partial}{\\partial r}\\!\\left(r\\,\\frac{\\partial C}{\\partial r}\\right)-u(r)\\frac{\\partial C}{\\partial r}-R(C)"}
            />
            <Math block tex={"u(r)=u_a\\,a/r,\\quad u_a=\\tfrac{k_{perm}}{\\mu}\\tfrac{\\Delta P}{a\\,\\ln(b/a)}"} />
            <Math block tex={reactionTex} />
          </div>
          <div
            className={`${styles.flag} ${isAirOrThin ? styles.flagOk : ""}`}
            style={isAirOrThin ? undefined : { background: "var(--accent-weak)", color: "var(--ink)" }}
          >
            {isAirOrThin ? "🌬 " : ""}
            {outerBCLabel(params)}
          </div>
          <div className={styles.k}>
            溶質境界 = <b>{EFF_LABEL[effectiveOuterBC(params)]}</b> ・ 流体流出 leakiness ={" "}
            <b>{hydraulicLeakiness(params).toFixed(2)}</b>
          </div>
        </section>

        {/* 2. 無次元数 */}
        <section className={styles.col}>
          <div className={styles.colLabel}>無次元数</div>
          <div className={styles.dimless}>
            <div className={styles.dimCell}>
              <div className={styles.k}>
                <Math tex={"Da=\\dfrac{R_0 L^2}{D\\,C_0}"} />
              </div>
              <div className={styles.v}>{m.Da.toPrecision(3)}</div>
            </div>
            <div className={styles.dimCell}>
              <div className={styles.k}>
                <Math tex={"Pe=\\dfrac{u_a L}{D}"} />
              </div>
              <div className={styles.v}>{m.Pe.toPrecision(3)}</div>
            </div>
            <div className={styles.dimCell}>
              <div className={styles.k}>
                <Math tex={"\\phi=L\\sqrt{\\tfrac{\\rho q_{max}}{D K_m}}"} />
              </div>
              <div className={styles.v}>{m.phi.toPrecision(3)}</div>
            </div>
            <div className={styles.dimCell}>
              <div className={styles.k}>
                <Math tex={"\\kappa=\\dfrac{C_0}{K_m}"} />
              </div>
              <div className={styles.v}>{m.kappa.toPrecision(3)}</div>
            </div>
          </div>
          <div className={styles.note}>
            Pe は流体移流の強さ。薄水層モードでは Pe=0 でも Robin 境界による外面の溶質交換は起こり得ます。
          </div>
        </section>

        {/* 3. 数値解の指標 */}
        <section className={styles.col}>
          <div className={styles.colLabel}>数値解（Michaelis–Menten）の指標</div>
          <div className={styles.grid}>
            <div className={styles.cell}>
              <span className={styles.k}>浸透深さ r_p − a</span>
              <span className={styles.v}>
                {mToUm(m.penetrationDepth).toFixed(0)} <small>µm</small>
              </span>
            </div>
            <div className={styles.cell}>
              <span className={styles.k}>生存体積率</span>
              <span className={styles.v}>{(m.survivalFraction * 100).toFixed(1)}%</span>
            </div>
            <div className={styles.cell}>
              <span className={styles.k}>最小濃度</span>
              <span className={styles.v}>
                {siToMM(m.minConc).toPrecision(2)} <small>mM</small>
              </span>
            </div>
            <div className={styles.cell}>
              <span className={styles.k}>壊死前縁 r_p（数値）</span>
              <span className={styles.v}>
                {m.necrosisRadius != null ? mToUm(m.necrosisRadius).toFixed(0) : "—"} <small>µm</small>
              </span>
            </div>
          </div>
          <div className={m.hasNecroticCore ? `${styles.flag} ${styles.flagBad}` : `${styles.flag} ${styles.flagOk}`}>
            {m.hasNecroticCore
              ? `⚠ 壊死コアあり（壊死境界 r ≈ ${mToUm(m.necrosisRadius!).toFixed(0)} µm）`
              : "✓ 壊死コアなし（全域が壊死閾値以上）"}
          </div>
          {m.hypoxiaThresh != null && (
            <div
              className={`${styles.flag} ${m.hasHypoxicCore ? styles.flagBad : styles.flagOk}`}
            >
              {m.hasHypoxicCore
                ? `△ 低酸素域あり（低酸素境界 r ≈ ${mToUm(m.hypoxiaRadius!).toFixed(0)} µm）`
                : "✓ 低酸素域なし"}
            </div>
          )}
        </section>

        {/* 4. 補足ノート（消費は常に MM） */}
        <section className={styles.col}>
          <div className={styles.note}>
            消費は Michaelis–Menten で計算。壊死前縁は
            {params.species === "O2"
              ? " 壊死閾値 C_necrosis（既定 0.003 mM≈2.3 mmHg）"
              : " 枯渇閾値 0.1·K_m"}
            で判定。Da &gt; 2 が壊死コア発生の目安（平板片側灌流）。
          </div>
        </section>
      </div>
    </div>
  );
}
