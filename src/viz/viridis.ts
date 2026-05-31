/**
 * viridis.ts — viridis カラーマップ（matplotlib viridis を 20 点サンプリングして線形補間）
 *
 * viridis(t):  t∈[0,1] → [r,g,b] (0..255)
 * 知覚的に均一・色覚多様性に配慮したカラーマップ。濃度ヒートマップに使用。
 */

// matplotlib viridis を 20 段で抜粋（0 → 1）
const STOPS: [number, number, number][] = [
  [68, 1, 84],
  [72, 21, 103],
  [72, 38, 119],
  [69, 55, 129],
  [64, 71, 136],
  [57, 86, 140],
  [51, 99, 141],
  [45, 112, 142],
  [40, 125, 142],
  [35, 138, 141],
  [31, 150, 139],
  [32, 163, 135],
  [41, 175, 127],
  [60, 187, 117],
  [86, 198, 103],
  [116, 208, 85],
  [148, 216, 64],
  [184, 222, 41],
  [220, 227, 25],
  [253, 231, 37],
];

/** t∈[0,1] → [r,g,b] (0..255) */
export function viridis(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const n = STOPS.length - 1;
  const f = x * n;
  const i = Math.min(n - 1, Math.floor(f));
  const frac = f - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

/** 256 段の LUT (Uint8 RGB, length 256*3) を生成 */
export function viridisLUT(size = 256): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(size * 3);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = viridis(i / (size - 1));
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}

/** CSS rgb 文字列 */
export function viridisCss(t: number): string {
  const [r, g, b] = viridis(t);
  return `rgb(${r},${g},${b})`;
}
