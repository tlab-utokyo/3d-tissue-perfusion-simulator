/**
 * RadialProfile — 径方向濃度プロファイル C(r)（recharts）
 * x=r [µm], y=C [mM]。定常解を破線で重ね描き、K_m と壊死閾値を参照線、
 * 壊死域を ReferenceArea でシェーディング、過渡スナップショットを薄線で表示。
 */
import { useMemo, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { Params } from "../solver/presets";
import type { Grid } from "../solver/grid";
import type { Snapshot } from "../hooks/useSimulation";
import { mToUm, umToM, concToDisplay, type ConcUnit } from "../solver/units";
import styles from "./RadialProfile.module.css";

interface Props {
  grid: Grid;
  field: Float64Array;
  steadyField: Float64Array;
  zeroOrderRef: Float64Array; // ゼロ次解析（クランプ済み）参照
  params: Params;
  threshold: number; // 壊死閾値 [mol/m^3]
  hypoxiaThresh: number | null; // 低酸素閾値 [mol/m^3]（O2のみ, null=非表示）
  necrosisRadius: number | null; // 壊死境界 [m]
  hypoxiaRadius: number | null; // 低酸素境界 [m]
  snapshots: Snapshot[];
  rSel: number; // 選択半径 [m]
  onSelectRadius: (r: number) => void;
  diffusionOnlyRef: Float64Array | null; // 灌流ON時の「拡散のみ(ΔP=0)」比較
  unit: ConcUnit; // 濃度表示単位（mM / mmHg）
  showZeroRef: boolean; // ゼロ次（消費一定）参照を表示するか（詳細モードのみ）
}

export function RadialProfile({
  grid,
  field,
  steadyField,
  zeroOrderRef,
  params,
  threshold,
  hypoxiaThresh,
  necrosisRadius,
  hypoxiaRadius,
  snapshots,
  rSel,
  onSelectRadius,
  diffusionOnlyRef,
  unit,
  showZeroRef,
}: Props) {
  const toY = (cSI: number) => concToDisplay(cSI, unit);
  const fmt = (cSI: number) => `${concToDisplay(cSI, unit).toPrecision(2)} ${unit}`;
  const dragging = useRef(false);
  // recharts のイベント state から x(=r[µm]) を取り出し、[a,b] にクランプして選択
  const pick = (state: { activeLabel?: string | number } | null) => {
    const xv = state?.activeLabel;
    if (xv == null) return;
    const um = typeof xv === "number" ? xv : parseFloat(xv);
    if (Number.isNaN(um)) return;
    const r = Math.max(grid.a, Math.min(grid.b, umToM(um)));
    onSelectRadius(r);
  };
  const data = useMemo(() => {
    return Array.from({ length: grid.N }, (_, i) => {
      const row: Record<string, number> = {
        r: mToUm(grid.r[i]),
        C: toY(field[i]),
        steady: toY(steadyField[i]),
      };
      if (showZeroRef) row.zero = toY(zeroOrderRef[i]);
      if (diffusionOnlyRef) row.diffOnly = toY(diffusionOnlyRef[i]);
      snapshots.forEach((s, k) => {
        row[`s${k}`] = toY(s.field[i]);
      });
      return row;
    });
  }, [grid, field, steadyField, zeroOrderRef, diffusionOnlyRef, snapshots, unit, showZeroRef]);

  const aUm = Math.round(mToUm(grid.a));
  const bUm = Math.round(mToUm(grid.b));
  const kmY = toY(params.Km);
  const necroUm = necrosisRadius != null ? mToUm(necrosisRadius) : null;
  const hypoUm = hypoxiaRadius != null ? mToUm(hypoxiaRadius) : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>
        径方向プロファイル C(r) [{unit}] — 実線:現在 / 破線:定常
        {showZeroRef ? " / 点線:ゼロ次（消費一定）" : ""}
      </div>
      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 10, right: 24, bottom: 28, left: 8 }}
            style={{ cursor: "ew-resize" }}
            onClick={pick}
            onMouseDown={(s) => {
              dragging.current = true;
              pick(s);
            }}
            onMouseMove={(s) => {
              if (dragging.current) pick(s);
            }}
            onMouseUp={() => {
              dragging.current = false;
            }}
            onMouseLeave={() => {
              dragging.current = false;
            }}
          >
            <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
            <XAxis
              dataKey="r"
              type="number"
              domain={[aUm, bUm]}
              tickCount={6}
              allowDecimals={false}
              tickFormatter={(v) => `${Math.round(v)}`}
              tick={{ fontSize: 11 }}
              label={{ value: "r [µm]", position: "insideBottom", offset: -16, fontSize: 11 }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              width={56}
              label={{ value: `C [${unit}]`, angle: -90, position: "insideLeft", fontSize: 11 }}
            />
            <Tooltip
              formatter={(v, name) => [`${Number(v).toPrecision(3)} ${unit}`, name]}
              labelFormatter={(l) => `r = ${Number(l).toFixed(0)} µm`}
            />
            <Legend verticalAlign="top" height={26} wrapperStyle={{ fontSize: 11 }} />

            {/* ゾーン塗り分け（同じ閾値変数を共有）: 低酸素帯=薄オレンジ, 壊死帯=薄赤 */}
            {hypoUm != null && (
              <ReferenceArea x1={hypoUm} x2={bUm} fill="#f59e0b" fillOpacity={0.07} />
            )}
            {necroUm != null && (
              <ReferenceArea x1={necroUm} x2={bUm} fill="#e11d48" fillOpacity={0.1} />
            )}

            {/* 選択半径 r_sel の縦カーソル（クリック/ドラッグで移動） */}
            <ReferenceLine
              x={mToUm(rSel)}
              stroke="#f97316"
              strokeWidth={1.5}
              label={{ value: "r_sel", fontSize: 10, fill: "#f97316", position: "top" }}
            />

            {/* K_m（代謝飽和）水平線 */}
            <ReferenceLine
              y={kmY}
              stroke="#7c3aed"
              strokeDasharray="5 4"
              label={{ value: "K_m (代謝飽和)", fontSize: 10, fill: "#7c3aed", position: "insideTopLeft" }}
            />
            {/* 低酸素ライン（O2のみ） */}
            {hypoxiaThresh != null && (
              <ReferenceLine
                y={toY(hypoxiaThresh)}
                stroke="#f59e0b"
                strokeDasharray="6 3"
                label={{ value: `低酸素 (${fmt(hypoxiaThresh)})`, fontSize: 10, fill: "#b45309", position: "insideTopRight" }}
              />
            )}
            {/* 壊死ライン（O2: 生理値 / グルコース: 枯渇閾値） */}
            <ReferenceLine
              y={toY(threshold)}
              stroke="#e11d48"
              strokeDasharray="6 3"
              label={{
                value: params.species === "O2" ? `壊死 (${fmt(threshold)})` : `枯渇 (${fmt(threshold)})`,
                fontSize: 10,
                fill: "#e11d48",
                position: "insideBottomRight",
              }}
            />
            {/* 低酸素境界・壊死境界の縦補助線 */}
            {hypoUm != null && (
              <ReferenceLine
                x={hypoUm}
                stroke="#f59e0b"
                strokeDasharray="3 3"
                label={{ value: `低酸素境界 ${hypoUm.toFixed(0)}µm`, fontSize: 9, fill: "#b45309", position: "insideTopLeft" }}
              />
            )}
            {necroUm != null && (
              <ReferenceLine
                x={necroUm}
                stroke="#e11d48"
                label={{ value: `壊死境界 ${necroUm.toFixed(0)}µm`, fontSize: 9, fill: "#e11d48", position: "insideBottomLeft" }}
              />
            )}

            {/* 過渡スナップショット（薄線） */}
            {snapshots.map((_, k) => (
              <Line
                key={`s${k}`}
                dataKey={`s${k}`}
                stroke="#9ca3af"
                strokeWidth={1}
                strokeOpacity={0.35}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
            ))}

            {/* 拡散のみ(ΔP=0) 比較（灌流ON時のみ・灰破線） */}
            {diffusionOnlyRef && (
              <Line
                dataKey="diffOnly"
                name="拡散のみ (ΔP=0)"
                stroke="#94a3b8"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {/* ゼロ次（消費一定）参照・点線（詳細モードのみ） */}
            {showZeroRef && (
              <Line
                dataKey="zero"
                name="ゼロ次（消費一定）"
                stroke="#a855f7"
                strokeDasharray="2 3"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {/* 定常（数値・破線） */}
            <Line
              dataKey="steady"
              name="定常（数値）"
              stroke="#2d708e"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            {/* 現在（実線） */}
            <Line
              dataKey="C"
              name="現在 C(r)"
              stroke="#1f968b"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.hint}>
        薄い灰線 = 過渡スナップショット。
        {params.species === "O2"
          ? "薄オレンジ帯 = 低酸素域 / 薄赤帯 = 壊死域（閾値はスライダーで可変）。"
          : "薄赤帯 = 枯渇域（C < 0.1·K_m）。"}
      </div>
    </div>
  );
}
