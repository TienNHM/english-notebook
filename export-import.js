// Pure text import/export for the Library: CSV, Anki TSV and pasted lines.
// No DOM, no storage: everything takes and returns plain data so it is easy to test.

export const BOM = "﻿";
export const MAX_IMPORT = 2000;
export const CSV_COLUMNS = ["type", "text", "meaning", "example", "note", "original", "tags", "box", "created"];

import { normTag as bulkNormTag, dupKey as bulkDupKey } from "./bulk.js";

const TYPES = ["word", "phrase", "sentence"];

// ---------- helpers ----------
const str = v => (v == null ? "" : String(v));

// One definition of tags and duplicate keys (bulk.js); these wrappers only accept non-string input too.
export const normTag = t => bulkNormTag(str(t));
export const dupKey = text => bulkDupKey(str(text));

function normTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const n = normTag(t);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function splitTags(s) {
  return normTags(str(s).split(";"));
}

export function guessType(text) {
  const t = str(text).trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words > 4 || /[.?!]$/.test(t)) return "sentence";
  if (words >= 2) return "phrase";
  return "word";
}

function pickType(raw, defaults, text) {
  const r = str(raw).trim().toLowerCase();
  if (TYPES.includes(r)) return r;
  if (defaults && TYPES.includes(defaults.type)) return defaults.type;
  return guessType(text);
}

