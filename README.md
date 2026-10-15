# お原稿（Ogenkou）

小説を書きながら、本にしたときの紙面を確かめるためのVS Code拡張機能です。原稿の隣に縦書き・横書きのプレビューを開き、そのままPDFに書き出せます。

![原稿の編集を紙面へ反映する様子](extension/media/preview.gif)

## できること

- 未保存の編集も反映する組版プレビュー。単ページ・見開き表示に対応。
- 用紙、フォント、余白、段組み、柱・ページ番号を画面から設定。
- ルビ、傍点、縦中横、連続ダッシュの表示。
- 章ごとに分けた `.novel` / `.nv` 原稿を一つの作品として組版。
- 紙面の本文をクリックして、原稿の対応箇所へ移動。
- 文字数の表示、Gitの最新コミットからの増減、正規表現によるハイライト。
- プレビューと同じ原稿・設定・CSSを使ったPDF出力。

インストールと操作方法は **[拡張機能の説明](extension/README.md)** にまとめています。0.9.0はVSIXからインストールできます。PDF出力には、PCにインストール済みのChrome・Edge・Chromiumのいずれかを使います。

## まず試す

VS Codeで作品用のフォルダーを開き、`01_第一章.novel` を作ります。

```text
# 第一章

　窓の外には、まだ夜の色が残っていた。
　机の上の｜原稿《げんこう》に、最後の一行を書き足す。
```

原稿を開いて、コマンドパレットから **Ogenkou: 原稿プレビューを開く** を実行してください。紙面が表示されたら、右の「☰」から用紙や文字サイズを調整できます。

## 仕組みとCoreの参照

原稿をVFMと小説向けの処理でHTMLへ変換し、[Vivliostyle Core](https://github.com/vivliostyle/vivliostyle.js) のforkで組版しています。編集時には、安全に再利用できる紙面を残し、表示したいページを先に組みます。作品全体の確定処理も別に進め、PDF出力では全文の完成を待ちます。

| 保存先 | 内容 |
| --- | --- |
| `extension/` | 原稿変換、設定、プレビュー、PDF出力を担うVS Code拡張 |
| `vivliostyle/` | [Core fork](https://github.com/ikkoayagawa/vivliostyle.js) を参照するGit submodule |
| `experiments/preview-benchmark/` | Core単体の測定結果、グラフ、再現コード |
| [DESIGN.md](DESIGN.md) | 実装の構成と各部品の役割 |

Coreの追加APIと再利用の条件は [vivliostyle/CHANGES.md](vivliostyle/CHANGES.md)、性能の測定条件は [ベンチマーク一覧](experiments/preview-benchmark/README.md) を参照してください。測定値は原稿・CSS・編集内容によって変わります。

`core-revision.json` とsubmodule参照が、採用するCoreのコミットを記録します。拡張機能のビルド時に `vivliostyle/packages/core/lib/vivliostyle.iife.js` を `extension/dist/runtime/core.js` へコピーします。

## ソースからビルドする

Git、Node.js 22.12以降、npmを用意してください。VSIX作成にはWindowsとPowerShell 7を使います。

リポジトリ直下で、次の順に実行します。

```powershell
git submodule update --init --recursive
npm ci --prefix vivliostyle/packages/core --workspaces=false --ignore-scripts
npm run build --prefix vivliostyle/packages/core
npm ci --prefix extension
npm run package --prefix extension
```

0.9.0の出力先は `extension/artifacts/ogenkou-0.9.0.vsix` です。VS Codeの拡張機能画面から「VSIXからのインストール」で選びます。

開発時は `npm run build --prefix extension` の後、F5で `Run Ogenkou` を起動できます。このデバッグ起動では他のインストール済み拡張機能を無効にします。Coreの自動ビルドには `npm run dev --prefix vivliostyle/packages/core` を使えます。

## 公開対象の生成

`publication.json` に公開対象を指定しています。`node scripts/export-publication.mjs` で対象ファイルとCore参照を検査し、`--write --target=空の出力先` を付けると公開対象だけを生成します。

## ライセンス

AGPL-3.0-only。VSIXには対応ソースと第三者ライセンスの案内を同梱します。[対応ソース](extension/SOURCE_CODE.md)・[第三者ライセンス](extension/THIRD_PARTY_NOTICES.md) を参照してください。
