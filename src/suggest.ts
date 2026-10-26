import { App, TFile } from "obsidian";

interface Candidate {
  file: TFile;
  alias: string | null;
  label: string;
}

const MAX = 8;
const TRIGGER_RE = /\[\[([^\[\]|\n]*)$/;

function collect(app: App, query: string): Candidate[] {
  const q = query.toLowerCase();
  const scored: { c: Candidate; score: number; mtime: number }[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    const names: { label: string; alias: string | null }[] = [{ label: file.basename, alias: null }];
    const raw = app.metadataCache.getFileCache(file)?.frontmatter?.aliases;
    const aliases: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    for (const a of aliases) if (typeof a === "string" && a) names.push({ label: a, alias: a });

    for (const n of names) {
      const l = n.label.toLowerCase();
      const idx = q ? l.indexOf(q) : 0;
      if (idx < 0) continue;
      scored.push({ c: { file, alias: n.alias, label: n.label }, score: idx === 0 ? 0 : 1, mtime: file.stat.mtime });
    }
  }

  scored.sort((a, b) => a.score - b.score || b.mtime - a.mtime);
  return scored.slice(0, MAX).map((s) => s.c);
}

export function attachLinkSuggest(app: App, ta: HTMLTextAreaElement, sourcePath: string) {
  let box: HTMLElement | null = null;
  let items: Candidate[] = [];
  let active = 0;
  let start = -1;

  const close = () => {
    box?.remove();
    box = null;
    items = [];
    start = -1;
  };

  const highlight = () => {
    box?.querySelectorAll(".dt-suggest-item").forEach((el, i) => el.toggleClass("is-active", i === active));
  };

  const choose = (c: Candidate) => {
    const linktext = app.metadataCache.fileToLinktext(c.file, sourcePath);
    const link = c.alias ? `${linktext}|${c.alias}` : linktext;
    const cursor = ta.selectionStart;
    const after = ta.value.slice(cursor);
    ta.value = ta.value.slice(0, start) + link + (after.startsWith("]]") ? "" : "]]") + after;
    const pos = start + link.length + 2;
    ta.setSelectionRange(pos, pos);
    close();
    ta.dispatchEvent(new Event("input"));
    ta.focus();
  };

  const show = (query: string) => {
    items = collect(app, query);
    if (!items.length) return close();
    active = 0;
    if (!box) box = document.body.createDiv("dt-suggest");
    box.empty();
    items.forEach((c, i) => {
      const el = box!.createDiv("dt-suggest-item");
      el.createSpan({ cls: "dt-suggest-name", text: c.label });
      if (c.alias) el.createSpan({ cls: "dt-suggest-sub", text: c.file.basename });
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(items[i]);
      });
    });
    const r = ta.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.bottom + 4}px`;
    box.style.minWidth = `${Math.min(r.width, 320)}px`;
    highlight();
  };

  ta.addEventListener("input", () => {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = TRIGGER_RE.exec(before);
    if (!m) return close();
    start = before.length - m[1].length;
    show(m[1]);
  });

  ta.addEventListener("keydown", (e) => {
    if (!box || e.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      highlight();
    } else if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  ta.addEventListener("blur", close);
}
