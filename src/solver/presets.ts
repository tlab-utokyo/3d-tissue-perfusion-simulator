/**
 * presets.ts — シミュレーションパラメータ型と物質プリセット
 *
 * Params はすべて SI 単位（m, s, mol/m^3, cells/m^3）で保持する。
 * UI 側は µm / mM / cells/mL を表示し、units.ts で相互変換する。
 */

import { umToM, mMToSI, cellsPerMlToSI } from "./units";

export type Species = "O2" | "Glucose";
/**
 * r=b の外側境界（局所1D径方向モデルの外面）:
 *  - bath            培地浴: 大きな培地リザーバ。溶質 Dirichlet C(b)=C0、流体 open
 *  - noflux          完全封止: 物質も流体も出ない理想。溶質 Neumann、流体なし(leakiness=0)
 *  - thin_water_layer 薄水層: 薄い水層を介し有限の物質移動で外部と交換。溶質 Robin、流体ほぼなし
 *  - air             空気接触: O2 は空気平衡 Dirichlet、Glucose は供給なし(outflow)。流体 open
 *  - leaky           微小漏れ: 流体が一部だけ外へ漏れる。Darcy 流に 0..1 の漏れ係数
 */
export type OuterBC = "bath" | "noflux" | "thin_water_layer" | "air" | "leaky";
export type Reaction = "zero" | "mm"; // ゼロ次 / Michaelis–Menten
/** 薄水層 Robin の外部参照濃度 C_ext の指定方法 */
export type CextMode = "zero" | "C0" | "air" | "custom";

/** すべて SI 単位 */
export interface Params {
  species: Species;
  D: number; // 拡散係数 [m^2/s]
  C0: number; // ルーメン濃度（内面 r=a の Dirichlet） [mol/m^3]
  Cmedium: number; // 培養液（外界）濃度（培地浴の外面 r=b の Dirichlet）。C0 とは独立 [mol/m^3]
  Km: number; // Michaelis 定数 [mol/m^3]
  qmax: number; // 1細胞あたり最大取り込み [mol/cell/s]
  rho: number; // 細胞密度 [cells/m^3]
  a: number; // 内半径（ルーメン壁） [m]
  L: number; // 組織壁厚 [m]   （外半径 b = a + L）
  outerBC: OuterBC;
  reaction: Reaction;
  Cair: number; // 空気平衡濃度（空気接触・O2 の外面 Dirichlet 値） [mol/m^3]
  // O2 の生理閾値（編集可。低酸素ライン・壊死ライン・ゾーン塗りの単一の真実） [mol/m^3]
  Chypoxia: number; // 低酸素（既定 0.026 mM ≈ 20 mmHg）
  Cnecrosis: number; // 壊死（既定 0.003 mM ≈ 2.3 mmHg）
  // 灌流（局所断面でのルーメン内外圧差 ΔP_local 駆動の径方向濾過流＝移流）
  deltaP: number; // 局所ルーメン内外圧差 ΔP_local [Pa]
  kPerm: number; // 組織の透過率 κ [m^2]（記号衝突回避のため k_perm と命名）
  mu: number; // 培地粘性 μ [Pa·s]
  // 薄水層 Robin: -D∂C/∂r|_b = k_ext (C_b − C_ext)。溶質交換のみ（流体流出とは別物）
  kExt: number; // 外部薄水層を通した物質移動係数 [m/s]
  cExtMode: CextMode; // C_ext の指定（外部0 / C0 / 空気(O2) / カスタム）
  cExtCustom: number; // カスタム C_ext [mol/m^3]
  // 微小漏れモードの流体流出係数（Darcy 流に乗じる）。0..1
  leakiness: number;
}

/**
 * 外面の流体流出係数（hydraulic leakiness, 0..1）。Darcy 径方向濾過流に乗じる。
 *  - 培地浴 / 空気接触: 1（開放, full Darcy）
 *  - 完全封止 / 薄水層: 0（流体は出ない。薄水層は"溶質交換のみ"で流体流出ではない）
 *  - 微小漏れ: p.leakiness（0..1）
 * ※ leakiness は流体流出。薄水層 Robin の溶質交換(k_ext)とは独立に扱う。
 */
export function hydraulicLeakiness(p: Params): number {
  switch (p.outerBC) {
    case "bath":
    case "air":
      return 1;
    case "leaky":
      return Math.max(0, Math.min(1, p.leakiness));
    case "noflux":
    case "thin_water_layer":
    default:
      return 0;
  }
}