// ---------- CSV export ----------
// Spreadsheet programs run a cell that starts with = + - @ tab or CR as a formula. Card text can come from an AI agent or an
// imported file, so such text gets a leading apostrophe (parseCsv removes the one we add).
const FORMULA_START = /^[=+\-@\t\r]/;
function csvField(v, text = true) {
  let s = str(v);
  if (text && FORMULA_START.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The caller prepends BOM when writing a file for Excel.
export function toCsv(items) {
  const rows = [CSV_COLUMNS.join(",")];
  for (const i of items || []) {
    rows.push([
      i.type, i.text, i.meaning, i.example, i.note, i.original,
      (Array.isArray(i.tags) ? i.tags : []).join(";"),
      i.box ?? 0, i.created ?? "",
    ].map((v, n) => csvField(v, n < 7)).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

// ---------- Anki TSV export ----------
// Fields cannot hold tabs or raw newlines, so they are turned into a space and <br>.
// Anki reads fields as HTML, so & < > are escaped first: card text shows as typed and cannot inject markup.
function ankiField(v) {
  return str(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\t/g, " ").replace(/\r\n|\r|\n/g, "<br>");
}

export function toAnkiTsv(items) {
  const lines = [];
  for (const i of items || []) {
    const back = [i.meaning, i.example, i.note].map(ankiField).filter(Boolean).join("<br>");
    const tags = (Array.isArray(i.tags) ? i.tags : [])
      .map(t => str(t).trim().replace(/\s+/g, "_")).filter(Boolean).join(" ");
    lines.push([ankiField(i.text), back, tags].join("\t"));
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

// ---------- CSV parsing ----------
// Returns records of { line, fields[], error? }; `line` is the 1-based physical line where the record starts.
function csvRecords(text) {
  const s = str(text).replace(/^﻿/, "");
  const records = [];
  let fields = [], field = "", inQ = false, quoted = false, line = 1, start = 1, any = false;
  const endField = () => { fields.push(field); field = ""; quoted = false; };
  const endRecord = () => {
    endField();
    if (any || fields.length > 1 || fields[0] !== "") records.push({ line: start, fields });
    fields = []; any = false;
  };
  for (let n = 0; n < s.length; n++) {
    const c = s[n];
    if (inQ) {
      if (c === '"') {
        if (s[n + 1] === '"') { field += '"'; n++; } else inQ = false;
      } else { if (c === "\n") line++; field += c; }
      continue;
    }
    if (c === '"' && field === "" && !quoted) { inQ = true; quoted = true; any = true; continue; }
    if (c === ",") { endField(); any = true; continue; }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && s[n + 1] === "\n") n++;
      endRecord();
      line++; start = line;
      continue;
    }
    field += c;
    any = true;
  }
  if (inQ) {
    // Unterminated quote: keep what we have but flag it.
    endField();
    records.push({ line: start, fields, error: "Dấu ngoặc kép không được đóng" });
  } else if (any || field !== "" || fields.length) {
    endRecord();
  }
  return records;
}

// Undo the apostrophe that toCsv adds in front of text that looks like a formula.
const unguard = v => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

const HEADER_NAMES = new Set(CSV_COLUMNS);
const POSITIONAL = ["text", "meaning", "example", "note", "tags"];

// Parses CSV text into [{ line, type, text, meaning, example, note, original, tags[] , error? }].
// The first record is a header when it names a "text" column; otherwise columns are
// positional: text, meaning, example, note, tags.
export function parseCsv(text, defaults = {}) {
  const recs = csvRecords(text);
  if (!recs.length) return [];
  let cols = POSITIONAL;
  let body = recs;
  const head = recs[0].fields.map(f => f.trim().toLowerCase());
  if (head.includes("text") && head.every(h => !h || HEADER_NAMES.has(h) || /^[a-z_ ]+$/.test(h))) {
    cols = head;
    body = recs.slice(1);
  }
  const out = [];
  for (const r of body) {
    const get = name => {
      const idx = cols.indexOf(name);
      const v = idx >= 0 ? str(r.fields[idx]) : "";
      return name === "type" ? v : unguard(v);
    };
    const t = get("text").trim();
    const item = {
      line: r.line,
      type: pickType(get("type"), defaults, t),
      text: t,
      meaning: get("meaning").trim(),
      example: get("example").trim(),
      note: get("note").trim(),
      original: get("original").trim(),
      tags: splitTags(get("tags")),
    };
    if (r.error) item.error = r.error;
    out.push(item);
  }
  return out;
}

// ---------- pasted lines ----------
// Formats: "text | meaning | example", "text = meaning", "text<TAB>meaning<TAB>example".
export function parseLines(text, defaults = {}) {
  const out = [];
  const lines = str(text).replace(/^﻿/, "").split(/\r\n|\r|\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    let parts;
    if (line.includes("\t")) parts = line.split("\t");
    else if (line.includes("|")) parts = line.split("|");
    else if (line.includes("=")) {
      const k = line.indexOf("=");
      parts = [line.slice(0, k), line.slice(k + 1)];
    } else parts = [line];
    parts = parts.map(p => p.trim());
    const t = parts[0] || "";
    out.push({
      line: idx + 1,
      type: pickType("", defaults, t),
      text: t,
      meaning: parts[1] || "",
      example: parts[2] || "",
      note: parts[3] || "",
      original: "",
      tags: [],
    });
  });
  return out;
}

// ---------- preparing the import ----------
function defaultMakeId(now) {
  let n = 0;
  return () => `i${now.toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Splits parsed rows into new cards, duplicates (skipped) and unusable rows (invalid).
// Nothing in `existingItems` is changed.
export function prepareImport(existingItems, parsed, { tag = "imported", nowMs = Date.now(), makeId } = {}) {
  const newId = makeId || defaultMakeId(nowMs);
  const seen = new Set((existingItems || []).map(i => dupKey(i.text)));
  const importTag = normTag(tag);
  const fresh = [], skipped = [], invalid = [];
  for (const p of parsed || []) {
    const text = str(p.text).trim();
    const meaning = str(p.meaning).trim();
    if (p.error) { invalid.push({ line: p.line, reason: p.error }); continue; }
    if (!text) { invalid.push({ line: p.line, reason: "Thiếu nội dung thẻ" }); continue; }
    if (!meaning) { invalid.push({ line: p.line, reason: "Thiếu nghĩa" }); continue; }
    const key = dupKey(text);
    if (!key) { invalid.push({ line: p.line, reason: "Thiếu nội dung thẻ" }); continue; }
    if (seen.has(key)) { skipped.push({ text, reason: "Đã có trong sổ" }); continue; }
    if (fresh.length >= MAX_IMPORT) {
      invalid.push({ line: p.line, reason: `Vượt giới hạn ${MAX_IMPORT.toLocaleString("vi-VN")} thẻ mỗi lần nhập` });
      continue;
    }
    seen.add(key);
    const tags = normTags([...(Array.isArray(p.tags) ? p.tags : []), importTag]);
    fresh.push({
      id: newId(),
      type: TYPES.includes(p.type) ? p.type : guessType(text),
      text, meaning,
      example: str(p.example).trim(),
      note: str(p.note).trim(),
      original: str(p.original).trim(),
      sourceId: "",
      source: "manual",
      tags,
      box: 0,
      due: nowMs,
      created: nowMs + fresh.length,
      reviews: 0,
      lapses: 0,
      status: "",
    });
  }
  return { fresh, skipped, invalid };
}
