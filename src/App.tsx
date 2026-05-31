/**
 * App — Chikuwa Perfusion Simulator
 * ちくわ型（中央ルーメンから径方向灌流される中空円柱）組織の酸素・グルコース
 * 拡散と細胞消費を可視化する。上部コントロール + 3パネル横並び。
 */
import { useEffect, useMemo, useState } from "react";
import { PRESETS, outerRadius, hasPerfusion, SCENARIOS, applyScenario, matchScenario } from "./solver/presets";
import { computeMetrics, firstCrossingRadius } from "./solver/metrics";
import { solveSteadyProfile } from "./solver/pde";
import { N_DEFAULT } from "./solver/grid";
import type { ConcUnit } from "./solver/units";
import { useSimulation } from "./hooks/useSimulation";
import { Controls } from "./components/Controls";
import { Heatmap } from "./components/Heatmap";
import { RadialProfile } from "./components/RadialProfile";
import { Metrics } from "./components/Metrics";
import { TimeSeries } from "./components/TimeSeries";
import { Explainer } from "./components/Explainer";
import { Footer } from "./components/Footer";
import styles from "./App.module.css";

export default function App() {
  const sim = useSimulation(PRESETS.O2);

  // 選択半径 r_sel [m]（ヒートマップ click / 距離スライダー / プロファイルカーソルの
  // 共有 state。どれを動かしても他が追従する単一の真実）。初期は中間半径。
  const [rSel, setRSel] = useState(() => PRESETS.O2.a + PRESETS.O2.L / 2);
  // 形状(a,L)変更で r_sel が [a,b] を外れたらクランプ
  useEffect(() => {
    setRSel((r) => Math.max(sim.params.a, Math.min(outerRadius(sim.params), r)));
  }, [sim.params]);

  // 表示モード（講義=最小UI / 詳細=全UI）。計算は常に完全、表示だけ絞る。
  const [uiMode, setUiMode] = useState<"lecture" | "detail">("lecture");

  // 濃度表示単位（O2 のみ mmHg 切替可。講義モードとグルコースは常に mM）
  const [concUnit, setConcUnit] = useState<ConcUnit>("mM");
  const effUnit: ConcUnit =
    uiMode === "lecture" || sim.params.species !== "O2" ? "mM" : concUnit;

  // シナリオ適用（Params 一括設定 → setParams が過渡を t=0 にリスタート）
  const activeScenario = matchScenario(sim.params);
  const applyScenarioById = (id: string) => sim.setParams(applyScenario(sim.params, id));

  const metrics = useMemo(
    () => computeMetrics(sim.params, sim.grid, sim.field),
    [sim.params, sim.grid, sim.field],
  );

  // ゼロ次参照プロファイル: 現在の境界条件のままゼロ次定常を数値的に解く（BC整合）。
  // MM のときも比較基準として表示し、両者を混同しないよう別ラベルにする。
  const zeroOrderRef = useMemo(() => {
    const f = solveSteadyProfile({ ...sim.params, reaction: "zero" }, N_DEFAULT).field.slice();
    for (let i = 0; i < f.length; i++) if (f[i] < 0) f[i] = 0;
    return f;
  }, [sim.params]);

  // ゼロ次参照の壊死前縁（同じ閾値で評価）
  const zeroOrderNecrosisRadius = useMemo(
    () => firstCrossingRadius(sim.grid, zeroOrderRef, metrics.threshold),
    [sim.grid, zeroOrderRef, metrics.threshold],
  );

  // 灌流が実際に効くとき（外面流出可＋ΔP>0）のみ「拡散のみ(ΔP=0)」定常を比較表示。
  const diffusionOnlyRef = useMemo(() => {
    if (!hasPerfusion(sim.params)) return null;
    const f = solveSteadyProfile({ ...sim.params, deltaP: 0 }, N_DEFAULT).field.slice();
    for (let i = 0; i < f.length; i++) if (f[i] < 0) f[i] = 0;
    return f;
  }, [sim.params]);

  return (
    <div className={`${styles.app} ${uiMode === "lecture" ? styles.lecture : ""}`}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <h1>3D tissue perfusion Simulator</h1>
          <div className={styles.modeToggle}>
            {(
              [
                ["lecture", "講義モード"],
                ["detail", "詳細モード"],
              ] as ["lecture" | "detail", string][]
            ).map(([m, label]) => (
              <button key={m} className={uiMode === m ? styles.modeOn : ""} onClick={() => setUiMode(m)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p>
          中央ルーメンから径方向に灌流される中空円柱（ちくわ型）組織の、酸素・グルコース
          拡散と細胞消費。軸対称・径方向1D の反応拡散方程式を陰的時間積分（後退Euler・L安定）で解きます。
        </p>
      </header>

      {/* シナリオプリセット（演習問題） */}
      <div className={styles.scenarios}>
        <span className={styles.scenariosLabel}>シナリオ:</span>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={activeScenario === s.id ? styles.scenarioOn : ""}
            title={s.hint}
            onClick={() => applyScenarioById(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <Controls
        params={sim.params}
        onParams={sim.setParams}
        uiMode={uiMode}
        playing={sim.playing}
        t={sim.t}
        residual={sim.residual}
        onPlay={sim.play}
        onPause={sim.pause}
        onStep={sim.stepOnce}
        onReset={sim.reset}
        onSteady={sim.solveSteady}
        rSel={rSel}
        onSelectRadius={setRSel}
        concUnit={concUnit}
        onConcUnit={setConcUnit}
      />

      <div className={styles.panels}>
        <div className={styles.panel}>
          <Heatmap
            grid={sim.grid}
            field={sim.field}
            params={sim.params}
            necrosisRadius={metrics.necrosisRadius}
            rSel={rSel}
            onSelectRadius={setRSel}
          />
        </div>
        <div className={styles.panel}>
          <RadialProfile
            grid={sim.grid}
            field={sim.field}
            steadyField={sim.steadyField}
            zeroOrderRef={zeroOrderRef}
            params={sim.params}
            threshold={metrics.threshold}
            hypoxiaThresh={metrics.hypoxiaThresh}
            necrosisRadius={metrics.necrosisRadius}
            hypoxiaRadius={metrics.hypoxiaRadius}
            snapshots={sim.snapshots}
            rSel={rSel}
            onSelectRadius={setRSel}
            diffusionOnlyRef={diffusionOnlyRef}
            unit={effUnit}
          />
        </div>
      </div>

      <div className={styles.panel}>
        <TimeSeries
          frames={sim.frames}
          grid={sim.grid}
          rSel={rSel}
          params={sim.params}
          threshold={metrics.threshold}
          hypoxiaThresh={metrics.hypoxiaThresh}
          unit={effUnit}
        />
      </div>

      <div className={styles.panel}>
        <Metrics
          params={sim.params}
          metrics={metrics}
          zeroOrderNecrosisRadius={zeroOrderNecrosisRadius}
        />
      </div>

      <Explainer />
      <Footer />
    </div>
  );
}
