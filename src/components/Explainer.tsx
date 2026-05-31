/**
 * Explainer — 支配方程式の「理解できる」解説（各項=供給 vs 消費の綱引き）。
 */
import { useState } from "react";
import { Math } from "./Katex";
import styles from "./Explainer.module.css";

const TERMS: { tex: string; txt: string }[] = [
  {
    tex: "\\dfrac{\\partial C}{\\partial t}",
    txt: "その場所の濃度が時間とともにどう変化するか（過渡項）。",
  },
  {
    tex: "D\\,\\frac{1}{r}\\frac{\\partial}{\\partial r}\\!\\left(r\\frac{\\partial C}{\\partial r}\\right)",
    txt: "拡散で運ばれてくる供給。円筒座標の 1/r·∂/∂r(r…) が「外側ほど面積が広がる」効果を表す＝ちくわ形状の本質。",
  },
  {
    tex: "-\\,u(r)\\dfrac{\\partial C}{\\partial r}",
    txt: "灌流（移流）。内腔に圧力差 ΔP をかけると組織壁を径方向に濾過流 u(r)=u_a·a/r が生じ、養分を外向きに運ぶ。ΔP=0 なら u≡0 で純拡散。",
  },
  {
    tex: "-\\,R(C)",
    txt: "細胞が消費して減る分（細胞密度 ρ × 1細胞あたり取り込み）。MM では濃度が下がると取り込みが鈍る。",
  },
];

export function Explainer() {
  const [open, setOpen] = useState(true);
  return (
    <div className={styles.wrap}>
      <div className={styles.head} onClick={() => setOpen((o) => !o)}>
        <h3>支配方程式の読み方</h3>
        <Math tex={"\\partial_t C = D\\,\\tfrac{1}{r}\\partial_r(r\\,\\partial_r C) - u(r)\\partial_r C - R(C)"} />
        <span className={styles.toggle}>{open ? "▲ 閉じる" : "▼ 開く"}</span>
      </div>
      {open && (
        <div className={styles.body}>
          <div className={styles.terms}>
            {TERMS.map((t, i) => (
              <div className={styles.term} key={i}>
                <span className={styles.tex}>
                  <Math tex={t.tex} />
                </span>
                <span className={styles.txt}>{t.txt}</span>
              </div>
            ))}
          </div>
          <div className={styles.story}>
            全体は <b>ルーメンからの供給</b> と <b>組織の消費</b> の綱引きです。供給が勝てば
            栄養は外面まで届き全域が生存します。消費が勝つと深部（ルーメンから遠い側）が
            枯渇し <b>低酸素コア</b> が生じます。どちらが勝つかは無次元数{" "}
            <Math tex={"Da=R_0L^2/(DC_0)"} /> と Thiele 数 <Math tex={"\\phi"} /> が決め、
            目安は <Math tex={"Da\\gtrsim 2"} /> で壊死コアが出始めます。再生ボタンで、
            ルーメンから染み込んだ濃度の前縁が外向きに進み、定常分布（破線）へ近づく様子を
            観察できます。
            <br />
            さらに内腔に局所圧差 <b>ΔP_local</b> をかけ、外面が流体を通すモード（培地浴/空気/微小漏れ）
            では組織壁を径方向に<b>濾過流（移流）</b>が生じ、養分を外向きに運びます。
            Péclet 数 <Math tex={"Pe=u_aL/D"} /> が移流と拡散の比で、<Math tex={"Pe\\gg1"} /> で
            <b>浸透が深まり壊死コアが縮小</b>します。拡散の遅い<b>グルコースほど移流の恩恵が大きい</b>。
          </div>

          <div className={styles.story} style={{ marginTop: 12 }}>
            <b>モデルの範囲（局所1D径方向モデル）</b>：このシミュレータは長い灌流管全体ではなく、
            ある断面を取り出した局所1D径方向モデルです。管内の軸方向流れに伴う{" "}
            <Math tex={"P_{lumen}(z)"} /> や <Math tex={"C_{lumen}(z)"} /> の軸方向変化は解いていません。
            実際の長い管では入口から出口へ向かって <Math tex={"P_{lumen}(z)"} /> が低下し、
            流量が小さいと壁面消費で <Math tex={"C_{lumen}(z)"} /> も低下します。本アプリは、その一断面に
            <b>C0</b> と <b>ΔP_local</b> を与えて径方向分布を解くものです。
            <br />
            <b>完全封止</b>では、出口がないため定常的な正味濾過流は 0 と仮定します（圧力差そのものが
            無いという意味ではなく、一過的な浸潤・組織変形・微小漏れ・透過率変化は起こり得ます）。
            <b>薄水層</b>は完全無流束と外面濃度固定の中間で、有限の物質移動係数 <Math tex={"k_{ext}"} /> を持つ
            Robin 境界（−D∂C/∂r=k_ext(C_b−C_ext)）として扱い、溶質交換のみを表します（流体流出とは別）。
          </div>
        </div>
      )}
    </div>
  );
}
