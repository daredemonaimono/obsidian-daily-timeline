export const LIKE_MARK = " ♥";

export interface Post {
  lineNo: number;
  raw: string;
  indentStr: string;
  indent: number;
  time: string | null;
  text: string;
  liked: boolean;
  children: Post[];
}

const LIST_RE = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/;
const TIME_RE = /^(\d{1,2}:\d{2})\s+([\s\S]*)$/;

export function indentWidth(s: string): number {
  let w = 0;
  for (const c of s) w += c === "\t" ? 4 : 1;
  return w;
}

export function listIndent(line: string): number | null {
  const m = LIST_RE.exec(line);
  return m ? indentWidth(m[1]) : null;
}

export function parsePosts(data: string): Post[] {
  const lines = data.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) i = end + 1;
  }

  const roots: Post[] = [];
  const stack: Post[] = [];
  let inFence = false;

  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !raw.trim() || /^#{1,6}\s/.test(raw)) continue;

    const m = LIST_RE.exec(raw);
    const indentStr = m ? m[1] : "";
    const indent = m ? indentWidth(indentStr) : 0;
    let body = m ? m[2] : raw.trim();

    let time: string | null = null;
    const tm = TIME_RE.exec(body);
    if (tm) {
      time = tm[1].padStart(5, "0");
      body = tm[2];
    }
    let liked = false;
    if (body.endsWith(LIKE_MARK)) {
      liked = true;
      body = body.slice(0, -LIKE_MARK.length);
    }

    const post: Post = { lineNo: i, raw, indentStr, indent, time, text: body.trim(), liked, children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(post);
    else roots.push(post);
    stack.push(post);
  }
  return roots;
}

export function countReplies(p: Post): number {
  return p.children.reduce((n, c) => n + 1 + countReplies(c), 0);
}

export function appendLine(data: string, line: string): string {
  const base = data.replace(/\s+$/, "");
  return (base ? base + "\n" : "") + line + "\n";
}

function locate(lines: string[], lineNo: number, raw: string): number {
  if (lines[lineNo] === raw) return lineNo;
  return lines.indexOf(raw);
}

export function insertReply(data: string, parent: Post, replyLine: string): string | null {
  const lines = data.split("\n");
  const idx = locate(lines, parent.lineNo, parent.raw);
  if (idx < 0) return null;
  let end = idx + 1;
  while (end < lines.length) {
    const w = listIndent(lines[end]);
    if (w === null || w <= parent.indent) break;
    end++;
  }
  lines.splice(end, 0, `${parent.indentStr}\t- ${replyLine}`);
  return lines.join("\n");
}

// Newest first by time of day; posts without a time inherit the previous timed post's.
export function sortNewestFirst(posts: Post[]): Post[] {
  let last = "00:00";
  const keyed = posts.map((p) => {
    if (p.time) last = p.time;
    return { p, t: last };
  });
  return keyed
    .sort((a, b) => (a.t === b.t ? b.p.lineNo - a.p.lineNo : a.t < b.t ? 1 : -1))
    .map((k) => k.p);
}

export function replaceText(data: string, post: Post, newText: string): string | null {
  const lines = data.split("\n");
  const idx = locate(lines, post.lineNo, post.raw);
  if (idx < 0) return null;
  const prefix = /^(\s*(?:[-*+]|\d+\.)\s+)/.exec(post.raw)?.[1] ?? "";
  const time = post.time ? `${post.time} ` : "";
  lines[idx] = `${prefix}${time}${newText}${post.liked ? LIKE_MARK : ""}`;
  return lines.join("\n");
}
