# Ogenkouの構成と現在の実装

この文書は、Ogenkouの現在の実装、モジュール間の責任分担、制限を説明します。操作方法は拡張機能のREADME、公開ベンチマークの測定条件と結果は各測定の説明を参照してください。

## リポジトリと実行環境

Ogenkouは、小説原稿の組版プレビューとPDF出力を行うVS Code拡張機能です。拡張機能のソース、設定schema、検証コードは `extension/` にあります。`experiments/` には紹介資料で引用するベンチマークの結果と再現用コードを配置します。

組版には改変版のVivliostyle Coreを利用します。`vivliostyle/` は公開Core forkのGit submoduleです。Ogenkouの各コミットが採用するCoreのコミットを固定し、`core-revision.json` にも記録します。各測定で使用した過去のrevisionとビルドのハッシュは、測定ごとの環境情報に記録しています。

拡張機能はNode.js 22.12以降、VS Code 1.100以降を対象とします。実機検証はWindowsを中心に行っています。他のOSでの同等の動作を保証する検証は完了していません。PDF出力には既存のChrome・Edge・Chromiumを使用します。

## 入力の固定と変換

作品は、原稿の親ディレクトリを単位に扱います。直下の `.novel`・`.nv` をファイル名の自然順で結合し、開いている原稿は未保存の内容を優先します。原稿の文字位置は元テキストのUTF-16位置で保持します。

`SnapshotBuilder` は原稿・設定・直接指定された資源を捕捉します。組版用の入力は `RenderInputBuilder` が作り、HTMLから参照するローカル画像、CSSのimport/url、フォント、対応するSVG依存を再帰的に収集します。変換後にディスクを読み直して異なる版の資源を混ぜず、捕捉したbytesをCoreへ渡します。資源収集が完了した入力には `resourceManifestComplete: true` が付きます。

現行の変換経路は `compileVfmManuscript` です。VFM 2.7.2によるMarkdown変換に、小説のルビ・傍点・縦中横などの処理を加え、HTML、組版CSS、原稿位置対応を生成します。変換はWorkerで実行し、実行中の処理と待機中の最新入力を管理します。独自変換器 `compileManuscript` は比較・検証用として保持しています。

VFMのFrontmatterにあるタイトル・著者は作品設定がない場合の補助入力に使えます。最終文書の属性やCSSはOgenkouが生成します。

## 全文組版と部分組版

全文を処理するCWと、表示対象付近を処理するS1/S2を組み合わせます。Committedは最後に全文が完成した版です。Coreが提供する再利用・部分組版のAPIを使い、ジョブの投入、通信、表示順序は拡張機能側が制御します。

1. 初回はCWで全文を組み、資源準備後に完成紙面を表示側へ送ります。
2. 対応する入力では、全文完成時の再開状態を可搬seedとして渡し、表示側の専用donorへ復元します。
3. 編集中は空いたSへ最新入力を投入し、対象紙面まで組版して表示を切り替えます。S1/S2は交互に利用します。
4. CWは実行中の全文組版を完了し、最新入力で次の処理を開始します。完成結果の移送は受信側の受入状況に応じて制御します。
5. donorの切り替えはSの使用状況と編集の進行状況を確認して行い、旧世代の結果は不要になり次第リソースを解放します。

CW、donor、Sの組版条件は `pageViewMode: "singlePage"` でそろえます。見開きの部分表示にはCoreの `focusedDisplayMode` を使い、対象と隣接紙面を完成させます。

目次の参照先、画像・フォント・CSS資源のbytes、組版設定などを再利用条件に含めます。変更の影響や未対応の構成により再利用できない場合は、必要な範囲を組み直し、全文完成の経路へフォールバックします。

## 表示と原稿位置

完成紙面と表示用の位置対応を保持し、組版中も直近の完成版を閲覧できます。手動のページ移動では、Sの完了を待たずにCommittedの完成紙面を表示します。

紙面クリックとカーソル追従には、Coreのsource mapと拡張側の編集履歴補正を使います。削除箇所は編集境界へ補正します。編集履歴が足りず原稿の位置を特定できない場合は、「プレビューを更新してから移動してください」と表示します。

表示には単ページ・見開き・自動、倍率・フィット、前後・先頭末尾・番号・シークバーによる移動、見出し一覧があります。Ctrl／Metaとホイールで倍率を変更し、Ctrl+ドラッグで紙面の表示位置を移動できます。

## 設定と紙面

作品設定は `ogenkou.jsonc`、新しい作品へ引き継ぐ設定はデフォルトとして管理します。GUIは作品情報、紙面のレイアウト、柱・ノンブル、組版処理の4タブです。

JSONCのコメント・未知項目を保持し、コンフリクトを検出します。既存設定へのGUI適用ではVS Codeの未保存状態に反映し、利用者が保存します。新規の設定とCSSひな形は既存ファイルを上書きせずに作成します。

用紙寸法・向き、上下／ノド／小口の余白、段組み、文字・行送り、上下の柱・ノンブル、タイトルページ、目次を設定できます。版面の矛盾は適用前に検証します。目次はタイトルページ後、なければ作品先頭へ生成します。目次に採用する見出しの深さ、目次の組方向・行送りを設定できます。

作品CSSは生成した組版CSSの後に適用します。

## PDFと執筆支援

PDFはプレビューと共通の変換・資源収集経路から全文組版して出力します。未保存の原稿・設定を反映し、保存ダイアログで出力先と上書きを確認できます。キャンセルに対応します。標準配置のChrome・Edgeなどを探し、必要なら `ogenkou.pdf.browserPath` で指定します。

文字数は現在原稿と作品全体を表示し、Git管理下の現在原稿にはHEADとの差分も表示します。空白・改行、小説記法、ルビの数え方を設定できます。一般的なMarkdown記号は本文の文字数に含まれます。作品総数の列挙はディスク上の原稿を基準とするため、新規未保存ファイルの扱いには制限があります。

ユーザー定義の正規表現ハイライトは別Workerで実行し、制限時間を超えた処理を中断します。

## 制限と検証の範囲

- 資源収集には未対応の入力があります。外部URL、埋め込みCSS/SVGのdata URL、外部SVG useなどを含む任意の入力を完全対応とはしていません。
- プレビューとPDFは同じ入力を使いますが、Electronと外部ブラウザの版・フォント環境の違いによる差異が現れる可能性があります。

## ビルドと配布

以下をリポジトリ直下で実行します。

```console
git submodule update --init --recursive
npm ci --prefix vivliostyle/packages/core --workspaces=false --ignore-scripts
npm run build --prefix vivliostyle/packages/core
npm ci --prefix extension
npm run build --prefix extension
npm test --prefix extension
npm run typecheck --prefix extension
```

拡張機能のビルドはCoreのIIFEを `extension/dist/runtime/core.js` へコピーします。実Extension Host試験には既存VS Code、ブラウザ試験には `npm ci --prefix experiments/preview-benchmark --ignore-scripts` で測定用の依存もインストールします。

配布用のVSIXは `npm run package --prefix extension` で作成します。梱包処理はCoreのGit bundle、ビルドに使用したソース、実行用ファイルのSHA-256を同梱します。対応ソースと第三者ライセンスの案内は `extension/SOURCE_CODE.md`、`extension/THIRD_PARTY_NOTICES.md` を参照してください。
