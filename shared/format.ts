// Turn quiz text into safe HTML.
// Allowed: **bold**, <br>, <b>/<strong>/<i>/<em>/<u>, and <img src="https://...">.
// Everything else is escaped, so a quiz file can never run code.

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const IMG_RE = /<img\b[^>]*?\bsrc\s*=\s*(["'])(https?:\/\/[^"'\s>]+)\1[^>]*>/gi;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<(\/?)(b|strong|i|em|u)\s*>/gi;

export function richHtml(text: string, { images = true } = {}): string {
  const tokens: string[] = [];
  const keep = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;

  let s = text
    .replace(IMG_RE, (_m, _q, url: string) =>
      images ? keep(`<img class="rich-img" src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer" loading="eager">`) : "",
    )
    .replace(BR_RE, () => keep("<br>"))
    .replace(TAG_RE, (_m, close: string, tag: string) => {
      const t = tag.toLowerCase() === "b" ? "strong" : tag.toLowerCase() === "i" ? "em" : tag.toLowerCase();
      return keep(`<${close}${t}>`);
    });

  s = escapeHtml(s);
  // **bold** (non-greedy, may not span placeholders oddly)
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)]);
}

/** Plain text, for short previews. */
export function plainText(text: string): string {
  return text.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}
