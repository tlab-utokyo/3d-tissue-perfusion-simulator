/**
 * TimeSeries — 選択半径 r_sel における時間-濃度グラフ C(r_sel, t)
 * frames[time][radius] から r_sel の列を線形補間で抽出して描画する。
 * 円対称なので「半径だけ」で曲線が決まる（角度に依らない）。
 * 低酸素/壊死の水平閾値ラインを引き、曲線が横切る時刻を注記する。
 */
import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { Params } from "../solver/presets";
import type { Grid } from "../solver/grid";
import { interpAtRadius } from "../solver/grid";
import type { Frame } from "../hooks/useSimulation";
import { mToUm, concToDisplay, type ConcUnit } from "../solver/units";
import styles from "./TimeSeries.module.css";

interface Props {
  frames: Frame[];
  grid: Grid;
  rSel: number; // 選択半径 [m]
  params: Params;
  threshold: number; // 壊死閾値 [mol/m^3]
  hypoxiaThresh: number | null; // 低酸素閾値 [mol/m^3]（O2のみ）
  unit: ConcUnit;
}

/** C(r_sel,t) が閾値 thr を初めて下回る時刻 [s]（無ければ null） */
function crossingTime(series: { t: number; cSI: number }[], thr: number): number | null {
  for (const p of series) if (p.cSI < thr) return p.t;
  return null;
}

export function TimeSeries({ frames, grid, rSel, params, threshold, hypoxiaThresh, unit }: Props) {
  const series = useMemo(
    () => frames.map((fr) => ({ t: fr.t, cSI: interpAtRadius(grid, fr.field, rSel) })),
    [frames, grid, rSel],
  );
  const data = useMemo(
    () => series.map((p) => ({ t: p.t, C: concToDisplay(p.cSI, unit) })),
    [series, unit],
  );

  const toY = (cSI: number) => concToDisplay(cSI, unit);
  const fmt = (cSI: number) => `${concToDisplay(cSI, unit).toPrecision(2)} ${unit}`;
  const enoughHistory = data.length >= 2;
  const hypoT = hypoxiaThresh != null ? crossingTime(series, hypoxiaThresh) : null;
  const necroT = crossingTime(series, threshold);

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>
        時間–濃度 C(r_sel, t) [{unit}] ・ 選択半径 r_sel = <b>{mToUm(rSel).toFixed(0)} µm</b>
        （円対称：角度に依らず半径だけで決まる）
      </div>
      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 24, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, "dataMax"]}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${Math.round(v)}`}
              label={{ value: "t [s]", position: "insideBottom", offset: -12, fontSize: 11 }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              width={56}
              domain={[0, "auto"]}
              label={{ value: `C [${unit}]`, angle: -90, position: "insideLeft", fontSize: 11 }}
            />
            <Tooltip
              formatter={(v) => [`${Number(v).toPrecision(3)} ${unit}`, "C"]}
              labelFormatter={(l) => `t = ${Number(l).toFixed(1)} s`}
            />
            <ReferenceLine
              y={toY(params.Km)}
              stroke="#7c3aed"
              strokeDasharray="5 4"
              label={{ value: "K_m", fontSize: 10, fill: "#7c3aed", position: "insideTopRight" }}
            />
            {hypoxiaThresh != null && (
              <ReferenceLine
                y={toY(hypoxiaThresh)}
                stroke="#f59e0b"
                strokeDasharray="6 3"
                label={{ value: `低酸素 (${fmt(hypoxiaThresh)})`, fontSize: 10, fill: "#b45309", position: "insideTopLeft" }}
              />
            )}
            <ReferenceLine
              y={toY(threshold)}
              stroke="#e11d48"
              strokeDasharray="6 3"
              label={{
                value: params.species === "O2" ? `壊死 (${fmt(threshold)})` : `枯渇 (${fmt(threshold)})`,
                fontSize: 10,
                fill: "#e11d48",
                position: "insideBottomLeft",
              }}
            />
            {/* 閾値を横切る時刻の縦線 */}
            {hypoT != null && <ReferenceLine x={hypoT} stroke="#f59e0b" strokeDasharray="3 3" />}
            {necroT != null && <ReferenceLine x={necroT} stroke="#e11d48" strokeDasharray="3 3" />}
            <Line
              dataKey="C"
              name="C(r_sel, t)"
              stroke="#f97316"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.hint}>
        {!enoughHistory
          ? "▶ 再生 / ステップ で時間を進めると、この半径の濃度履歴が描かれます。"
          : [
              hypoT != null ? `t=${hypoT.toFixed(0)}s で低酸素に到達` : null,
              necroT != null ? `t=${necroT.toFixed(0)}s で壊死に到達` : null,
            ]
              .filter(Boolean)
              .join(" ・ ") || "この半径では閾値を下回りません（生存域）。"}
      </div>
    </div>
  );
}
