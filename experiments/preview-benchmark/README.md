# Core単体の組版ベンチマーク

紹介資料で引用した測定を保存しています。Coreの呼び出しから組版完了までを測定し、Markdown変換・OgenkouのIPC・画面への描画待ちは測定対象に含めていません。

- [10月14日・5千〜64万字](scaling-20261014/README.md)：初回全文、編集後の全文再組版、部分組版。グラフ、CSV、集計を掲載。
- [10月12日・5千〜8万字](本家比較結果.md)：[測定条件](本家比較ベンチマーク.md)と550試行の比較。
- [10月12日・32万字追加測定](records/20261012-initial-320000/comparison.md)：初回全文、各2試行、warmup各1回。

各測定の全試行・warmup・環境・集計と測定時のブラウザ側コードは records/ にあります。個人の絶対パスは ${REPOSITORY} に置換しています。CPU・OS・ブラウザ版・revision・SHA-256・時間の値は測定時の記録です。測定時の改変Core revisionは開発履歴に対応し、公開用にまとめたCoreのcommit IDとは異なります。現在のsubmoduleでの再測定は現在のCoreを測ります。

## 準備

リポジトリ直下でCoreをビルドした後、測定用の依存をインストールします。既存のChromeを使い、各runnerの --browser= で実行ファイルを指定できます。

```console
npm ci --prefix experiments/preview-benchmark --ignore-scripts
node experiments/preview-benchmark/build-upstream-comparison.mjs
```

上流比較用のビルドは上流2.45.1（13d0a9c4918cb91b97ff0253d2da5f0d2dc9de98）をGit履歴から取り出します。OgenkouのCore forkの起点は上流2.45.2であり、比較対象の版とは異なります。再実行コマンドは各測定の説明に記載しています。32万字の追加測定は run-initial-only.mjs --sizes=320000 --reps=2 --warmup=1 --timeout=600000 です。

## 集計とグラフの再生成

PythonとMatplotlibを用意して、保存済みの試行から再生成できます。

```console
python experiments/preview-benchmark/publish-scaling-comparison.py --updated=experiments/preview-benchmark/records/20261014-updated --output=.recovery/scaling-regenerated
```

Yu Minchoを用いた測定です。再測定時は測定条件に記載したフォントを用意してください。
