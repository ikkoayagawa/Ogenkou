import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root=path.resolve(import.meta.dirname,'../..');
const output=path.resolve(process.argv[2]??path.join(root,'.recovery/upstream-comparison/unique-full-20261012'));
const read=name=>fs.readFile(path.join(output,name),'utf8').then(JSON.parse);
const environment=await read('environment.json'),raw=await read('results.json'),summary=await read('summary.json');
const {sizes,reps,warmup}=environment.plan;
assert.equal(raw.rows.length,sizes.length*11*reps);
assert.equal(raw.warmups.length,sizes.length*11*warmup);
assert.equal(summary.length,sizes.length*7);
assert(raw.rows.every(r=>r.matches));assert(raw.warmups.every(r=>r.matches));
assert(raw.rows.every(r=>Number.isFinite(r.durationMs)&&r.durationMs>0));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await fs.readFile(path.join(output,'current.js'))),environment.current.sha256);
assert.equal(hash(await fs.readFile(path.join(output,'upstream.js'))),environment.upstream.sha256);
assert.equal(hash(await fs.readFile(path.join(output,'browser.mjs'))),environment.plan.browserHarnessHash);
for(const row of summary){
  const position=row.position??'middle';
  const current=raw.rows.filter(r=>r.size===row.size&&r.position===position&&r.build==='current'&&r.mode===row.mode);
  const upstream=raw.rows.filter(r=>r.size===row.size&&r.position===position&&r.build==='upstream'&&r.mode===row.upstreamMode);
  assert.equal(current.length,reps);assert.equal(upstream.length,reps);
  assert.deepEqual(current.map(r=>r.durationMs),row.current.valuesMs);
  assert.deepEqual(upstream.map(r=>r.durationMs),row.upstream.valuesMs);
  // loaded does not expose a reuse count; absence is unknown, not zero reuse.
  row.reusedPages=current.map(r=>r.terminal.reusedPages??null);
}
await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const relative=path.relative(root,output).replaceAll('\\','/');
const recorded={rawOutput:relative,timedTrials:raw.rows.length,warmupTrials:raw.warmups.length,allPaperComparisonsMatched:true,environment:{createdAt:environment.createdAt,node:environment.node,browser:environment.browser,os:environment.os,cpu:environment.cpu,ramBytes:environment.ramBytes,upstream:{revision:environment.upstream.revision,version:environment.upstream.version,sha256:environment.upstream.sha256},current:environment.current},plan:environment.plan,summary};
await fs.writeFile(path.join(import.meta.dirname,'本家比較結果.json'),JSON.stringify(recorded,null,2)+'\n');
const table=await fs.readFile(path.join(output,'comparison.md'),'utf8');
const report=table+'\n## 比較条件と読み方\n\n詳細は[本家比較ベンチマーク](本家比較ベンチマーク.md)。本家2.45.1の未改変ソースと現行forkを、同じビルド条件・CSSで比較した。結果JSONは[本家比較結果.json](本家比較結果.json)。raw記録：`'+relative+'`。\n\n初回の改善と更新の改善は分けて評価する。小規模の初回は現行が遅い場合もあり、全条件で必ず速くなる結果ではない。今回の短段落への空行1つでは、全文更新が後続の組版状態へ早く合流し、Sと同程度またはSより速い条件もある。長大な段落や目次一ページ増加などの長い再組版を代表するものではない。\n\nCore呼出しにHTML解析を含め、Sにはローカルseed複製を含める。可搬seed受信・復元、Markdown変換、IPC、保持紙面の複製とpaint、CW/Sの同時稼働は主指標から除外した。保持複製時間とseed複製時間はJSONの補助指標で確認できる。\n\n個別改修の寄与を分けるには、現行の再利用なし全文更新や最適化ごとの比較が別途必要。機能条件は[測定の一覧と準備](README.md)も参照。\n';
await fs.writeFile(path.join(import.meta.dirname,'本家比較結果.md'),report);
console.log(JSON.stringify({timedTrials:raw.rows.length,warmupTrials:raw.warmups.length,comparisons:summary.length,initial:summary.filter(r=>r.mode==='initial').map(r=>({size:r.size,upstreamMs:r.upstream.medianMs,currentMs:r.current.medianMs})),updates:summary.filter(r=>r.mode!=='initial').map(r=>({size:r.size,mode:r.mode,position:r.position,upstreamMs:r.upstream.medianMs,currentMs:r.current.medianMs}))}));