/** 外面から流体が出られるか（leakiness>0） */
export const allowsOutflow = (p: Params): boolean => hydraulicLeakiness(p) > 0;

/**
 * 壁面濾過速度（生の Darcy 値）u_a = (k_perm/μ)·ΔP_local/(a·ln(b/a))  [m/s]。ΔP≤0 で 0。
 */
function darcyUa(p: Params): number {
  if (p.deltaP <= 0 || p.kPerm <= 0) return 0;
  const b = p.a + p.L;
  return ((p.kPerm / p.mu) * p.deltaP) / (p.a * Math.log(b / p.a));
}

/**
 * 実効的な壁面濾過速度 [m/s] = hydraulicLeakiness · darcyUa。
 * 封止/薄水層では 0（u≡0）、培地浴/空気では full、微小漏れでは部分的。
 */
export function filtrationUa(p: Params): number {
  return hydraulicLeakiness(p) * darcyUa(p);
}

/** 径方向速度場 u(r) = u_a·a/r  [m/s]（円筒の質量保存より 1/r 減衰） */
export function velocityAt(p: Params, r: number): number {
  return (filtrationUa(p) * p.a) / r;
}

/** Péclet 数 Pe = u_a·L/D（移流/拡散比）。封止モードでは 0。 */
export function peclet(p: Params): number {
  return (filtrationUa(p) * p.L) / p.D;
}

/** 灌流（移流）が実際に有効か（ΔP>0 かつ 外面流出可） */
export const hasPerfusion = (p: Params): boolean => filtrationUa(p) > 0;

/**
 * 外側境界の溶質(濃度)の実効種別を解決する。
 *  - bath             → Dirichlet C(b)=C0
 *  - noflux           → Neumann ∂C/∂r=0
 *  - thin_water_layer → Robin  -D∂C/∂r=k_ext(C_b−C_ext)（薄水層を介した溶質交換）
 *  - air & O2         → Dirichlet C(b)=C_air（空気は酸素の巨大リザーバ）
 *  - air & Glucose    → outflow（空気に供給なし。流体流出があれば濾液とともに流出）
 *  - leaky            → outflow（流体が一部漏れ出る。移流は leakiness·Darcy）
 */
export type EffectiveOuterBC = "dirichlet" | "neumann" | "robin" | "outflow";
export function effectiveOuterBC(p: Params): EffectiveOuterBC {
  switch (p.outerBC) {
    case "bath":
      return "dirichlet";
    case "noflux":
      return "neumann";
    case "thin_water_layer":
      return "robin";
    case "leaky":
      return "outflow";
    case "air":
      return p.species === "O2" ? "dirichlet" : "outflow";
  }
}

/** Dirichlet 外面 r=b の固定値: 培地浴=培養液濃度 C_medium / 空気接触(O2)=C_air。
 *  ※ 内面 r=a は常にルーメン濃度 C0。外面は C0 とは独立（培養液の濃度）。 */
export function dirichletValue(p: Params): number {
  return p.outerBC === "air" && p.species === "O2" ? p.Cair : p.Cmedium;
}

/** 薄水層 Robin の外部参照濃度 C_ext [mol/m^3] を解決する（air は O2 のみ有効, 他は 0 扱い） */
export function cExtValue(p: Params): number {
  switch (p.cExtMode) {
    case "C0":
      return p.C0;
    case "air":
      return p.species === "O2" ? p.Cair : 0;
    case "custom":
      return p.cExtCustom;
    case "zero":
    default:
      return 0;
  }
}

/** 外半径 b = a + L */
export const outerRadius = (p: Params): number => p.a + p.L;

/** 体積ゼロ次消費率 R0 = ρ · q_max  [mol/(m^3·s)] */
export const R0 = (p: Params): number => p.rho * p.qmax;

/**
 * 物質プリセット（spec の表より、SI へ変換済み）。
 *   O2:      D=2.0e-9 m^2/s, C0=0.20 mM, Km=1e-3 mM, qmax=3e-17 mol/cell/s
 *   Glucose: D=0.7e-9 m^2/s, C0=5.0 mM,  Km=0.5 mM,  qmax=5e-17 mol/cell/s
 *   共通:    rho=1e8 cells/mL, a=200 µm, L=1000 µm
 */
