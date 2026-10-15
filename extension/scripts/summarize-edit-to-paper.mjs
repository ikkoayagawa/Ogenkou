import fs from 'node:fs/promises';
import path from 'node:path';

// Derive presentation intervals and stage costs from the same measured events.
// No new browser run is needed to inspect a peak or the revision gap.
const directory = path.resolve(process.argv[2]);
const events = (await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8'))
  .trim().split('\n').map(line => JSON.parse(line));
const results = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
const stats = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { count: sorted.length, median: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null,
    p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, max: sorted.at(-1) ?? null };
};
const timeline = [], stages = [];
for (const result of results.cases) {
  const rows = events.filter(row => row.case === result.case);
  const beginning = rows.find(row => row.type === 'case-start').at;
  const ending = rows.find(row => row.type === 'case-end').at;
  const displays = rows.filter(row => row.type === 'display');
  const at = row => row - beginning;
  timeline.push({ case: result.case, fromMs: 0, toMs: at(displays[0]?.paintedAt ?? ending), lane: null, revision: null });
  displays.forEach((row, index) => timeline.push({ case: result.case,
    fromMs: at(row.paintedAt), toMs: at(displays[index + 1]?.paintedAt ?? ending),
    lane: row.lane, inputRevision: row.inputRevision, coreRevision: row.coreRevision, jobId: row.jobId }));
  const completed = rows.filter(row => row.type === 's-end').map(end => {
    const start = rows.find(row => row.type === 's-start' && row.jobId === end.jobId);
    const ready = rows.find(row => row.type === 'input-ready' && row.inputRevision === end.inputRevision);
    const display = displays.find(row => row.jobId === end.jobId);
    return { lane: end.lane, jobId: end.jobId, inputRevision: end.inputRevision,
      seedRevision: end.seedRevision, revisionGap: end.inputRevision - end.seedRevision,
      phase: end.phase, startMs: at(start.at), endMs: at(end.at),
      inputMs: ready.captureAndConvertMs, queueAndTransportMs: start.at - ready.at,
      targetLayoutMs: end.durationMs, paintAfterLayoutMs: display ? display.paintedAt - end.at : null,
      editToPaintMs: display ? display.paintedAt - display.receivedAt : null,
      reusedPrefixPages: end.reusedPrefixPages };
  });
  const conversions = rows.filter(row => row.type === 'conversion-end' && row.inputRevision > 0);
  const continuousEdits = rows.filter(row => row.type === 'edit' && row.phase === 'continuous');
  stages.push({ case: result.case,
    actualEditIntervalsMs: stats(continuousEdits.slice(1).map((row, index) => row.at - continuousEdits[index].at)),
    completedConversionsNotPublished: rows.filter(row => row.type === 'conversion-end').length - rows.filter(row => row.type === 'input-ready').length,
    conversionMs: stats(conversions.map(row => row.durationMs)),
    inputMs: result.inputProcessingMs, targetLayoutMs: result.sLayoutMs,
    queueAndTransportMs: stats(completed.map(row => row.queueAndTransportMs)),
    paintAfterLayoutMs: stats(completed.map(row => row.paintAfterLayoutMs)),
    cwLayoutMs: stats(rows.filter(row => row.type === 'cw-end').map(row => row.durationMs)),
    cwExportMs: stats(rows.some(row => row.type === 'seed-export')
      ? rows.filter(row => row.type === 'seed-export').map(row => row.durationMs)
      : rows.filter(row => row.type === 'cw-end').map(row => row.exportMs)),
    exportedGenerations: rows.filter(row => row.type === 'seed-export').length,
    seedImportMs: stats(rows.filter(row => row.type === 'seed-import-end').map(row => row.durationMs)),
    completedSJobs: completed,
    inputErrors: rows.filter(row => row.type === 'input-error'),
    peakDisplayInterval: displays.slice(1).map((row, index) => ({
      intervalMs: row.paintedAt - displays[index].paintedAt,
      previous: { lane: displays[index].lane, revision: displays[index].inputRevision },
      next: { lane: row.lane, revision: row.inputRevision },
      job: completed.find(job => job.jobId === row.jobId) ?? null,
      phase: row.phase, previousPhase: displays[index].phase,
    })).filter(row => row.phase === 'continuous' && row.previousPhase === 'continuous').sort((a, b) => b.intervalMs - a.intervalMs)[0] ?? null,
  });
}
await fs.writeFile(path.join(directory, 'display-timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
await fs.writeFile(path.join(directory, 'stage-summary.json'), JSON.stringify(stages, null, 2) + '\n');
console.log(JSON.stringify(stages.map(({ completedSJobs, inputErrors, ...row }) => ({ ...row, inputErrorCount: inputErrors.length })), null, 2));
