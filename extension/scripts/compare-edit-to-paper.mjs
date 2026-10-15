import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const [baselineFile, ...directories] = process.argv.slice(2);
if (!baselineFile || directories.length !== 2) throw Error('Pass baseline combined-result.json, body-capture run and final run');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const baseline = await read(baselineFile), runs = [];
for (const directory of directories) {
  const result = await read(path.join(directory, 'result.json'));
  const environment = await read(path.join(directory, 'environment.json'));
  const events = (await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const stages = await read(path.join(directory, 'stage-summary.json'));
  assert.equal(result.cases.length, 6);
  assert(!events.some(e => ['failure', 'input-error', 'conversion-error'].includes(e.type)));
  const latestDisplay = new Map(), starts = new Map(), edits = new Map();
  let quietDeferrals = 0;
  for (const event of events) {
    if (event.type === 'edit') edits.set(event.case, event.at);
    if (event.type === 'display') {
      assert(event.inputRevision > (latestDisplay.get(event.case) ?? -1));
      assert(event.targetPresent && !event.documentHidden);
      latestDisplay.set(event.case, event.inputRevision);
    }
    if (event.type === 's-start') { assert(!starts.has(event.jobId)); starts.set(event.jobId, event); }
    if (event.type === 's-end') {
      const start = starts.get(event.jobId); assert(start);
      assert.equal(event.case, start.case); assert.equal(event.inputRevision, start.inputRevision);
      assert.equal(event.lane, start.lane); assert(event.targetResolved && event.at >= start.at);
      starts.delete(event.jobId);
    }
    if (event.type === 'seed-import-deferred') {
      const next = events.find(e => e.type === 's-start' && e.case === event.case && e.at >= event.at);
      assert(next && next.inputRevision === event.latestRevision);
      if (event.at - edits.get(event.case) >= 300) quietDeferrals++;
    }
    if (event.type === 'seed-import-start' && event.frontRevision != null)
      assert(event.latestRevision <= Math.max(event.frontRevision, event.lastStartedRevision));
  }
  assert.equal(starts.size, 0);
  const conversions = events.filter(e => e.type === 'conversion-end');
  const published = events.filter(e => e.type === 'input-ready');
  assert.equal(conversions.length, published.length);
  for (const e of conversions) assert(published.some(p => p.case === e.case && p.build === e.build && p.inputRevision === e.inputRevision));
  for (const c of result.cases) {
    const rows = events.filter(e => e.case === c.case);
    assert.equal(rows.filter(e => e.type === 'edit' && e.phase === 'continuous').length, 40);
    assert(rows.filter(e => e.type === 'cw-end' && e.phase === 'isolated').length >= 3);
    assert.equal(latestDisplay.get(c.case), 43);
    assert(c.oracle.fullMatches && c.oracle.targetMatches && c.oracle.sourceCorrespondence);
  }
  const archive = await fs.readFile(path.join(directory, 'sources', 'snapshot-builder.js'));
  assert.equal(createHash('sha256').update(archive).digest('hex'), environment.hashes.snapshot);
  for (const original of baseline.runs) for (const key of ['core', 'compiler', 'collector'])
    assert.equal(original.environment.hashes[key], environment.hashes[key]);
  runs.push({run: path.basename(directory), environment, checks: {cases: 6, edits: 258,
    sJobs: events.filter(e => e.type === 's-start').length, completedConversions: conversions.length,
    inputErrors: 0, discardedConversions: 0, quietSeedDeferrals: quietDeferrals}, cases: result.cases, stages});
}
const summary = {baseline: path.resolve(baselineFile), caveat: 'One run per condition. Baseline first four cases used HTTP CSS; new runs use data CSS/blob Core. Final run also adds the context watcher guard.',
  runs: runs.map(({cases, stages, ...run}) => run), cases: baseline.cases.map(old => {
    const values = [old, ...runs.map(run => run.cases.find(c => c.case === old.case))];
    return {case: old.case, versions: values.map((c, i) => ({stage: ['baseline', 'captured-body', 'final'][i],
      isolatedMedianMs: c.isolatedTatMs.median, continuousMedianMs: c.continuousAllEditFirstVisibleMs.median,
      continuousMaxMs: c.continuousAllEditFirstVisibleMs.max, updatesWhileTyping: c.continuousDisplayCountWhileTyping,
      inputReadyWhileTyping: c.inputReadyDuringTyping, intervalMedianMs: c.continuousDisplayIntervalsMs.median,
      catchupMs: c.finalCatchupMs, inputErrors: c.inputErrors, sMedianMs: c.sLayoutMs.median}))};
  })};
const output = path.join(path.dirname(path.resolve(directories[0])), 'input-contract-comparison.json');
await fs.writeFile(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({output, checks: summary.runs.map(r => ({run: r.run, ...r.checks})), cases: summary.cases}, null, 2));