const COMMON = {
  rho: cellsPerMlToSI(1e8),
  a: umToM(200),
  L: umToM(1000),
  outerBC: "bath" as OuterBC,
  reaction: "mm" as Reaction,
  // 空気接触(O2)の外面 Dirichlet 値 C_air=0.21 mM（空気飽和・37℃水溶液相当）。
  Cair: mMToSI(0.21),
  // O2 生理閾値（編集可）: 低酸素 0.026 mM(20 mmHg) / 壊死 0.003 mM(2.3 mmHg)
  Chypoxia: mMToSI(0.026),
  Cnecrosis: mMToSI(0.003),
  // 灌流。既定 ΔP_local=0（純拡散）。k_perm=1e-14 m²、μ=1e-3 Pa·s（水相当）。
  deltaP: 0,
  kPerm: 1e-14,
  mu: 1e-3,
  // 薄水層 Robin（既定は小さめの k_ext, 外部濃度 0）。微小漏れ係数 leakiness 既定 0.2。
  kExt: 1e-7,
  cExtMode: "zero" as CextMode,
  cExtCustom: mMToSI(0),
  leakiness: 0.2,
};

export const PRESETS: Record<Species, Params> = {
  O2: {
    species: "O2",
    D: 2.0e-9,
    C0: mMToSI(0.2),
    Cmedium: mMToSI(0.2), // 培養液の溶存O2（空気飽和 ≈0.2 mM）。C0 とは独立
    Km: mMToSI(1e-3),
    qmax: 3e-17,
    ...COMMON,
  },
  Glucose: {
    species: "Glucose",
    D: 0.7e-9,
    C0: mMToSI(5.0),
    Cmedium: mMToSI(5.0), // 培養液のグルコース濃度
    Km: mMToSI(0.5),
    qmax: 5e-17,
    ...COMMON,
  },
};

/**
 * 物質切替時のプリセット適用。
 * 形状(a,L)・密度(rho)・BC・反応律はユーザー設定を引き継ぎ、
 * 物性(D,C0,Km,qmax)のみ差し替える（spec「物質トグルでプリセット適用」）。
 */
export function applySpecies(current: Params, species: Species): Params {
  const base = PRESETS[species];
  return {
    ...current,
    species,
    D: base.D,
    C0: base.C0,
    Cmedium: base.Cmedium,
    Km: base.Km,
    qmax: base.qmax,
  };
}

/**
 * 細胞種プリセット（O2 の OCR=q_max と K_m）。
 * ⚠ 確定値ではなく文献ベースの「編集可能なたたき台」。選択後もスライダーで上書き可。
 * OCR は測定法・培養日数・酸素分圧・細胞密度・初代/株化で 2 桁以上変動する。
 */
export type Confidence = "measured" | "order"; // 実測 / オーダー推定

export interface CellType {
  name: string;
  qmaxO2: number; // O2 OCR [mol/cell/s]
  Km: number; // 半飽和濃度 [mol/m^3]
  confidence: Confidence;
  refNote: string; // ツールチップ用の出典メモ
  refs: number[]; // フッター文献番号
}

export const CELL_TYPES: CellType[] = [
  {
    name: "血管内皮",
    qmaxO2: 4e-18,
    Km: mMToSI(0.001),
    confidence: "order",
    refNote: "≈4 amol/cell/s。文献1の全体レンジからのオーダー推定（実測ピンポイントではない）",
    refs: [1],
  },
  {
    name: "筋芽細胞 (C2C12)",
    qmaxO2: 1e-17,
    Km: mMToSI(0.001),
    confidence: "order",
    refNote: "≈10 amol/cell/s。文献1の全体レンジからのオーダー推定",
    refs: [1],
  },
  {
    name: "皮膚線維芽細胞",
    qmaxO2: 1.2e-17,
    Km: mMToSI(0.001),
    confidence: "measured",
    refNote: "12 amol/cell/s。文献2（3D collagen での実測, 1.19e-17 mol/cell/s）",
    refs: [2],
  },
  {
    name: "肝細胞",
    qmaxO2: 5e-17,
    Km: mMToSI(0.003),
    confidence: "measured",
    refNote:
      "培養中央値 ≈50 amol/cell/s（文献5）。初代肝細胞は 200–400 amol/cell/s と高い（文献4）",
    refs: [4, 5],
  },
  {
    name: "神経細胞",
    qmaxO2: 2.5e-17,
    Km: mMToSI(0.001),
    confidence: "order",
    refNote: "≈25 amol/cell/s。文献1の全体レンジからのオーダー推定",
    refs: [1],
  },
];

