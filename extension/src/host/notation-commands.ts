import * as vscode from "vscode";

type NotationKind = "ruby" | "emphasis";

export function registerNotationCommands(context: vscode.ExtensionContext): void {
  async function annotate(kind: NotationKind): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "novel") return;
    const document = editor.document, version = document.version;
    const selections = editor.selections.filter(selection => !selection.isEmpty);
    if (!selections.length) { void vscode.window.showInformationMessage("Ogenkou: 記法を付ける文字を選択してください。"); return; }
    const config = vscode.workspace.getConfiguration("ogenkou", document.uri);
    const notation = config.get<string>(kind === "ruby" ? "editing.rubyNotation" : "editing.emphasisNotation", kind === "ruby" ? "pipeAngle" : "doubleAngle");
    const allowed = kind === "ruby" ? ["pipeAngle", "bracket"] : ["doubleAngle", "bracket"];
    if (!allowed.includes(notation)) { void vscode.window.showWarningMessage("Ogenkou: ルビ・傍点の記法設定を選び直してください。"); return; }
    const texts = selections.map(selection => document.getText(selection));
    // These delimiters cannot be nested or escaped in the supported manuscript grammar.
    const invalidBase = kind === "ruby" ? notation === "pipeAngle" ? /[｜|《》\r\n]/u : /[>\]\r\n]/u : notation === "doubleAngle" ? /[《》\r\n]/u : /[>\]\r\n]/u;
    if (texts.some(text => invalidBase.test(text))) { void vscode.window.showWarningMessage("Ogenkou: 改行や記法の区切り文字を含めずに選択してください。"); return; }
    const changes = selections.map((selection, index) => {
      const text = texts[index]!;
      const prefix = notation === "pipeAngle" ? "｜" + text + "《" : "[[rb:" + text + ">";
      const replacement = kind === "ruby" ? prefix + (notation === "pipeAngle" ? "》" : "]]")
        : notation === "doubleAngle" ? "《《" + text + "》》" : "[[emphasismark:" + text + ">﹅]]";
      return {selection, index, start: document.offsetAt(selection.start), end: document.offsetAt(selection.end), replacement, readingOffset: prefix.length};
    });
    // Each earlier replacement shifts the subsequent insertion points in UTF-16 units.
    const carets: number[] = []; let delta = 0;
    for (const change of [...changes].sort((a, b) => a.start - b.start)) {
      carets[change.index] = change.start + delta + change.readingOffset;
      delta += change.replacement.length - (change.end - change.start);
    }
    const applied = await editor.edit(edit => changes.forEach(change => edit.replace(change.selection, change.replacement)), {undoStopBefore: true, undoStopAfter: true});
    if (!applied) { void vscode.window.showWarningMessage("Ogenkou: 記法を追加できませんでした。原稿が編集可能か確認してください。"); return; }
    if (kind === "ruby" && !document.isClosed && document.version === version + 1) {
      editor.selections = carets.map(offset => { const point = document.positionAt(offset); return new vscode.Selection(point, point); });
    }
  }
  context.subscriptions.push(...(["ruby", "emphasis"] as const).map(kind => vscode.commands.registerCommand(kind === "ruby" ? "ogenkou.text.addRuby" : "ogenkou.text.addEmphasis", () => annotate(kind).catch(error => { void vscode.window.showErrorMessage("Ogenkou: " + String(error)); }))));
}
