import { App, Plugin, PluginSettingTab, Setting, TFile, moment, normalizePath } from "obsidian";
import { TimelineView, VIEW_TYPE } from "./view";

export interface TimelineSettings {
  folder: string;
  format: string;
  displayName: string;
  handle: string;
  avatarPath: string;
}

const DEFAULTS: TimelineSettings = {
  folder: "",
  format: "YYYY-MM-DD",
  displayName: "name",
  handle: "name",
  avatarPath: "",
};

export default class DailyTimelinePlugin extends Plugin {
  settings: TimelineSettings = { ...DEFAULTS };

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new TimelineView(leaf, this));
    this.addRibbonIcon("twitter", "Open Obitter", () => this.activateView());
    this.addCommand({
      id: "open-daily-timeline",
      name: "Open Obitter",
      callback: () => this.activateView(),
    });
    this.addSettingTab(new TimelineSettingTab(this.app, this));
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<TimelineSettings> | null;
    const base = { ...DEFAULTS };
    if (!saved) {
      const core = (this.app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options;
      if (core?.folder) base.folder = core.folder;
      if (core?.format) base.format = core.format;
    }
    this.settings = Object.assign(base, saved);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => (l.view as TimelineView).refresh());
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  folderPrefix(): string {
    const f = normalizePath(this.settings.folder || "/");
    return f === "/" ? "" : f + "/";
  }

  async getOrCreateToday(): Promise<TFile> {
    const path = normalizePath(`${this.folderPrefix()}${moment().format(this.settings.format)}.md`);
    const found = this.app.vault.getAbstractFileByPath(path);
    if (found instanceof TFile) return found;

    const parts = path.split("/").slice(0, -1);
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) await this.app.vault.createFolder(cur);
    }
    return this.app.vault.create(path, "");
  }
}

class TimelineSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DailyTimelinePlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    const text = (name: string, desc: string, key: keyof TimelineSettings, placeholder = "") =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) =>
          t.setPlaceholder(placeholder).setValue(s[key]).onChange(async (v) => {
            s[key] = v.trim();
            await this.plugin.saveSettings();
          })
        );

    text("Daily note folder", "Leave empty for the vault root.", "folder", "Daily");
    text("Date format", "Moment format of the daily note file name.", "format", "YYYY-MM-DD");
    text("Display name", "Shown on each post.", "displayName");
    text("Handle", "Shown after the display name, without @.", "handle");
    text("Avatar image", "Vault path to an image, e.g. attachments/me.png.", "avatarPath");
  }
}
