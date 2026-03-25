# GIF Compressor Web App

## 概要
GIFファイルを128KB以下に圧縮してダウンロードできるWebアプリ。
Vercelにデプロイする。Next.js (App Router) + TypeScript。

## 機能要件
1. GIFファイルをドラッグ＆ドロップまたはファイル選択でアップロード
2. 目標サイズをKB単位で指定可能（デフォルト128KB）
3. アップロード後、サーバーサイドで圧縮処理
4. 圧縮前後のファイルサイズを表示
5. 圧縮後のGIFをプレビュー表示
6. ダウンロードボタンで圧縮済みGIFをダウンロード

## 圧縮アルゴリズム（段階的・品質最大限維持）
サーバーサイドで gifsicle (npm: gifsicle) を使用:
1. ロスレス最適化 (--optimize=3)
2. 色数削減 (256→128→64→32→16)
3. lossy圧縮 (30→60→100→150→200)
4. リサイズ (75%→50%→40%) — gifsicleの --resize-width を使う
各ステップで目標サイズ以下になったら即終了。

## 技術スタック
- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- gifsicle-wasm-browser は使わない。API Routeでgifsicleバイナリを実行する
- npm package: gifsicle (バイナリ提供) + execa (実行)

## UI
- シンプル、モダン、ダーク系
- 日本語UI
- レスポンシブ（モバイル対応）
- ドラッグ＆ドロップエリアは大きく
- 圧縮中はプログレス表示
- Before/Afterのサイズ比較

## デプロイ
- GitHubリポジトリ: naomarun/gif-compressor
- Vercel連携でデプロイ

## 注意事項
- Vercel Serverless Functionのサイズ制限に注意（50MB）
- GIFの最大アップロードサイズは10MB
- gifsicleバイナリはnpmパッケージから取得（postinstallで配置）
- /tmp ディレクトリを使って一時ファイル処理
