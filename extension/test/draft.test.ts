import { test } from "node:test";
import assert from "node:assert/strict";
import { SettingsDraft } from "../src/services/settings-draft.js";
import { SettingsService } from "../src/services/settings-service.js";
import { EditorStore, PreferencesMemory } from "./fixtures.js";

async function view(work: string) {
  const documents = new EditorStore(); documents.set("file:///settings", '{"settingsVersion":1}');
  const service = new SettingsService(documents, new PreferencesMemory()); service.activate(work, "file:///settings");
  return service.read("project");
}
test("dirty target switch is blocked; work switch preserves drafts and ignores old replies", async () => {
  const draft = new SettingsDraft(), a = await view("A"), b = await view("B");
  draft.select("A", "project"); draft.receive(draft.begin("loading"), a);
  draft.change("layout.fontSize", "10pt");
  assert.throws(() => draft.select("A", "defaults"), /未適用/u);
  const oldRequest = draft.begin("saving"); draft.select("B", "project");
  assert.equal(draft.receive(oldRequest, a, true), false);
  draft.receive(draft.begin("loading"), b); assert.equal(draft.view().dirty, false);
  draft.select("A", "project"); assert.equal(draft.view().changes["layout.fontSize"], "10pt");
  draft.receive(draft.begin("loading"), a); assert.equal(draft.view().phase, "conflict"); assert(draft.view().dirty);
});
test("invalidations and errors keep draft; explicit reload/discard clears only draft", async () => {
  const draft = new SettingsDraft(), base = await view("A"); draft.select("A", "project");
  draft.receive(draft.begin("loading"), base); draft.change("layout.fontSize", "10pt");
  draft.invalidate(); assert(draft.view().dirty);
  draft.fail(draft.begin("saving"), "timeout"); assert.equal(draft.view().phase, "error"); assert(draft.view().dirty);
  draft.receive(draft.begin("loading"), base, true); assert.equal(draft.view().dirty, false);
  draft.change("layout.fontSize", "10pt"); draft.change("layout.fontSize", base.values["layout.fontSize"]);
  assert.equal(draft.view().dirty, false); draft.close(); assert.throws(() => draft.view());
});
