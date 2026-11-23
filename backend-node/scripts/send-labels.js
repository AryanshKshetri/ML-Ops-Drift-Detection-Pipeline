import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Sends the true churn labels from a simulator run to the API, so the
// Performance page can compare predictions with real outcomes.
//
// Run from backend-node, after node scripts/simulate-traffic.js:
//   node scripts/send-labels.js                      newest file in scripts/runs
//   node scripts/send-labels.js --file scripts/runs/<name>.csv
//   node scripts/send-labels.js --url https://your-api.onrender.com
//
// Options:
//   --file   run log to read (default: the newest .csv in scripts/runs)
//   --url    API base URL, without /predict (default http://localhost:4000)
//   --batch  labels per request, 1 to 1000 (default 500)

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.join(here, "runs");
const baseUrl = String(opt("url", "http://localhost:4000")).replace(/\/+$/, "").replace(/\/predict$/, "");
const batchSize = Number(opt("batch", 500));
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  console.error("--batch must be a whole number from 1 to 1000");
  process.exit(1);
}

function newestRunFile() {
  if (!fs.existsSync(runsDir)) return null;
  const files = fs
    .readdirSync(runsDir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => ({ f, t: fs.statSync(path.join(runsDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? path.join(runsDir, files[0].f) : null;
}

// Minimal CSV line splitter that understands double quotes.
function splitCsv(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toChurn(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (["1", "yes", "true", "y", "churn", "churned"].includes(s)) return 1;
  if (["0", "no", "false", "n"].includes(s)) return 0;
  return null;
}

const file = opt("file", null) ? path.resolve(opt("file", null)) : newestRunFile();
if (!file || !fs.existsSync(file)) {
  console.error("No run log found. Run node scripts/simulate-traffic.js first, or pass --file.");
  process.exit(1);
}

const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
if (lines.length < 2) {
  console.error(`${path.basename(file)} has no data rows.`);
  process.exit(1);
}

const header = splitCsv(lines[0]);
const idCol = header.findIndex((h) => /request.?id/i.test(h));
let churnCol = header.findIndex((h) => /^(actual.?churn|true.?churn|churn|label|true.?label|actual)$/i.test(h));
if (churnCol === -1) churnCol = header.findIndex((h) => /churn|label/i.test(h) && !/drift|predict/i.test(h));
if (idCol === -1 || churnCol === -1) {
  console.error(`Could not find the request id and churn columns in ${path.basename(file)}.`);
  console.error(`Columns found: ${header.join(", ")}`);
  process.exit(1);
}

const labels = [];
let skipped = 0;
for (const line of lines.slice(1)) {
  const cells = splitCsv(line);
  const id = (cells[idCol] ?? "").toLowerCase();
  const churn = toChurn(cells[churnCol]);
  if (!id || churn === null) { skipped++; continue; }
  labels.push({ request_id: id, actual_churn: churn });
}
if (labels.length === 0) {
  console.error("No usable rows. Were the requests accepted by the API (HTTP 200)?");
  process.exit(1);
}

console.log(`Run log:  ${path.basename(file)}`);
console.log(`Columns:  request id = "${header[idCol]}", churn = "${header[churnCol]}"`);
console.log(`Sending ${labels.length} labels to ${baseUrl}/api/labels (${skipped} rows skipped)`);

let received = 0;
let stored = 0;
let unmatched = 0;
for (let i = 0; i < labels.length; i += batchSize) {
  const batch = labels.slice(i, i + batchSize);
  let res;
  try {
    res = await fetch(`${baseUrl}/api/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels: batch }),
    });
  } catch (err) {
    console.error(`Cannot reach ${baseUrl}: ${err.message}`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`API answered ${res.status}: ${data.error ?? "unknown error"}`);
    process.exit(1);
  }
  received += data.received ?? 0;
  stored += data.stored ?? 0;
  unmatched += data.unmatched_count ?? 0;
}

console.log(`Done. Received ${received}, stored ${stored}, unmatched ${unmatched}.`);
if (unmatched > 0) {
  console.log("Unmatched labels belong to predictions that are not in this database.");
  console.log("Send the labels to the same API that received the traffic.");
}
