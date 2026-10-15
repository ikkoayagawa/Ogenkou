"""Aggregate scaling trials and export mean-time charts (mean, linear/log2 x)."""
import argparse, csv, json, os, statistics, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
if sys.version_info[:2] == (3,12):
 sys.path.insert(0,str(ROOT/'.recovery/scaling-comparison/plot-deps'))
os.environ.setdefault('MPLCONFIGDIR',str(ROOT/'.recovery/scaling-comparison/matplotlib-cache'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager, ticker
parser=argparse.ArgumentParser()
parser.add_argument('--initial',default='experiments/preview-benchmark/records/20261014-initial')
parser.add_argument('--focused',default='experiments/preview-benchmark/records/20261014-focused')
parser.add_argument('--updated',help='Optional full-update results directory')
parser.add_argument('--output',default='experiments/preview-benchmark/scaling-20261014')
a=parser.parse_args()
def location(value):
 p=Path(value);return p if p.is_absolute() else ROOT/p
initial_dir,focused_dir,out=map(location,[a.initial,a.focused,a.output]);out.mkdir(parents=True,exist_ok=True)
initial=json.loads((initial_dir/'results.json').read_text(encoding='utf-8'))
focused=json.loads((focused_dir/'results.json').read_text(encoding='utf-8'))
updated_dir=location(a.updated) if a.updated else None
updated=json.loads((updated_dir/'results.json').read_text(encoding='utf-8')) if updated_dir else None
datasets=[initial,focused]+([updated] if updated else [])
environments={k:json.loads((p/'environment.json').read_text(encoding='utf-8')) for k,p in [('initial',initial_dir),('focused',focused_dir)]}
if updated:
 environments['updated']=json.loads((updated_dir/'environment.json').read_text(encoding='utf-8'))
 updated_reps={size:int(environments['updated']['plan'].get('repetitionsBySize',{}).get(str(size),environments['updated']['plan']['reps'])) for size in [5000*2**i for i in range(8)]}
 assert len(updated['rows'])==6*sum(updated_reps.values()) and len(updated['warmups'])==48
sizes=[5000*2**i for i in range(8)]
assert all(v['matches'] for dataset in datasets for v in dataset['rows'])
assert len(initial['rows'])==160 and len(focused['rows'])==240
assert len(initial['warmups'])==16 and len(focused['warmups'])==24
assert len(focused['oracles'])==24
assert all(env['current']['sha256']==environments['initial']['current']['sha256'] for env in environments.values())
for environment in environments.values():
 for key in ['bundle','resources','source']:
  environment['upstream'].pop(key,None)
update_single_640k=bool(updated and updated_reps[640000]==1)
update_caption=('平均：現行10回・本家30回（64万字は1回・3回）／帯は±標準偏差' if update_single_640k else '現行は各点10試行・本家は各点30試行の平均／帯は±標準偏差')
update_current_caption=('各点10試行の平均（64万字は1試行）・帯は±標準偏差' if update_single_640k else '各点10試行の平均・帯は±標準偏差')
records=[]
scenarios=[('initial',['upstream','current'],['middle'],initial),('focused',['current'],['early','middle','late'],focused)]
if updated:scenarios.append(('complete',['upstream','current'],['early','middle','late'],updated))
for mode,builds,positions,data in scenarios:
 for size in sizes:
  for build in builds:
   for position in positions:
    trials=[v for v in data['rows'] if v['size']==size and v['build']==build and v['position']==position and v['mode']==mode]
    count=updated_reps[size] if mode=='complete' else 10
    assert len(trials)==count and sorted(v['trial'] for v in trials)==list(range(count)),(mode,size,build,position)
    trials.sort(key=lambda v:v['trial'])
    values=[v['durationMs'] for v in trials];pages=[v['totalPageCount'] for v in trials]
    records.append(dict(size=size,mode=mode,build=build,position=None if mode=='initial' else position,count=count,meanMs=statistics.mean(values),medianMs=statistics.median(values),standardDeviationMs=statistics.pstdev(values),minMs=min(values),maxMs=max(values),valuesMs=values,pageCounts=pages,targetPages=[v['targetIndex']+1 if v['targetIndex'] is not None else None for v in trials],baselineMs=[v['baselineMs'] for v in trials]))
(out/'results.json').write_text(json.dumps(dict(environments=environments,records=records,timedTrials=sum(len(d['rows']) for d in datasets),warmupTrials=sum(len(d['warmups']) for d in datasets),updatedRaw=str(updated_dir.relative_to(ROOT)) if updated_dir else None,initialRaw=str(initial_dir.relative_to(ROOT)),focusedRaw=str(focused_dir.relative_to(ROOT))),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
with (out/'trials.csv').open('w',encoding='utf-8-sig',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=['size','mode','build','position','trial','durationMs','totalPageCount','targetPage','baselineMs','seedPrepareMs','retainMs','matches']);writer.writeheader()
 for dataset in datasets:
  for v in dataset['rows']:
   writer.writerow({k:(v['targetIndex']+1 if v['targetIndex'] is not None else None) if k=='targetPage' else v.get(k) for k in writer.fieldnames})
font=Path('C:/Windows/Fonts/YuGothM.ttc')
if font.exists():
 font_manager.fontManager.addfont(str(font));plt.rcParams['font.family']=font_manager.FontProperties(fname=str(font)).get_name()
plt.rcParams.update({'font.size':12,'axes.unicode_minus':False,'svg.fonttype':'none'})
labels={5000:'5千',10000:'1万',20000:'2万',40000:'4万',80000:'8万',160000:'16万',320000:'32万',640000:'64万'}
charts=[('initial','初回全文組版',[('upstream',None,'本家 Core 2.45.1','#888888'),('current',None,'現行 Core','#1f77b4')]),('focused','空行挿入後の部分組版',[('current','early','序盤（25%）','#1f77b4'),('current','middle','中盤（50%）','#e68613'),('current','late','終盤（75%）','#318b55')])]
pooled=[]
if updated:
 for size in sizes:
  values=[n for r in records if r['mode']=='complete' and r['size']==size and r['build']=='upstream' for n in r['valuesMs']]
  assert len(values)==3*updated_reps[size]
  pooled.append(dict(size=size,mode='complete',build='upstream',position=None,count=len(values),meanMs=statistics.mean(values),standardDeviationMs=statistics.pstdev(values)))
 charts.append(('complete','空行挿入後の全文再組版',[('upstream',None,'本家（3位置を集計）','#888888'),('current','early','現行：序盤（25%）','#1f77b4'),('current','middle','現行：中盤（50%）','#e68613'),('current','late','現行：終盤（75%）','#318b55')]))
def save_chart(fig,file):
 fig.savefig(file,dpi=180)
 if file.suffix=='.svg':
  file.write_text('\n'.join(line.rstrip() for line in file.read_text(encoding='utf-8').splitlines())+'\n',encoding='utf-8')
for mode,title,series in charts:
 for axis in ['linear','log']:
  fig,ax=plt.subplots(figsize=(10.5,6.3))
  fig.subplots_adjust(left=.12,right=.985,bottom=.13,top=.91)
  for build,position,label,color in series:
   samples=sorted([r for r in records+pooled if r['mode']==mode and r['build']==build and r['position']==position],key=lambda r:r['size'])
   x=[r['size'] for r in samples];y=[r['meanMs'] for r in samples];sd=[r['standardDeviationMs'] for r in samples]
   ax.plot(x,y,marker={'early':'o','middle':'s','late':'^'}.get(position,'o'),linewidth=2,label=label,color=color)
   ax.fill_between(x,[max(0,v-d) for v,d in zip(y,sd)],[v+d for v,d in zip(y,sd)],alpha=.12,color=color)
  if axis=='log':
   ax.set_xscale('log',base=2);ax.set_xticks(sizes,[labels[v] for v in sizes]);ax.set_xlim(4500,710000)
  else:
   ax.set_xlim(0,660000);ax.set_xticks([0,80000,160000,240000,320000,400000,480000,560000,640000],['0','8万','16万','24万','32万','40万','48万','56万','64万'])
  ax.set_ylim(bottom=0);ax.yaxis.set_major_formatter(ticker.StrMethodFormatter('{x:,.0f}'))
  ax.set_xlabel('原稿の文字数');ax.set_ylabel('平均所要時間（ms）');ax.set_title(title+'：'+('通常軸' if axis=='linear' else '横軸対数（底2）'))
  ax.grid(alpha=.25);ax.legend();ax.spines[['top','right']].set_visible(False)
  caption=fig.text(.99,.005,(update_caption if mode=='complete' else '各点10試行の平均・帯は±標準偏差'),ha='right',va='bottom',fontsize=10,color='#555555')
  for extension in ['png','svg']:save_chart(fig,out/f'{mode}-{axis}.{extension}')
  if mode=='complete':
   ax.lines[0].remove();ax.collections[0].remove();ax.legend()
   caption.set_text(update_current_caption)
   current_max=max(r['meanMs']+r['standardDeviationMs'] for r in records if r['mode']=='complete' and r['build']=='current')
   ax.set_ylim(0,current_max*1.10);ax.set_title('空行挿入後の全文再組版：現行Core拡大（'+('通常軸' if axis=='linear' else '横軸対数')+'）')
   for extension in ['png','svg']:save_chart(fig,out/f'complete-current-{axis}.{extension}')
  plt.close(fig)
fmt=lambda n:f'{n:,.1f}'
lines=['# 5千〜64万字の組版ベンチマーク','',('平均所要時間を掲載。初回・部分組版は各条件10試行。空行挿入後の全文再組版は32万字まで各10試行、64万字は各1試行。' if update_single_640k else '平均所要時間を掲載。各条件10試行。')+'warmupは各条件1回を除外。文字数は5,000×2のべきで8段階。','','## 初回全文組版','','| 文字数 | ページ数 | 本家平均（ms） | 現行平均（ms） | 本家÷現行 |','| --- | ---: | ---: | ---: | ---: |']
for size in sizes:
 u=next(r for r in records if r['mode']=='initial' and r['size']==size and r['build']=='upstream');c=next(r for r in records if r['mode']=='initial' and r['size']==size and r['build']=='current');assert u['pageCounts']==c['pageCounts'];pageLabel='/'.join(f'{v:,}' for v in sorted(set(c['pageCounts'])))
 lines.append(f"| {size:,} | {pageLabel} | {fmt(u['meanMs'])} | {fmt(c['meanMs'])} | {u['meanMs']/c['meanMs']:.2f}倍 |")
lines+=['','![初回全文・通常軸](initial-linear.png)','','![初回全文・対数軸](initial-log.png)']
if updated:
 lines+=['','## 空行挿入後の全文再組版','',('本家の列は3位置を合わせた平均（32万字までは計30試行、64万字は計3試行）。現行は位置別の平均（32万字までは各10試行、64万字は各1試行）。' if update_single_640k else '本家の列は3位置の全30試行を合わせた平均。現行は位置別の各10試行の平均。'),'','| 文字数 | 本家平均（ms） | 現行：序盤（ms） | 中盤（ms） | 終盤（ms） | ページ数（序盤／中盤／終盤） |','| --- | ---: | ---: | ---: | ---: | --- |']
 for size in sizes:
  u=next(r for r in pooled if r['size']==size)
  c=[next(r for r in records if r['mode']=='complete' and r['build']=='current' and r['size']==size and r['position']==pos) for pos in ['early','middle','late']]
  pages=['/'.join(f'{v:,}' for v in sorted(set(r['pageCounts']))) for r in c]
  lines.append(f"| {size:,} | {fmt(u['meanMs'])} | {fmt(c[0]['meanMs'])} | {fmt(c[1]['meanMs'])} | {fmt(c[2]['meanMs'])} | {'／'.join(pages)} |")
 lines+=['','![全文再組版・通常軸](complete-linear.png)','','![全文再組版・対数軸](complete-log.png)','','![現行全文再組版・通常軸拡大](complete-current-linear.png)','','![現行全文再組版・対数軸拡大](complete-current-log.png)','','SVG版：[全文通常](complete-linear.svg)・[全文対数](complete-log.svg)・[現行拡大通常](complete-current-linear.svg)・[現行拡大対数](complete-current-log.svg)。','']
lines+=['','## 空行挿入後の部分組版','','| 文字数 | 序盤平均（ms） | 中盤平均（ms） | 終盤平均（ms） | 全文ページ数（序盤／中盤／終盤） |','| --- | ---: | ---: | ---: | --- |']
for size in sizes:
 r=[next(v for v in records if v['mode']=='focused' and v['size']==size and v['position']==pos) for pos in ['early','middle','late']]
 pages=['/'.join(f'{n:,}' for n in sorted(set(v['pageCounts']))) for v in r]
 lines.append(f"| {size:,} | {fmt(r[0]['meanMs'])} | {fmt(r[1]['meanMs'])} | {fmt(r[2]['meanMs'])} | {'／'.join(pages)} |")
lines+=['','![部分組版・通常軸](focused-linear.png)','','![部分組版・対数軸](focused-log.png)','','## 測定条件','','原稿・CSSは[前回の本家比較](../本家比較ベンチマーク.md)と同じ。120字ごとの一意な段落、A6・縦書き・9pt・Yu Mincho・行送り1.75。空行一つを段落数の25%／50%／75%付近に追加する。初回はHTML解析を含むCore入力から全文loadedまで、部分組版はローカルseed複製開始から対象紙面のfocusedterminalまで。部分組版の未編集全文baselineは毎試行新規に作成し、その時間を主指標から除く。','','部分組版の全文ページ数は、編集後の入力を本家で独立全文組版した比較用結果から記録する。対象は単ページであり、表示した紙面は1ページ。全試行を本家の全文結果に対して比較し、本文・寸法・左右・TextNodeの表示矩形の一致を確認した。','','全文更新は、未編集原稿を全文完成させた既存Viewerへ空行追加後のHTMLを渡し、全文完成のloaded通知までを測る。現行はrefreshMemoryDocumentとreusePagesを使う。本家と現行の各位置・各試行で全紙面を照合する。\n\n本家はfork起点の2.45.1。各試行は新しいブラウザページで逐次実行する。初回全文の本家／現行の順序を交代する。Markdown変換・IPC・描画フレーム待ちは含めない。グラフの縦軸はすべて線形、横軸だけ通常軸／対数軸を切り替える。','','[全試行CSV](trials.csv)・[集計と環境JSON](results.json)。ページ数・対象ページ番号（1始まり）・補助時間も記録した。','','SVG版：[初回通常](initial-linear.svg)・[初回対数](initial-log.svg)・[部分通常](focused-linear.svg)・[部分対数](focused-log.svg)。','']
lines+=['## 再実行','','Coreと本家比較用bundleを準備し、以下をリポジトリ直下で逐次実行する。グラフ生成にはMatplotlibを使用する。既定は8字数・各10試行・除外warmup各1回。途中で終了した測定は同じ出力先を指定して再開できる。','','```console','npm run build --prefix vivliostyle/packages/core','node experiments/preview-benchmark/build-upstream-comparison.mjs','node experiments/preview-benchmark/run-scaling-comparison.mjs --timeout=600000 --output=.recovery/scaling-comparison/new-initial','node experiments/preview-benchmark/run-scaling-focused.mjs --output=.recovery/scaling-comparison/new-focused','node experiments/preview-benchmark/run-scaling-comparison.mjs --menus=edit --include-focused=false --reps640k=1 --timeout=600000 --output=.recovery/scaling-comparison/new-updated','python experiments/preview-benchmark/publish-scaling-comparison.py --updated=.recovery/scaling-comparison/new-updated --initial=.recovery/scaling-comparison/new-initial --focused=.recovery/scaling-comparison/new-focused --output=experiments/preview-benchmark/scaling-new','```','']
(out/'README.md').write_text('\n'.join(lines),encoding='utf-8')
print(json.dumps({'output':str(out),'initialTrials':len(initial['rows']),'focusedTrials':len(focused['rows']),'updatedTrials':len(updated['rows']) if updated else 0,'allComparisonsMatched':True}))
