import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base: './' で相対パス出力 → GitHub Pages のプロジェクトサブパス
// (https://<org>.github.io/<repo>/) でもアセットが正しく読み込まれる。
export default defineConfig({
  base: './',
  plugins: [react()],
})