const CELL_CUSTOM = "カスタム";
export const cellTypeNames = (): string[] => [...CELL_TYPES.map((c) => c.name), CELL_CUSTOM];

/** 現在の (q_max, K_m) に一致する細胞種名を返す。一致しなければ「カスタム」 */
export function matchCellType(p: Params): string {
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(b), 1e-300);
  const hit = CELL_TYPES.find((c) => close(p.qmax, c.qmaxO2) && close(p.Km, c.Km));
  return hit ? hit.name : CELL_CUSTOM;
}

/** 細胞種を適用（O2 の q_max と K_m を差し替え。他は保持） */
export function applyCellType(p: Params, name: string): Params {
  const ct = CELL_TYPES.find((c) => c.name === name);
  if (!ct) return p; // カスタム等は現在値を保持
  return { ...p, qmax: ct.qmaxO2, Km: ct.Km };
}

/** mol/cell/s → amol/cell/s（1 amol = 1e-18 mol） */
export const molPerCellToAmol = (q: number): number => q / 1e-18;

/**
 * 講義用シナリオプリセット（演習問題に対応）。ワンクリックで Params を一括設定する。
 * 計算ロジックは変更せず、applySpecies/applyCellType と同様に Params を作るだけ。
 */
export interface Scenario {
  id: string;
  label: string;
  hint: string;
}

export const SCENARIOS: Scenario[] = [
  { id: "thin", label: "① 薄い組織（健全）", hint: "O2・培地浴・筋芽細胞・L=200µm。壊死なし" },
  { id: "thick", label: "② 厚すぎる組織（壊死）", hint: "O2・培地浴・L=1800µm。壊死コア発生" },
  { id: "rescue", label: "③ 灌流で救う", hint: "②＋培地浴のまま ΔP=2000Pa。移流で浸透が深まり救済" },
  { id: "sealed", label: "④ 封止だと救えない ⚠", hint: "封止・L=1800µm・ΔP=2000Pa。u≡0 で ΔP=0 と同じ＝救われない" },
  { id: "glucose", label: "⑤ 酸素 vs グルコース", hint: "厚壁のままグルコースへ切替。浸透深を対比" },
];

/**
 * シナリオを適用して Params を返す（過渡は呼び出し側で t=0 にリセット）。
 * 細胞密度 ρ は既定(1e8 cells/mL)に固定する。これにより「手動で筋芽細胞を選んだ場合」と
 * 「シナリオで筋芽細胞を使う場合」で密度が一致し、同じグラフになる（密度違いの混乱を防ぐ）。
 * 厚壁で壊死を見せるのは密度ではなく壁厚 L=1800µm で行う。
 */
export function applyScenario(p: Params, id: string): Params {
  const myoblast = "筋芽細胞 (C2C12)";
  const stdRho = cellsPerMlToSI(1e8); // 既定密度に固定（再現性＋手動選択と一致）
  const o2 = (over: Partial<Params>): Params => {
    let q = applySpecies({ ...p, reaction: "mm" }, "O2");
    q = applyCellType(q, myoblast);
    return { ...q, rho: stdRho, ...over };
  };
  switch (id) {
    case "thin":
      return o2({ outerBC: "bath", L: umToM(200), deltaP: 0 });
    case "thick":
      return o2({ outerBC: "bath", L: umToM(1800), deltaP: 0 });
    case "rescue":
      return o2({ outerBC: "bath", L: umToM(1800), deltaP: 2000 });
    case "sealed":
      return o2({ outerBC: "noflux", L: umToM(1800), deltaP: 2000 });
    case "glucose": {
      const g = applySpecies({ ...p, reaction: "mm" }, "Glucose");
      return { ...g, rho: stdRho, outerBC: "bath", L: umToM(1800), deltaP: 0 };
    }
    default:
      return p;
  }
}

/** 現在の Params が一致するシナリオ id（ハイライト用, 無ければ null） */
export function matchScenario(p: Params): string | null {
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 + 1e-6 * Math.abs(b);
  for (const s of SCENARIOS) {
    const t = applyScenario(p, s.id);
    if (
      p.species === t.species &&
      p.outerBC === t.outerBC &&
      close(p.L, t.L) &&
      close(p.deltaP, t.deltaP) &&
      close(p.qmax, t.qmax) &&
      close(p.Km, t.Km) &&
      close(p.C0, t.C0) &&
      close(p.rho, t.rho)
    )
      return s.id;
  }
  return null;
}
