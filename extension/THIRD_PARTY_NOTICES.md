# 第三者ライセンス

- Ogenkouおよび旧Ogenkouから引き継いだ設定・日本語処理: AGPL-3.0-only。本文は `LICENSE`。
- 改変Vivliostyle Core: AGPL-3.0。本文・追加通知は `sources/Core-LICENSE`、`sources/Core-NOTICE`。変更と対応ソースは `SOURCE_CODE.md`。
- @vivliostyle/vfm 2.7.2: Apache-2.0。
- parse5 7.3.0、jsonc-parser 3.3.1: MIT。

VFMの推移依存もVSIXの `node_modules/` に含み、各パッケージのLICENSE／NOTICEを保持します。完全な依存版は `package-lock.json` と同梱の各package.jsonに記録しています。開発用TypeScript／型定義は配布の実行依存から除外します。Chrome／Edge／Chromiumは同梱しません。
