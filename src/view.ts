import { Component, ItemView, Keymap, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, debounce, moment, setIcon } from "obsidian";
import type DailyTimelinePlugin from "./main";
import { ICON_ID } from "./main";
import { Post, appendLine, countReplies, insertReply, parsePosts, replaceText, sortNewestFirst } from "./parse";

export const VIEW_TYPE = "daily-timeline-view";
const PAGE = 5;

interface Day {
  file: TFile;
  date: moment.Moment;
}

export class TimelineView extends ItemView {
  private scrollEl!: HTMLElement;
  private listEl!: HTMLElement;
  private shown = PAGE;
  private composeOpen = false;
  private replyKey: string | null = null;
  private editKey: string | null = null;
  private dirty = false;
  private renderToken = 0;
  private renderComp: Component | null = null;
  private totalDays = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: DailyTimelinePlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Obitter";
  }
  getIcon() {
    return ICON_ID;
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("dt-view");

    this.scrollEl = root.createDiv("dt-scroll");
    this.listEl = this.scrollEl.createDiv("dt-list");
    this.scrollEl.addEventListener("scroll", () => this.maybeLoadMore());

    const fab = root.createEl("button", { cls: "dt-fab", attr: { "aria-label": "Post" } });
    setIcon(fab, "pencil");
    fab.addEventListener("click", () => {
      this.composeOpen = !this.composeOpen;
      this.replyKey = null;
      this.editKey = null;
      void this.render().then(() => this.listEl.querySelector<HTMLTextAreaElement>(".dt-compose textarea")?.focus());
    });

    const onChange = debounce((f: unknown) => {
      if (f instanceof TFile && this.inScope(f)) this.refresh();
    }, 300);
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
    this.registerEvent(this.app.vault.on("rename", onChange));

    await this.render();
  }

  async onClose() {
    this.renderToken++;
  }

  refresh() {
    if (this.hasDraft()) {
      this.dirty = true;
      return;
    }
    void this.render();
  }

  private hasDraft(): boolean {
    return Array.from(this.contentEl.querySelectorAll("textarea")).some((t) => t.value.trim());
  }

  private inScope(f: TFile): boolean {
    return f.extension === "md" && f.path.startsWith(this.plugin.folderPrefix());
  }

  private listDays(): Day[] {
    const prefix = this.plugin.folderPrefix();
    const days: Day[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(prefix)) continue;
      const rel = f.path.slice(prefix.length, -3);
      const date = moment(rel, this.plugin.settings.format, true);
      if (date.isValid()) days.push({ file: f, date });
    }
    return days.sort((a, b) => b.date.valueOf() - a.date.valueOf());
  }

  private async render() {
    const token = ++this.renderToken;
    this.dirty = false;
    const days = this.listDays();
    this.totalDays = days.length;
    const visible = days.slice(0, this.shown);

    const loaded: { day: Day; posts: Post[] }[] = [];
    for (const day of visible) {
      const data = await this.app.vault.cachedRead(day.file);
      loaded.push({ day, posts: parsePosts(data) });
    }
    if (token !== this.renderToken) return;

    if (this.renderComp) this.removeChild(this.renderComp);
    this.renderComp = new Component();
    this.addChild(this.renderComp);

    const scrollTop = this.scrollEl.scrollTop;
    this.listEl.empty();

    if (this.composeOpen) this.renderComposer(this.listEl, "ポスト", "いまどうしてる？", (t) => this.post(t));

    let any = false;
    for (const { day, posts } of loaded) {
      if (!posts.length) continue;
      any = true;
      for (const p of sortNewestFirst(posts)) this.renderPost(this.listEl, p, day, 0);
    }
    if (!any) this.listEl.createDiv({ cls: "dt-empty", text: "まだポストがありません" });

    this.scrollEl.scrollTop = scrollTop;
    requestAnimationFrame(() => this.maybeLoadMore());
  }

  private maybeLoadMore() {
    const el = this.scrollEl;
    if (this.shown >= this.totalDays) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) {
      this.shown += PAGE;
      void this.render();
    }
  }

  private renderPost(parent: HTMLElement, p: Post, day: Day, depth: number) {
    const s = this.plugin.settings;
    const key = `${day.file.path}:${p.lineNo}`;
    const wrap = parent.createDiv("dt-thread");
    const row = wrap.createDiv("dt-post");

    const avatar = row.createDiv("dt-avatar");
    const img = s.avatarPath ? this.app.vault.getAbstractFileByPath(s.avatarPath) : null;
    if (img instanceof TFile) avatar.createEl("img", { attr: { src: this.app.vault.getResourcePath(img) } });
    else avatar.setText((s.displayName || "?").slice(0, 1).toUpperCase());

    const body = row.createDiv("dt-body");
    const head = body.createDiv("dt-head");
    head.createSpan({ cls: "dt-name", text: s.displayName });
    head.createSpan({ cls: "dt-handle", text: `@${s.handle}` });
    head.createSpan({ cls: "dt-dot", text: "·" });
    const when = this.postMoment(day, p);
    const time = head.createEl("a", { cls: "dt-time", text: this.relTime(when, p.time !== null) });
    time.setAttr("title", when.format(p.time ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD"));
    time.addEventListener("click", (e) => {
      e.preventDefault();
      void this.app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(day.file);
    });

    if (this.editKey === key) {
      const slot = body.createDiv("dt-edit-compose");
      this.renderComposer(slot, "保存", "", (t) => this.edit(day.file, p, t), {
        initial: p.text.replace(/<br\s*\/?>/gi, "\n"),
        onCancel: () => {
          this.editKey = null;
          void this.render();
        },
      });
    } else {
      const text = body.createDiv("dt-text");
      void MarkdownRenderer.render(this.app, p.text, text, day.file.path, this.renderComp!);
      const linkOf = (e: Event) => (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
      text.addEventListener(
        "click",
        (e) => {
          const a = linkOf(e);
          if (!a) return;
          e.preventDefault();
          e.stopPropagation();
          const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
          void this.app.workspace.openLinkText(href, day.file.path, Keymap.isModEvent(e as MouseEvent));
        },
        true
      );
      text.addEventListener("mouseover", (e) => {
        const a = linkOf(e);
        if (!a) return;
        this.app.workspace.trigger("hover-link", {
          event: e,
          source: VIEW_TYPE,
          hoverParent: this,
          targetEl: a,
          linktext: a.getAttribute("data-href") ?? "",
          sourcePath: day.file.path,
        });
      });
    }

    const actions = body.createDiv("dt-actions");
    const replies = countReplies(p);
    const replyBtn = actions.createEl("button", { cls: "dt-action dt-reply", attr: { "aria-label": "Reply" } });
    setIcon(replyBtn.createSpan("dt-action-icon"), "message-circle");
    if (replies) replyBtn.createSpan({ cls: "dt-count", text: String(replies) });
    replyBtn.addEventListener("click", () => {
      this.replyKey = this.replyKey === key ? null : key;
      this.composeOpen = false;
      this.editKey = null;
      void this.render().then(() => this.listEl.querySelector<HTMLTextAreaElement>(".dt-reply-compose textarea")?.focus());
    });

    const editBtn = actions.createEl("button", { cls: "dt-action dt-edit", attr: { "aria-label": "Edit" } });
    setIcon(editBtn.createSpan("dt-action-icon"), "pencil");
    editBtn.addEventListener("click", () => {
      this.editKey = this.editKey === key ? null : key;
      this.replyKey = null;
      this.composeOpen = false;
      void this.render().then(() => this.listEl.querySelector<HTMLTextAreaElement>(".dt-edit-compose textarea")?.focus());
    });

    if (this.replyKey === key) {
      const slot = body.createDiv("dt-reply-compose");
      this.renderComposer(slot, "返信", "返信をポスト", (t) => this.reply(day.file, p, t));
    }

    if (p.children.length) {
      const kids = wrap.createDiv("dt-replies");
      for (const c of p.children) this.renderPost(kids, c, day, depth + 1);
    }
  }

  private renderComposer(
    parent: HTMLElement,
    label: string,
    placeholder: string,
    onSubmit: (t: string) => Promise<void>,
    opts: { initial?: string; onCancel?: () => void } = {}
  ) {
    const box = parent.createDiv("dt-compose");
    const ta = box.createEl("textarea", { attr: { rows: "2", placeholder } });
    if (opts.initial) {
      ta.value = opts.initial;
      requestAnimationFrame(() => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + "px";
      });
    }
    const bar = box.createDiv("dt-compose-bar");
    bar.createSpan({ cls: "dt-hint", text: "Cmd/Ctrl + Enter" });
    if (opts.onCancel) {
      const cancel = bar.createEl("button", { cls: "dt-cancel", text: "キャンセル" });
      cancel.addEventListener("click", () => opts.onCancel!());
    }
    const btn = bar.createEl("button", { cls: "dt-submit", text: label });

    const grow = () => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    };
    const submit = async () => {
      const t = ta.value.trim();
      if (!t) return;
      btn.disabled = true;
      try {
        await onSubmit(t);
      } catch (e) {
        console.error(e);
        new Notice("書き込みに失敗しました");
        btn.disabled = false;
      }
    };
    ta.addEventListener("input", grow);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing) {
        e.preventDefault();
        void submit();
      }
    });
    btn.addEventListener("click", () => void submit());
  }

  private async post(text: string) {
    const file = await this.plugin.getOrCreateToday();
    const line = `- ${moment().format("HH:mm")} ${text.replace(/\r?\n/g, "<br>")}`;
    await this.app.vault.process(file, (d) => appendLine(d, line));
    this.composeOpen = false;
    this.shown = Math.max(this.shown, PAGE);
    await this.render();
    this.scrollEl.scrollTop = 0;
  }

  private async reply(file: TFile, parent: Post, text: string) {
    const line = `${moment().format("HH:mm")} ${text.replace(/\r?\n/g, "<br>")}`;
    let ok = true;
    await this.app.vault.process(file, (d) => {
      const out = insertReply(d, parent, line);
      if (out === null) ok = false;
      return out ?? d;
    });
    if (!ok) new Notice("返信先が見つかりません。ノートが変更された可能性があります");
    this.replyKey = null;
    await this.render();
  }

  private async edit(file: TFile, p: Post, text: string) {
    const body = text.replace(/\r?\n/g, "<br>");
    let ok = true;
    await this.app.vault.process(file, (d) => {
      const out = replaceText(d, p, body);
      if (out === null) ok = false;
      return out ?? d;
    });
    if (!ok) new Notice("対象の行が見つかりません。ノートが変更された可能性があります");
    this.editKey = null;
    await this.render();
  }

  private postMoment(day: Day, p: Post): moment.Moment {
    const m = day.date.clone().startOf("day");
    if (p.time) {
      const [h, min] = p.time.split(":").map(Number);
      m.hour(h).minute(min);
    }
    return m;
  }

  private relTime(m: moment.Moment, hasTime: boolean): string {
    const now = moment();
    if (!hasTime) {
      const d = now.clone().startOf("day").diff(m, "days");
      return d <= 0 ? "今日" : `${d}日前`;
    }
    const sec = Math.max(0, now.diff(m, "seconds"));
    if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}分前`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
    const days = Math.floor(sec / 86400);
    if (days < 30) return `${days}日前`;
    if (days < 365) return `${Math.floor(days / 30)}ヶ月前`;
    return `${Math.floor(days / 365)}年前`;
  }
}
