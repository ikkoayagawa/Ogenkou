# 対応ソース

このVSIXにはOgenkou拡張の `src/`、`scripts/`、schema、依存lockfileを含みます。Vivliostyle Coreは独立forkで、Git履歴を `sources/vivliostyle.bundle`、実際にビルドしたソース・package・lockfile・tsconfigを `sources/core/` に同梱します。後者には未コミットの変更も含みます。履歴の起点と実行CoreのSHA256は `sources/core-revision.json`、変更範囲は `sources/Core-CHANGES.md` を参照してください。

展開したextensionを作業ディレクトリへ置き、兄弟ディレクトリへCoreを復元します。

```powershell
git clone extension/sources/vivliostyle.bundle vivliostyle
Copy-Item extension/sources/core/* vivliostyle/packages/core -Recurse -Force
cd vivliostyle/packages/core
npm ci --workspaces=false --ignore-scripts
npm run build
cd ../../../extension
npm ci
npm run build
```

Core側のREADME／package.jsonにあるビルド手順とNode.js要件も参照してください。開発用リポジトリではCoreをsubmoduleとして取得します。ブラウザは既存Chrome／Edge／Chromiumを使用します。

配布・ネットワーク提供時も、改変版に対応するソースとライセンス通知を提供してください。Marketplace向けのVSIXにも、上記の対応ソースを同梱します。
