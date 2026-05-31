# 3D tissue perfusion Simulator

中空円筒（ちくわ型）組織の局所断面における、酸素・グルコースの拡散・細胞消費・灌流を
可視化する教育用 Web アプリ。軸対称・径方向1D の移流拡散反応方程式を後退Euler（L安定）で解き、
過渡（前縁の外向き進行）から定常（壊死コア形成）までをインタラクティブに観察できる。

## ▶ ライブデモ（クリックで起動）

**👉 https://tlab-utokyo.github.io/3d-tissue-perfusion-simulator/ 👈**

上のリンクをクリックするとブラウザで即起動します（インストール不要）。

### 使い方（どこをクリックするか）

1. **講義モード / 詳細モード**（右上のトグル）… 講義モードは最小限のスライダーだけ表示。
2. **シナリオボタン①〜⑤**（上部の帯）… ワンクリックで演習設定にジャンプ:
   ① 薄い組織（健全）→ ② 厚すぎる組織（壊死）→ ③ 灌流で救う → ④ 封止だと救えない → ⑤ 酸素 vs グルコース
3. **▶ 再生（赤ボタン）** … 時間発展アニメーション開始。「定常ソルブ」で定常解へジャンプ。
4. **スライダー** … 壁厚 L・内外圧力差 ΔP などを動かすとリアルタイム再計算。
5. **ヒートマップをクリック** … その半径 r を選び、下の「時間–濃度グラフ」に C(r, t) を表示。

## 物理モデル

```
∂C/∂t = D·(1/r)·∂/∂r( r·∂C/∂r ) − R(C)
R(C)  = ρ·q_max·C/(K_m+C)   (Michaelis–Menten)  /  R0 = ρ·q_max  (ゼロ次)
```

- **局所1D径方向モデル**: 長い管全体ではなく、ある断面を切り出したモデル。管内軸方向流れ・
  P_lumen(z)・C_lumen(z) は解かない。ΔP_local は選んだ断面でのルーメン内外圧差。
- 境界条件: r=a（ルーメン壁）で C=C0（Dirichlet）。r=b は **5 モード**（溶質境界＋流体流出を分離）:
  - 培地浴: 溶質 Dirichlet C(b)=C0、流体 open（leakiness=1）
  - 完全封止: 溶質 Neumann ∂C/∂r=0、流体なし（leakiness=0, ΔPかけても u≡0）
  - 薄水層: 溶質 Robin `-D∂C/∂r=k_ext(C_b−C_ext)`（k_ext→0で無流束、大でC_ext固定）。流体なし（溶質交換のみ）
  - 空気接触: O2 は Dirichlet C(b)=C_air、Glucose は outflow。流体 open
  - 微小漏れ: 流体が一部流出（u=leakiness·Darcy, 0<leakiness<1）。溶質 outflow
- 灌流速度 `u(r)=u_a·a/r`, `u_a = hydraulicLeakiness · (k_perm/μ)·ΔP_local/(a·ln(b/a))`。
  流体流出（leakiness）と溶質交換（Robin k_ext）は独立に扱う。
- 解析解（ゼロ次・内灌流・外無流束）: `C(r) = C0 + (R0/4D)(r²−a²) − (R0 b²/2D)·ln(r/a)`
- 壊死前縁 r_p は超越方程式を二分法で解く。臨界厚 `L_crit = sqrt(2·D·C0/R0)`
- 無次元数: `Da = R0 L²/(D C0)`, Thiele `φ = L·sqrt(ρ q_max/(D K_m))`, `κ = C0/K_m`

## 数値解法

- 径方向 N=200 均等メッシュ、保存形フラックスで円筒ラプラシアンを離散化
- 過渡: θ法（既定 θ=1 の後退Euler）。MM は C^n まわりで半陰的に線形化し三重対角を維持 → Thomas 法。
  壊死前縁のような鋭い界面では Crank–Nicolson（θ=0.5）は剛性モードに対し増幅率→−1 で
  振動（period-2）し残差が収束しないため、L-安定な後退Euler を既定とする（θ は切替可能）。
- ゼロ次消費は「飽和した MM」として微小な正則化幅 δ=10⁻³·C₀ で C→0 に滑らかに 0 へ落とし、
  自由境界（壊死前縁）の数値振動を回避する。内部場の微小負値は表示時に 0 へクランプ。
- 定常: 過渡と同じ後退Euler を大きめの Δt で収束まで反復（過渡終端と厳密一致・自由境界でも安定）
- 単位は内部 SI 統一（m, s, mol/m³）。UI は µm / mM / cells/mL（`src/solver/units.ts`）

## 検証

起動時に `src/solver/validate.ts` が **ゼロ次定常の数値解と解析解を全格子点で比較**し、
相対誤差を DevTools コンソールへ出力する（要件: < 1%。実測 < 0.001%）。

```
npm run check   # 解析解一致・壊死前縁・L_crit を端末で確認
npm run smoke   # happy-dom 上で App を実レンダリングし例外が無いか確認
```

## 開発

```
npm install
npm run dev      # http://localhost:5173
npm run build    # 型チェック + 本番ビルド
```

> 社内 FW 環境では `NODE_OPTIONS=--use-system-ca npm install` のように system CA が必要な場合がある。

## 公開（GitHub Pages・自動デプロイ）

`main` ブランチに push するたびに、GitHub Actions（[.github/workflows/deploy.yml](.github/workflows/deploy.yml)）が
自動でビルドして GitHub Pages へ公開します。

**初回だけ GitHub 上で1クリック設定が必要な場合があります:**
リポジトリの **Settings → Pages → Build and deployment → Source** を **「GitHub Actions」** に設定。
（その後の更新は push するだけで自動反映。進捗は **Actions** タブで確認できます。）

公開後の URL: **https://tlab-utokyo.github.io/3d-tissue-perfusion-simulator/**

## 構成

```
src/
  solver/   units, presets, grid, analytic, pde(CN+Thomas), metrics, validate   ← UI 非依存・単体 import 可
  viz/      viridis カラーマップ
  components/ Controls, Heatmap(Canvas), RadialProfile(recharts), Metrics(KaTeX), Explainer
  hooks/    useSimulation（Solver と React 状態の仲介・rAF アニメーション）
  App.tsx
```
