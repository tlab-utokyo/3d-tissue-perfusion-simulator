/**
 * Controls — 上部コントロールバー
 * 物質/外側BC/反応律トグル、各パラメータのスライダ+数値入力、時間制御 + 定常ソルブ。
 * 表示は µm / mM / cells/mL、内部 Params は SI（units.ts で変換）。
 */
import type { Params, Species, OuterBC } from "../solver/presets";
import {
  applySpecies,
  applyCellType,
  matchCellType,
  cellTypeNames,
  CELL_TYPES,
  filtrationUa,
  peclet,
  allowsOutflow,
  hydraulicLeakiness,
} from "../solver/presets";
import {
  mToUm,
  umToM,
  siToMM,
  mMToSI,
  siToCellsPerMl,
  cellsPerMlToSI,
  concToDisplay,
  mmHgToSI,
  type ConcUnit,
} from "../solver/units";
import styles from "./Controls.module.css";

interface Props {
  params: Params;
  onParams: (p: Params) => void;
  uiMode: "lecture" | "detail";
  playing: boolean;
  t: number;
  residual: number;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  onSteady: () => void;
  rSel: number; // 選択半径 [m]
  onSelectRadius: (r: number) => void;
  concUnit: ConcUnit;
  onConcUnit: (u: ConcUnit) => void;
}

interface SliderProps {
  name: string;
  unit: string;
  value: number; // 表示単位
  min: number;
  max: number;
  step?: number;
  log?: boolean;
  disabled?: boolean;
  onChange: (v: number) => void;
}

function Slider({ name, unit, value, min, max, step, log, disabled, onChange }: SliderProps) {
  // log スケール時はスライダ位置 0..1000 を対数補間する
  const toPos = (v: number) =>
    log ? (1000 * (Math.log(v) - Math.log(min))) / (Math.log(max) - Math.log(min)) : v;
  const fromPos = (pos: number) =>
    log ? Math.exp(Math.log(min) + (pos / 1000) * (Math.log(max) - Math.log(min))) : pos;

  return (
    <div className={styles.slider} style={disabled ? { opacity: 0.4 } : undefined}>
      <div className={styles.sliderHead}>
        <span className={styles.sliderName}>
          {name} <small>[{unit}]</small>
        </span>
        <input
          className={styles.numInput}
          type="number"
          disabled={disabled}
          value={Number(value.toPrecision(4))}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
        />
      </div>
      <input
        type="range"
        disabled={disabled}
        min={log ? 0 : min}
        max={log ? 1000 : max}
        step={log ? 1 : (step ?? (max - min) / 200)}
        value={toPos(value)}
        onChange={(e) => onChange(fromPos(parseFloat(e.target.value)))}
      />
    </div>
  );
}

