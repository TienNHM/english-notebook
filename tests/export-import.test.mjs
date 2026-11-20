import test from "node:test";
import assert from "node:assert/strict";
import {
  BOM, MAX_IMPORT, toCsv, toAnkiTsv, parseCsv, parseLines, prepareImport, guessType, dupKey,
} from "../export-import.js";

const card = (o = {}) => ({
  id: "a", type: "word", text: "hello", meaning: "xin chào", example: "", note: "", original: "",
  tags: [], box: 0, created: 1000, ...o,
});

test("BOM constant is the UTF-8 byte order mark character", () => {
  assert.equal(BOM, "﻿");
});

test("toCsv: header, columns and RFC 4180 quoting", () => {
  const csv = toCsv([
    card({ text: 'say "hi", please', meaning: "dòng 1\ndòng 2", tags: ["work", "daily"], box: 3 }),
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "type,text,meaning,example,note,original,tags,box,created");
  assert.ok(csv.includes('"say ""hi"", please"'));
  assert.ok(csv.includes('"dòng 1\ndòng 2"'));
  assert.ok(csv.includes("work;daily"));
  assert.equal(toCsv([]), "type,text,meaning,example,note,original,tags,box,created\r\n");
});

test("toCsv -> parseCsv round trip keeps text, meaning and tags", () => {
  const items = [
    card({ text: "Xin chào, bạn", meaning: 'Nghĩa "lạ"\nhai dòng', tags: ["a b", "x"], type: "phrase" }),
    card({ text: "plain", meaning: "đơn giản", example: "It is plain, really.", tags: [] }),
    card({ text: "ngày\r\nmới", meaning: "m", tags: ["học"] }),
  ];
  const back = parseCsv(BOM + toCsv(items));
  assert.equal(back.length, 3);
  items.forEach((it, n) => {
    assert.equal(back[n].text, it.text);
    assert.equal(back[n].meaning, it.meaning.trim());
    assert.deepEqual(back[n].tags, it.tags);
    assert.equal(back[n].type, it.type);
  });
  assert.equal(back[1].example, "It is plain, really.");
});

test("toAnkiTsv: front, back with <br>, escaped tabs/newlines, tags", () => {
  const tsv = toAnkiTsv([
    card({ text: "a\tb", meaning: "nghĩa\nhai", example: "Ex.", note: "Ghi chú", tags: ["my tag", "work"] }),
    card({ text: "solo", meaning: "chỉ nghĩa", tags: [] }),
  ]);
  assert.ok(tsv.endsWith("\n"));
  const lines = tsv.slice(0, -1).split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].split("\t"), ["a b", "nghĩa<br>hai<br>Ex.<br>Ghi chú", "my_tag work"]);
  assert.deepEqual(lines[1].split("\t"), ["solo", "chỉ nghĩa", ""]);
  assert.equal(toAnkiTsv([]), "");
});

test("parseCsv: header by name in any order, CRLF, BOM", () => {
  const rows = parseCsv(BOM + "meaning,text,tags\r\nxin chào,hello,a;#B\r\nchào,hi,\r\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, "hello");
  assert.equal(rows[0].meaning, "xin chào");
  assert.deepEqual(rows[0].tags, ["a", "b"]);
  assert.equal(rows[0].line, 2);
  assert.equal(rows[1].line, 3);
});

test("parseCsv: no header uses positional columns", () => {
  const rows = parseCsv('hello,xin chào,"Hello, world."\nbye,tạm biệt');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].example, "Hello, world.");
  assert.equal(rows[1].text, "bye");
});

test("parseCsv: line numbers count embedded newlines", () => {
  const rows = parseCsv('text,meaning\n"a\nb",x\nc,y');
  assert.equal(rows[0].line, 2);
  assert.equal(rows[1].line, 4);
});

test("parseCsv: empty input, blank rows and malformed rows", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n\n"), []);
  const rows = parseCsv('text,meaning\n\n"open,quote');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].error);
  assert.equal(parseCsv("text,meaning\n").length, 0);
});

test("parseLines: the three formats, comments and blank lines", () => {
  const rows = parseLines([
    "# comment",
    "",
    "hello | xin chào | Hello there.",
    "break the ice = phá băng",
    "tab\tmeaning\tExample.",
    "  ",
  ].join("\r\n"));
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].text, rows[0].meaning, rows[0].example], ["hello", "xin chào", "Hello there."]);
  assert.deepEqual([rows[1].text, rows[1].meaning], ["break the ice", "phá băng"]);
  assert.equal(rows[2].example, "Example.");
  assert.equal(rows[0].line, 3);
  assert.equal(rows[1].line, 4);
});

test("parseLines: '=' splits on the first one only", () => {
  const [r] = parseLines("x = y = z");
  assert.equal(r.text, "x");
  assert.equal(r.meaning, "y = z");
});

test("type guessing and defaults.type", () => {
  assert.equal(guessType("hello"), "word");
  assert.equal(guessType("break the ice"), "phrase");
  assert.equal(guessType("one two three four five"), "sentence");
  assert.equal(guessType("Really?"), "sentence");
  assert.equal(guessType("two words."), "sentence");
  const [a] = parseLines("one two three four five = x");
  assert.equal(a.type, "sentence");
  const [b] = parseLines("one two three four five = x", { type: "phrase" });
  assert.equal(b.type, "phrase");
  assert.equal(parseLines("hello = a", { type: "bogus" })[0].type, "word");
});

