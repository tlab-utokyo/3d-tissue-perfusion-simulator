/**
 * Heatmap — 環状組織断面のヒートマップ（Canvas 2D）
 * viridis で濃度を表示。中央ルーメンは別色。壊死域を輪郭線で囲む。右にカラーバー。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Params } from "../solver/presets";
import { hasPerfusion } from "../solver/presets";
import type { Grid } from "../solver/grid";
import { siToMM } from "../solver/units";
import { viridis, viridisCss } from "../viz/viridis";
import styles from "./Heatmap.module.css";

interface Props {
  grid: Grid;
  field: Float64Array;
  params: Params;
  necrosisRadius: number | null; // [m]
  rSel: number; // 選択半径 [m]
  onSelectRadius: (r: number) => void;
}

const SIZE = 300;
const LUMEN_COLOR = "#cfe3ee"; // ルーメン（灌流液）
const SEL_COLOR = "#f97316"; // 選択半径ガイド（オレンジ）
const PADDING = 8;

export function Heatmap({ grid, field, params, necrosisRadius, rSel, onSelectRadius }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const C0 = params.C0;
  // マーカーの角度（クリック位置を記憶。スライダー操作時は前回角度を維持）
  const [markerAngle, setMarkerAngle] = useState(-Math.PI / 2);

  // クリック → 中心からの距離 r を計算して [a,b] にクランプし選択（円対称: 角度は無関係）
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - SIZE / 2; // CSS px, 中心基準
    const y = e.clientY - rect.top - SIZE / 2;
    const rPxCss = Math.sqrt(x * x + y * y);
    const rOuterPxCss = SIZE / 2 - PADDING;
    const pxPerMCss = rOuterPxCss / grid.b;
    const rPhys = rPxCss / pxPerMCss;
    const clamped = Math.max(grid.a, Math.min(grid.b, rPhys));
    setMarkerAngle(Math.atan2(y, x));
    onSelectRadius(clamped);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // putImageData は変換行列を無視するため、全面デバイスピクセルで描画する
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(SIZE * dpr);
    canvas.width = W;
    canvas.height = W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);

    const cx = W / 2;
    const cy = W / 2;
    const rOuterPx = W / 2 - PADDING * dpr;
    const { a, b, dr } = grid;
    const pxPerM = rOuterPx / b;

    const img = ctx.createImageData(W, W);
    const data = img.data;

    const sampleField = (rr: number): number => {
      const pos = (rr - a) / dr;
      const i = Math.max(0, Math.min(grid.N - 2, Math.floor(pos)));
      const f = pos - i;
      return field[i] * (1 - f) + field[i + 1] * f;
    };

    for (let py = 0; py < W; py++) {
      for (let px = 0; px < W; px++) {
        const dx = px - cx;
        const dy = py - cy;
        const rPx = Math.sqrt(dx * dx + dy * dy);
        const idx = (py * W + px) * 4;
        const rr = rPx / pxPerM; // 物理半径 [m]
        if (rPx > rOuterPx) {
          data[idx + 3] = 0; // 透明（円の外）
          continue;
        }
        let r: number, g: number, bl: number;
        if (rr < a) {
          // ルーメン
          r = 0xcf;
          g = 0xe3;
          bl = 0xee;
        } else {
          const c = sampleField(rr);
          const t = Math.max(0, Math.min(1, c / C0));
          [r, g, bl] = viridis(t);
        }
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = bl;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // 壊死前縁の輪郭線（破線の赤）
    if (necrosisRadius != null) {
      ctx.beginPath();
      ctx.arc(cx, cy, necrosisRadius * pxPerM, 0, Math.PI * 2);
      ctx.strokeStyle = "#e11d48";
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ルーメン壁 a の輪郭（細い白）
    ctx.beginPath();
    ctx.arc(cx, cy, a * pxPerM, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();

    // 選択半径 r_sel の同心円ガイド（円対称の明示）＋マーカー小円
    const rSelPx = Math.max(a, Math.min(b, rSel)) * pxPerM;
    ctx.beginPath();
    ctx.arc(cx, cy, rSelPx, 0, Math.PI * 2);
    ctx.strokeStyle = SEL_COLOR;
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([2 * dpr, 3 * dpr]);
    ctx.stroke();
    ctx.setLineDash([]);
    const mx = cx + rSelPx * Math.cos(markerAngle);
    const my = cy + rSelPx * Math.sin(markerAngle);
    ctx.beginPath();
    ctx.arc(mx, my, 5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = SEL_COLOR;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    // 灌流(移流)の流れ場: 外向き径方向の矢印を薄く重ねる（ΔP>0 のとき）
    if (hasPerfusion(params)) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.2 * dpr;
      const nArrows = 12;
      const r0 = (a + (b - a) * 0.3) * pxPerM;
      const r1 = (a + (b - a) * 0.62) * pxPerM;
      const head = 4 * dpr;
      for (let j = 0; j < nArrows; j++) {
        const ang = (2 * Math.PI * j) / nArrows;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const x0 = cx + r0 * ca;
        const y0 = cy + r0 * sa;
        const x1 = cx + r1 * ca;
        const y1 = cy + r1 * sa;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        // 矢じり（外向き）
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * (ca * 0.7 - sa * 0.7), y1 - head * (sa * 0.7 + ca * 0.7));
        ctx.lineTo(x1 - head * (ca * 0.7 + sa * 0.7), y1 - head * (sa * 0.7 - ca * 0.7));
        ctx.closePath();
        ctx.fill();
      }
    }
  }, [grid, field, C0, necrosisRadius, rSel, markerAngle, params]);

  // カラーバー目盛り（mM）
  const ticks = useMemo(() => {
    const c0mM = siToMM(C0);
    return [1, 0.75, 0.5, 0.25, 0].map((f) => (c0mM * f).toPrecision(2));
  }, [C0]);

  const gradient = useMemo(() => {
    const stops: string[] = [];
    for (let i = 0; i <= 10; i++) stops.push(`${viridisCss(i / 10)} ${i * 10}%`);
    return `linear-gradient(to top, ${stops.join(",")})`;
  }, []);

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>断面ヒートマップ — 濃度分布</div>
      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width: SIZE, height: SIZE, cursor: "crosshair" }}
          onClick={handleClick}
        />
        <div className={styles.bar}>
          <div className={styles.barLabel}>mM</div>
          <div className={styles.barTrack} style={{ background: gradient }}>
            <div className={styles.barTicks}>
              {ticks
                .slice()
                .reverse()
                .map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
            </div>
          </div>
        </div>
      </div>
      <div className={styles.legend}>
        <span>
          <i className={styles.swatch} style={{ background: LUMEN_COLOR }} /> ルーメン（灌流）
        </span>
        <span>
          <i className={styles.swatch} style={{ background: viridisCss(1) }} /> 高濃度
        </span>
        <span>
          <i className={styles.swatch} style={{ background: viridisCss(0) }} /> 低濃度
        </span>
        <span>
          <i className={styles.swatch} style={{ background: "#e11d48" }} /> 壊死前縁
        </span>
        <span>
          <i className={styles.swatch} style={{ background: SEL_COLOR }} /> 選択半径（クリックで移動）
        </span>
      </div>
    </div>
  );
}
