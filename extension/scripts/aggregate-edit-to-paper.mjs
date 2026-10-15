import fs from 'node:fs/promises';
import path from 'node:path';

const directories = process.argv.slice(2).map(value => path.resolve(value));
if (!directories.length) throw Error('Pass completed or explicitly partial result directories');
const stats = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b), n = sorted.length;
  return { count: n, median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    p95: sorted[Math.ceil(n * .95) - 1] ?? null, max: sorted.at(-1) ?? null };
};
const runs = [], cases = new Map();
for (const directory of directories) {
  const result = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
  const environment = JSON.parse(await fs.readFile(path.join(directory, 'environment.json'), 'utf8'));
  const events = (await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const run = path.basename(directory);
  runs.push({ run, status: result.status ?? 'complete', failure: result.failure ?? null, environment });
  for (const previous of result.cases) {
    const rows = events.filter(row => row.case === previous.case);
    const edits = rows.filter(row => row.type === 'edit');
    const displays = rows.filter(row => row.type === 'display');
    const stop = rows.find(row => row.type === 'input-stop');
    if (!stop || !previous.oracle.fullMatches || !previous.oracle.targetMatches || !previous.oracle.sourceCorrespondence)
      throw Error('Missing final validation: ' + previous.case);
    const firstVisible = edits.map(edit => {
      const displayed = displays.find(row => row.inputRevision >= edit.inputRevision);
      if (!displayed) throw Error('Unobserved edit: ' + previous.case + '/' + edit.inputRevision);
      return { inputRevision: edit.inputRevision, phase: edit.phase, firstVisibleRevision: displayed.inputRevision,
        tatMs: displayed.paintedAt - edit.at };
    });
    const active = displays.filter(row => row.phase === 'continuous' && row.paintedAt <= stop.at);
    const ready = rows.filter(row => row.type === 'input-ready');
    const cw = rows.filter(row => row.type === 'cw-end');
    const isolatedCycles = cw.filter(row => row.phase === 'isolated').length;
    if (isolatedCycles < 3 || edits.filter(row => row.phase === 'continuous').length !== 40)
      throw Error('Not the full benchmark scenario: ' + previous.case);
    cases.set(previous.case, { ...previous, run, isolatedCompletedCWCycles: isolatedCycles,
      isolatedTatMs: stats(firstVisible.filter(row => row.phase === 'isolated').map(row => row.tatMs)),
      continuousPublishedTatMs: stats(displays.filter(row => row.phase === 'continuous').map(row => row.paintedAt - row.receivedAt)),
      continuousAllEditFirstVisibleMs: stats(firstVisible.filter(row => row.phase === 'continuous').map(row => row.tatMs)),
      continuousDisplayCountWhileTyping: active.length,
      continuousDisplayIntervalsMs: stats(active.slice(1).map((row, index) => row.paintedAt - active[index].paintedAt)),
      inputProcessingMs: stats(ready.filter(row => row.inputRevision > 0).map(row => row.captureAndConvertMs)),
      sLayoutMs: stats(rows.filter(row => row.type === 's-end').map(row => row.durationMs)),
      cwLayoutMs: stats(cw.map(row => row.durationMs)),
      inputErrors: rows.filter(row => row.type === 'input-error').length,
      finalCatchupMs: Math.max(0, displays.find(row => row.inputRevision === stop.inputRevision).paintedAt - stop.at),
      firstVisible });
  }
}
const combined = { statistic: 'median averages the middle two values for an even sample; p95 uses nearest rank',
  scope: 'Actual edit event to two animation frames after presentation; CSS transport differs between recorded runs',
  runs, cases: [...cases.values()].sort((a, b) => (a.profile === b.profile ? a.size - b.size : a.profile === 'plain' ? -1 : 1)) };
const output = path.join(path.dirname(directories[0]), 'combined-result.json');
await fs.writeFile(output, JSON.stringify(combined, null, 2) + '\n');
console.log(combined.cases.map(row => ({ case: row.case, isolated: row.isolatedTatMs.median,
  continuousMedian: row.continuousAllEditFirstVisibleMs.median, continuousMax: row.continuousAllEditFirstVisibleMs.max,
  updates: row.continuousDisplayCountWhileTyping, catchup: row.finalCatchupMs, inputErrors: row.inputErrors })));