test("dupKey: case, spaces, trailing punctuation and diacritics", () => {
  assert.equal(dupKey("  Hello   World!! "), "hello world");
  assert.equal(dupKey("Đường Phố."), dupKey("duong pho"));
});

test("prepareImport: builds full cards", () => {
  let n = 0;
  const parsed = parseLines("hello = xin chào\nbreak the ice | phá băng | Let's break the ice.");
  const { fresh, skipped, invalid } = prepareImport([], parsed, { nowMs: 5000, makeId: () => "id" + n++ });
  assert.equal(skipped.length, 0);
  assert.equal(invalid.length, 0);
  assert.equal(fresh.length, 2);
  assert.deepEqual(fresh[0], {
    id: "id0", type: "word", text: "hello", meaning: "xin chào", example: "", note: "", original: "",
    sourceId: "", source: "manual", tags: ["imported"], box: 0, due: 5000, created: 5000, reviews: 0,
    lapses: 0, status: "",
  });
  assert.equal(fresh[1].created, 5001);
  assert.equal(fresh[1].type, "phrase");
  assert.equal(fresh[1].example, "Let's break the ice.");
});

test("prepareImport: custom tag is normalised and merged with row tags", () => {
  const parsed = parseCsv("text,meaning,tags\nhello,xin chào,Work");
  const { fresh } = prepareImport([], parsed, { tag: "#Sách Vở", nowMs: 1 });
  assert.deepEqual(fresh[0].tags, ["work", "sách vở"]);
});

test("prepareImport: skips duplicates of existing cards and inside the batch", () => {
  const existing = [card({ text: "Hello!" }), card({ text: "Đường phố" })];
  const parsed = parseLines("hello = a\nduong pho = b\nnew card = c\nNew  Card. = d");
  const { fresh, skipped } = prepareImport(existing, parsed, { nowMs: 1 });
  assert.deepEqual(fresh.map(f => f.text), ["new card"]);
  assert.equal(skipped.length, 3);
  assert.equal(skipped[0].text, "hello");
  assert.ok(skipped[0].reason);
});

test("prepareImport: invalid rows carry line and reason", () => {
  const parsed = [
    ...parseLines("= no text\nonly text\nok = fine"),
    ...parseCsv('text,meaning\n"broken'),
  ];
  const { fresh, invalid } = prepareImport([], parsed, { nowMs: 1 });
  assert.equal(fresh.length, 1);
  assert.deepEqual(invalid.map(i => i.line), [1, 2, 2]);
  assert.ok(invalid.every(i => i.reason));
});

test("prepareImport: empty input", () => {
  assert.deepEqual(prepareImport([], [], { nowMs: 1 }), { fresh: [], skipped: [], invalid: [] });
  assert.deepEqual(prepareImport([], parseLines(""), { nowMs: 1 }), { fresh: [], skipped: [], invalid: [] });
});

test("prepareImport: caps one import at 2000 cards", () => {
  const text = Array.from({ length: MAX_IMPORT + 3 }, (_, i) => `word${i} = nghĩa ${i}`).join("\n");
  const { fresh, invalid } = prepareImport([], parseLines(text), { nowMs: 1 });
  assert.equal(fresh.length, MAX_IMPORT);
  assert.equal(invalid.length, 3);
  assert.match(invalid[0].reason, /giới hạn/);
  assert.equal(invalid[0].line, MAX_IMPORT + 1);
});

test("Vietnamese text survives the whole pipeline", () => {
  const items = [card({ text: "Cảm ơn nhiều", meaning: "Thank you very much", type: "phrase", tags: ["giao tiếp"] })];
  const parsed = parseCsv(toCsv(items));
  const { fresh } = prepareImport([], parsed, { nowMs: 9 });
  assert.equal(fresh[0].text, "Cảm ơn nhiều");
  assert.deepEqual(fresh[0].tags, ["giao tiếp", "imported"]);
});

test("toCsv neutralizes spreadsheet formulas and parseCsv undoes it", () => {
  const evil = card({ text: '=HYPERLINK("http://evil","x")', meaning: "@SUM(1)", example: "+1", note: "-2", original: "\tcmd", tags: ["=t"] });
  const csv = toCsv([evil, card({ text: "ok", meaning: "-5 độ", box: 3 })]);
  const lines = csv.split("\r\n");
  assert.ok(lines[1].startsWith(`word,"'=HYPERLINK(""http://evil"",""x"")",'@SUM(1),'+1,'-2,'\tcmd`));
  assert.ok(lines[2].includes(",ok,'-5 độ,"));
  assert.ok(lines[2].endsWith(",3,1000")); // numeric columns are not touched
  const back = parseCsv(csv);
  assert.equal(back[0].text, evil.text);
  assert.equal(back[0].meaning, "@SUM(1)");
  assert.equal(back[0].example, "+1");
  assert.equal(back[0].note, "-2");
  assert.equal(back[1].meaning, "-5 độ");
});

test("parseCsv keeps a leading apostrophe that is not in front of a formula character", () => {
  assert.equal(parseCsv("text,meaning\n'tis,đêm").at(0).text, "'tis");
});

test("toAnkiTsv escapes HTML so fields cannot inject markup", () => {
  const tsv = toAnkiTsv([card({ text: "a < b & c", meaning: "<img src=x onerror=alert(1)>\nhai" })]);
  const [front, back] = tsv.trimEnd().split("\t");
  assert.equal(front, "a &lt; b &amp; c");
  assert.equal(back, "&lt;img src=x onerror=alert(1)&gt;<br>hai");
});
