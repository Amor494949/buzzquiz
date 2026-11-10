// Parse a quiz .tsv file.
//
// Two layouts are accepted, detected from the header row:
//   Full:   roundNo  questionNo  questionText  answerText  imageUrl
//   Simple: question answer [image]
// A file with no recognised header is read as Simple (column 1 = question, 2 = answer, 3 = image).

import type { Question, Quiz } from "./types";

export interface ParseResult {
  quiz: Quiz;
  warnings: string[];
  skipped: number;
}

/** Split TSV text into rows of cells. Handles "quoted" cells that contain tabs or newlines. */
export function splitTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let atCellStart = true;
  text = text.replace(/^﻿/, "");
  while (i < text.length) {
    const ch = text[i];
    if (atCellStart && ch === '"') {
      // Quoted cell: read until the closing quote ("" is an escaped quote).
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        cell += text[i++];
      }
      atCellStart = false;
      continue;
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      atCellStart = true;
      i++;
    } else if (ch === "\n" || ch === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atCellStart = true;
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += ch;
      atCellStart = false;
      i++;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const NOTE_RE = /\[\s*(?:accept|prompt|do not accept|don't accept|reject)\b[^\]]*\]/gi;

/** Pull marking notes like [Accept: SALT] out of an answer. */
export function splitNotes(answer: string): { answer: string; notes: string[] } {
  const notes = (answer.match(NOTE_RE) ?? []).map((n) => n.slice(1, -1).trim());
  const clean = answer
    .replace(NOTE_RE, "")
    .replace(/[ \t]*;[ \t]*(?=<br|$)/gi, "")
    .replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>")
    .trim()
    .replace(/^(<br\s*\/?>\s*)+|(<br\s*\/?>\s*)+$/gi, "")
    .trim();
  return { answer: clean, notes };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function parseQuiz(text: string, fileName = "Quiz"): ParseResult {
  const rows = splitTSV(text);
  const warnings: string[] = [];
  let skipped = 0;
  const questions: Question[] = [];
  const spares: Question[] = [];
  const title = fileName.replace(/\.(tsv|txt)$/i, "").replace(/[_-]+/g, " ").trim() || "Quiz";

  if (!rows.length) return { quiz: { title, questions, spares }, warnings: ["The file is empty."], skipped };

  const header = rows[0].map(norm);
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h));
  let col = { round: -1, qno: -1, q: -1, a: -1, img: -1 };
  let body = rows;

  const qCol = find("questiontext", "question", "q");
  const aCol = find("answertext", "answer", "a");
  if (qCol >= 0 && aCol >= 0) {
    col = { round: find("roundno", "round"), qno: find("questionno", "questionnumber"), q: qCol, a: aCol, img: find("imageurl", "image", "img") };
    body = rows.slice(1);
  } else {
    col = { round: -1, qno: -1, q: 0, a: 1, img: 2 };
    warnings.push("No header row found, so column 1 is read as the question and column 2 as the answer.");
  }

  body.forEach((r, i) => {
    const line = i + (body === rows ? 1 : 2);
    const get = (c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");
    const round = get(col.round);
    const roundLower = round.toLowerCase();
    if (roundLower.startsWith("instruction")) {
      skipped++;
      return;
    }
    const qText = get(col.q);
    const aText = get(col.a);
    if (!qText) {
      skipped++;
      if (aText) warnings.push(`Line ${line}: answer but no question, skipped.`);
      return;
    }
    const isSpare = roundLower.startsWith("spare");
    const list = isSpare ? spares : questions;
    const { answer, notes } = splitNotes(aText);
    if (!answer) warnings.push(`Line ${line}: no answer.`);
    const image = get(col.img);
    if (image && !/^https?:\/\//i.test(image)) warnings.push(`Line ${line}: image is not a web link, ignored.`);
    const n = list.length + 1;
    list.push({
      id: `${isSpare ? "s" : "q"}${n}`,
      n,
      label: [round, get(col.qno)].filter(Boolean).join(" · "),
      text: qText,
      answer,
      notes,
      image: /^https?:\/\//i.test(image) ? image : undefined,
    });
  });

  if (!questions.length) warnings.push("No questions found.");
  return { quiz: { title, questions, spares }, warnings, skipped };
}
