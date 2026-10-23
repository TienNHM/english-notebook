// Builds notebook items from agent requests. Same item shape as the app and the MCP server.
export const LIMITS = { text: 500, meaning: 500, example: 500, note: 500, original: 1000, expressions: 5, tags: 8, tag: 30, query: 100 };

const clean = s => String(s ?? "").trim();
const rid = () => Date.now().toString(36) + [...crypto.getRandomValues(new Uint8Array(3))].map(b => b.toString(16).padStart(2, "0")).join("");

export class Invalid extends Error {}

function str(o, k, { required = false } = {}) {
  const v = o?.[k];
  if (v != null && typeof v !== "string") throw new Invalid(`${k} must be a string`);
  const s = clean(v);
  if (required && !s) throw new Invalid(`${k} is required`);
  if (s.length > LIMITS[k]) throw new Invalid(`${k} is too long (max ${LIMITS[k]})`);
  return s;
}
function tagList(t) {
  if (t == null) return [];
  if (!Array.isArray(t)) throw new Invalid("tags must be an array");
  if (t.length > LIMITS.tags) throw new Invalid(`too many tags (max ${LIMITS.tags})`);
  return t.map(x => {
    if (typeof x !== "string") throw new Invalid("tags must be strings");
    const s = clean(x).toLowerCase();
    if (s.length > LIMITS.tag) throw new Invalid("a tag is too long");
    return s;
  }).filter(Boolean);
}

const mk = (o, now) => ({
  id: rid(), example: "", note: "", original: "", sourceId: "", source: "claude", tags: [],
  box: 0, due: now, created: now, reviews: 0, ...o,
});

export function buildVocabulary(body, now = Date.now()) {
  const text = str(body, "text", { required: true });
  const kind = body?.kind;
  if (kind != null && kind !== "word" && kind !== "phrase") throw new Invalid("kind must be word or phrase");
  return [mk({
    type: kind ?? (/\s/.test(text) ? "phrase" : "word"), text, meaning: str(body, "meaning", { required: true }),
    example: str(body, "example"), note: str(body, "note"), tags: tagList(body?.tags),
  }, now)];
}

export function buildSentence(body, now = Date.now()) {
  const parent = mk({
    type: "sentence", text: str(body, "text", { required: true }), meaning: str(body, "meaning", { required: true }),
    original: str(body, "original"), note: str(body, "note"), tags: tagList(body?.tags),
  }, now);
  const ex = body?.expressions ?? [];
  if (!Array.isArray(ex)) throw new Invalid("expressions must be an array");
  if (ex.length > LIMITS.expressions) throw new Invalid(`too many expressions (max ${LIMITS.expressions})`);
  const kids = ex.map(x => mk({
    type: "phrase", text: str(x, "text", { required: true }), meaning: str(x, "meaning", { required: true }),
    sourceId: parent.id, tags: parent.tags,
  }, now));
  return [parent, ...kids];
}

// Removes entries already in the notebook (case-insensitive on text) and duplicates inside the request.
export function dropDuplicates(entries, existing) {
  const seen = new Set(existing.map(i => String(i.text).toLowerCase()));
  const fresh = [], skipped = [];
  for (const e of entries) {
    const k = e.text.toLowerCase();
    if (seen.has(k)) { skipped.push(e.text); continue; }
    seen.add(k); fresh.push(e);
  }
  return { fresh, skipped };
}
