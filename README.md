# Ogenkou

小説原稿の組版プレビューやPDF出力、その他の多くの執筆サポートを行うVS Code拡張機能です。操作・設定・開発手順は [拡張機能のREADME](extension/README.md) を参照してください。

## リポジトリ構成とCoreの参照

- `extension/`：VS Code拡張機能。原稿のHTML変換、資源収集、組版ジョブの制御、プレビューUI、PDF出力を担当します。
- `vivliostyle/`：Git submoduleとして参照するCore fork。Core単体の公開API・再利用条件・変更内容は [CHANGES.md](vivliostyle/CHANGES.md) に記載しています。
- `experiments/`：紹介資料で引用したCore単体ベンチマークの結果と再現コードです。
- [DESIGN.md](DESIGN.md)：現在の実装と、モジュール間の責任分担を説明します。

`vivliostyle/` は [公開用Core](https://github.com/ikkoayagawa/vivliostyle.js) のsubmoduleです。Ogenkouの各コミットが、利用するCoreのコミットを記録します。取得後はリポジトリ直下でsubmoduleを初期化し、Core、拡張機能の順にビルドします。

拡張機能のビルドは `vivliostyle/packages/core/lib/vivliostyle.iife.js` を `extension/dist/runtime/core.js` へコピーして利用します。`core-revision.json` には採用したCoreの情報を記録します。Coreを更新するときは、この情報とsubmoduleの参照先を合わせて更新します。

```console
git submodule update --init --recursive
npm ci --prefix vivliostyle/packages/core --workspaces=false --ignore-scripts
npm run build --prefix vivliostyle/packages/core
npm ci --prefix extension
npm run build --prefix extension
```

開発時はsubmodule内でCoreを編集・コミットできます。`npm run dev --prefix vivliostyle/packages/core` は各形式の出力と型定義を自動更新します。Coreの変更を利用側へ反映する際は、Coreを公開先へpushしてから、Ogenkou側でsubmoduleの参照更新をコミットします。

## 実装と測定

[DESIGN.md](DESIGN.md) は入力の固定・変換、CW／Sによる組版、設定、プレビューとPDFの現在の構成を説明します。紹介資料で引用した測定は [ベンチマーク一覧](experiments/preview-benchmark/README.md) にあります。ブラウザを使う検証コードにも、同じ測定用の依存を利用します。

## 公開用ファイルの生成

`publication.json` に公開対象を指定しています。開発用checkoutで `node scripts/export-publication.mjs` を実行すると一覧とCoreの参照を検査します。`--write --target=空の出力先` を付けると公開対象だけをコピーします。公開用の更新時は、生成結果と既存の公開用checkoutの差分を確認し、Coreの参照先と一緒にコミットします。

## ライセンス

AGPL-3.0-only。拡張機能と同梱依存の案内は [対応ソース](extension/SOURCE_CODE.md)、[第三者ライセンス](extension/THIRD_PARTY_NOTICES.md) を参照してください。