export function Controls(props: Props) {
  const { params: p, onParams } = props;
  const set = (patch: Partial<Params>) => onParams({ ...p, ...patch });
  const currentCT = matchCellType(p);
  const ctInfo = CELL_TYPES.find((c) => c.name === currentCT);
  const thrUnit: ConcUnit = p.species === "O2" ? props.concUnit : "mM"; // 閾値スライダーの単位
  const sealed = !allowsOutflow(p); // 封止/無流束は出口が無く灌流が立たない（u≡0）
  const detail = props.uiMode === "detail"; // 詳細モードのみ表示する要素の判定

  return (
    <div className={styles.bar}>
      {/* トグル群 */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>物質</span>
        <div className={styles.toggle}>
          {(["O2", "Glucose"] as Species[]).map((s) => (
            <button
              key={s}
              className={p.species === s ? styles.on : ""}
              onClick={() => onParams(applySpecies(p, s))}
            >
              {s === "O2" ? "酸素 O₂" : "グルコース"}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>外側境界 (r=b)</span>
        <div className={styles.toggle}>
          {(
            [
              ["bath", "培地浴", "外面が大きな培地リザーバ。C(b)=C0、流体は外へ流出可"],
              ["noflux", "完全封止", "外面から物質も流体も出ない理想条件。∂C/∂r=0、流体流出なし"],
              ["thin_water_layer", "薄水層", "外面が薄い水層に覆われ、有限の物質移動係数 k_ext で外部と溶質交換（Robin）。流体流出はほぼなし"],
              ["air", "空気接触", "O2は空気平衡濃度 C_air に固定、グルコースは空気から供給なし"],
              ["leaky", "微小漏れ", "外面から流体が一部だけ漏れ出る。Darcy流に漏れ係数 0..1 を掛ける"],
            ] as [OuterBC, string, string][]
          )
            // 講義モードは 培地浴/完全封止/空気接触 の3つだけ（薄水層・微小漏れは詳細モード）
            .filter(([v]) => detail || v === "bath" || v === "noflux" || v === "air")
            .map(([v, label, tip]) => (
            <button
              key={v}
              className={p.outerBC === v ? styles.on : ""}
              title={tip}
              onClick={() => set({ outerBC: v })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 消費は常に Michaelis–Menten（ゼロ次設定は撤去） */}

      {/* 濃度表示単位（詳細モードのみ・O2 で mmHg 切替可。講義モードは mM 固定） */}
      {detail && (
        <div className={styles.group}>
          <span className={styles.groupLabel}>濃度単位</span>
          <div className={styles.toggle}>
            {(
              [
                ["mM", "mM"],
                ["mmHg", "mmHg"],
              ] as [ConcUnit, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                className={props.concUnit === v ? styles.on : ""}
                disabled={p.species !== "O2"}
                onClick={() => props.onConcUnit(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 細胞種プリセット（O2 の OCR=q_max と K_m） */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>細胞種（O₂ OCRプリセット・編集可）</span>
        <select
          className={styles.select}
          disabled={p.species !== "O2"}
          value={p.species === "O2" ? currentCT : ""}
          onChange={(e) => {
            const name = e.target.value;
            if (name !== "カスタム") onParams(applyCellType(p, name));
          }}
        >
          {p.species !== "O2" && <option value="">— グルコースは汎用値 —</option>}
          {cellTypeNames().map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {/* 信頼度バッジ・出典ノートは詳細モードのみ（講義モードは名前だけ） */}
        {detail &&
          (p.species !== "O2" ? (
            <span className={styles.cellNote}>細胞種プリセットは O₂ の OCR 用。グルコースは汎用 q_max を使用。</span>
          ) : ctInfo ? (
            <span className={styles.cellNote}>
              <span
                className={`${styles.badge} ${ctInfo.confidence === "measured" ? styles.badgeMeasured : styles.badgeOrder}`}
                title={ctInfo.refNote}
              >
                {ctInfo.confidence === "measured" ? "● 実測" : "○ オーダー推定"}
              </span>{" "}
              {ctInfo.refNote}{" "}
              {ctInfo.refs.map((r) => (
                <a key={r} href={`#ref${r}`}>
                  [{r}]
                </a>
              ))}
            </span>
          ) : (
            <span className={styles.cellNote}>
              カスタム値（スライダーで編集中）。代表値はドロップダウンで再適用できます。
            </span>
          ))}
      </div>

      {/* 時間制御 */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>時間</span>
        <div className={styles.time}>
          {props.playing ? (
            <button className={styles.primary} onClick={props.onPause}>
              ⏸ 一時停止
            </button>
          ) : (
            <button className={styles.play} onClick={props.onPlay}>
              ▶ 再生
            </button>
          )}
          {detail && <button onClick={props.onStep}>ステップ</button>}
          <button onClick={props.onReset}>リセット</button>
          <button onClick={props.onSteady}>定常ソルブ</button>
          <span className={styles.clock}>
            {Number.isFinite(props.t)
              ? `t = ${props.t.toFixed(1)} s ・ 定常まで残差 ${(props.residual * 100).toFixed(1)}%`
              : "定常状態"}
          </span>
        </div>
      </div>

      {/* スライダ群 */}
      <div className={styles.sliders}>
        {/* 内半径 a・壁厚 L・細胞密度 ρ・ΔP_local は講義モードでも表示 */}
        <Slider
          name="内半径 a"
          unit="µm"
          value={mToUm(p.a)}
          min={50}
          max={600}
          onChange={(v) => set({ a: umToM(v) })}
        />
        <Slider
          name="壁厚 L"
          unit="µm"
          value={mToUm(p.L)}
          min={50}
          max={3000}
          onChange={(v) => set({ L: umToM(v) })}
        />
        <Slider
          name="細胞密度 ρ"
          unit="×10⁶ cells/mL"
          value={siToCellsPerMl(p.rho) / 1e6}
          min={1}
          max={2000}
          log
          onChange={(v) => set({ rho: cellsPerMlToSI(v * 1e6) })}
        />
        {detail && (
          <>
        <Slider
          name="ルーメン濃度 C₀（内面 r=a）"
          unit="mM"
          value={siToMM(p.C0)}
          min={0.01}
          max={20}
          log
          onChange={(v) => set({ C0: mMToSI(v) })}
        />
        <Slider
          name="培養液濃度 C_medium（外面 r=b）"
          unit="mM"
          value={siToMM(p.Cmedium)}
          min={0.01}
          max={20}
          log
          disabled={p.outerBC !== "bath"}
          onChange={(v) => set({ Cmedium: mMToSI(v) })}
        />
        <Slider
          name="取り込み q_max"
          unit="mol/cell/s"
          value={p.qmax}
          min={1e-18}
          max={4e-16}
          log
          onChange={(v) => set({ qmax: v })}
        />
        <Slider
          name="K_m（半飽和濃度）"
          unit="mM"
          value={siToMM(p.Km)}
          min={1e-4}
          max={5}
          log
          onChange={(v) => set({ Km: mMToSI(v) })}
        />
        <Slider
          name="C_air（空気平衡O₂・外面固定値）"
          unit="mM"
          value={siToMM(p.Cair)}
          min={0.01}
          max={1}
          log
          disabled={!(p.species === "O2" && p.outerBC === "air")}
          onChange={(v) => set({ Cair: mMToSI(v) })}
        />
        <Slider
          name="低酸素ライン C_hypoxia"
          unit={thrUnit}
          value={concToDisplay(p.Chypoxia, thrUnit)}
          min={concToDisplay(mMToSI(0.001), thrUnit)}
          max={concToDisplay(mMToSI(0.15), thrUnit)}
          log
          disabled={p.species !== "O2"}
          onChange={(v) => set({ Chypoxia: thrUnit === "mmHg" ? mmHgToSI(v) : mMToSI(v) })}
        />
        <Slider
          name="壊死ライン C_necrosis"
          unit={thrUnit}
          value={concToDisplay(p.Cnecrosis, thrUnit)}
          min={concToDisplay(mMToSI(0.0003), thrUnit)}
          max={concToDisplay(mMToSI(0.05), thrUnit)}
          log
          disabled={p.species !== "O2"}
          onChange={(v) => set({ Cnecrosis: thrUnit === "mmHg" ? mmHgToSI(v) : mMToSI(v) })}
        />
        <Slider
          name="選択半径 r_sel"
          unit="µm"
          value={mToUm(props.rSel)}
          min={Math.round(mToUm(p.a))}
          max={Math.round(mToUm(p.a + p.L))}
          onChange={(v) => props.onSelectRadius(umToM(v))}
        />
          </>
        )}
        {/* 局所ルーメン圧差 ΔP_local は講義モードでも表示 */}
        <Slider
          name={sealed ? "内外圧力差 ΔP_local（無流出では効かない）" : "内外圧力差 ΔP_local"}
          unit="Pa"
          value={p.deltaP}
          min={0}
          max={5000}
          step={10}
          disabled={sealed}
          onChange={(v) => set({ deltaP: v })}
        />
        {detail && (
          <>
            <Slider
              name="透過率 k_perm"
              unit="m²"
              value={p.kPerm}
              min={1e-16}
              max={1e-12}
              log
              disabled={sealed}
              onChange={(v) => set({ kPerm: v })}
            />
            <Slider
              name="粘性 μ"
              unit="Pa·s"
              value={p.mu}
              min={1e-4}
              max={1e-2}
              log
              disabled={sealed}
              onChange={(v) => set({ mu: v })}
            />
          </>
        )}
        {/* 薄水層 Robin パラメータ（薄水層モードのみ有効） */}
        {p.outerBC === "thin_water_layer" && (
          <Slider
            name="物質移動係数 k_ext"
            unit="m/s"
            value={p.kExt}
            min={1e-9}
            max={1e-3}
            log
            onChange={(v) => set({ kExt: v })}
          />
        )}
        {/* 微小漏れ係数（微小漏れモードのみ有効） */}
        {p.outerBC === "leaky" && (
          <Slider
            name="漏れ係数 leakiness"
            unit="0–1"
            value={p.leakiness}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => set({ leakiness: v })}
          />
        )}
      </div>

      {/* 薄水層の外部参照濃度 C_ext 選択 */}
      {p.outerBC === "thin_water_layer" && (
        <div className={styles.group}>
          <span className={styles.groupLabel}>C_ext（薄水層側の参照濃度）</span>
          <select
            className={styles.select}
            value={p.cExtMode}
            onChange={(e) => set({ cExtMode: e.target.value as Params["cExtMode"] })}
          >
            <option value="zero">外部 0</option>
            <option value="C0">C0</option>
            {p.species === "O2" && <option value="air">空気 C_air</option>}
            <option value="custom">カスタム</option>
          </select>
          {p.cExtMode === "custom" && (
            <input
              className={styles.numInput}
              type="number"
              step="0.01"
              value={Number(siToMM(p.cExtCustom).toPrecision(4))}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) set({ cExtCustom: mMToSI(v) });
              }}
            />
          )}
        </div>
      )}

      {/* 灌流の状態表示 + 完全封止の警告 + モデルの前提 */}
      <div className={styles.group} style={{ flexBasis: "100%" }}>
        {detail ? (
          <span className={styles.cellNote}>
            灌流: 壁面濾過速度 u_a = <b>{filtrationUa(p).toExponential(2)}</b> m/s ・ Péclet 数 Pe ={" "}
            <b>{peclet(p).toFixed(2)}</b> ・ 流出係数 leakiness = <b>{hydraulicLeakiness(p).toFixed(2)}</b>
            {p.outerBC === "thin_water_layer"
              ? "（薄水層は溶質交換のみ。流体流出なし＝Pe=0 でも k_ext による外面交換はある）"
              : p.deltaP > 0 && p.outerBC === "leaky"
                ? "（微小漏れ：Darcy流に漏れ係数を掛けた弱い移流）"
                : p.deltaP > 0 && allowsOutflow(p)
                  ? "（ΔP_local>0：外面流出あり。移流が養分を外向きに運び浸透が深まる）"
                  : ""}
          </span>
        ) : (
          // 講義モードは灌流の状態を1文で
          <span className={styles.cellNote} style={{ fontSize: "0.95em" }}>
            {p.deltaP > 0 && p.outerBC === "noflux"
              ? "封止のため流れません（流すには出口が必要）"
              : p.deltaP > 0 && allowsOutflow(p)
                ? "灌流が養分を外へ運んでいます"
                : "拡散のみ"}
          </span>
        )}
        {p.deltaP > 0 && p.outerBC === "noflux" && (
          <span className={styles.cellNote} style={{ color: "var(--warn)" }}>
            ⚠ 完全封止モデルでは、出口がないため定常的な正味濾過流は 0 と仮定しています。圧力差そのものが
            存在しないという意味ではありません。実際には一過的な浸潤・組織変形・漏れ・透過率変化などが起こり得ます。
          </span>
        )}
        <span className={styles.cellNote} style={{ background: "var(--accent-weak)", padding: "8px 10px", borderRadius: 8, maxWidth: 720 }}>
          <b>モデルの前提</b>：このアプリは長い管全体ではなく、ある断面を切り出した
          <b>局所1D径方向モデル</b>です。管内の軸方向流れ、軸方向圧力低下 P_lumen(z)、管内濃度低下
          C_lumen(z) は明示的には解いていません。C(a)=C0 はルーメンが十分灌流され壁面濃度が保たれる近似。
          ΔP_local は選んだ断面でのルーメン内外圧差です。封止で ΔP_local が定常移流に効かないのは、
          完全封止・非圧縮流体・剛体組織・漏れなしを仮定しているためです。
        </span>
      </div>
    </div>
  );
}
