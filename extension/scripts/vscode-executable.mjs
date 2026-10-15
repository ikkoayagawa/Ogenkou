import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function vscodeExecutable() {
  if (process.env.VSCODE_EXECUTABLE_PATH) return process.env.VSCODE_EXECUTABLE_PATH;
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Microsoft VS Code', 'Code.exe'),
  ] : process.platform === 'darwin' ? ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron'] : ['/usr/bin/code', '/usr/share/code/code'];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('Set VSCODE_EXECUTABLE_PATH to the installed VS Code executable.');
  return found;
}
