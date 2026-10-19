const fs = require("fs");
const j = JSON.parse(fs.readFileSync(process.env.TEMP + "/feishu-sheet-raw.json", "utf8"));
const annotated = j.data.annotated_csv;

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

const parts = annotated.split(/(?=\[row=\d+\])/).filter(Boolean);
const steps = [];
for (const p of parts) {
  const m = p.match(/^\[row=(\d+)\]\s*/);
  if (!m) continue;
  const n = +m[1];
  if (n === 1) continue;
  const body = p.slice(m[0].length);
  const cols = parseCsvLine(body);
  if (!cols[0] || !String(cols[0]).trim()) continue;
  steps.push({
    row: n,
    step: String(cols[0] || "").trim(),
    module: String(cols[1] || "")
      .replace(/\n/g, " ")
      .trim(),
    purpose: String(cols[2] || "").trim(),
    deepPurpose: String(cols[3] || "").trim(),
    metrics: String(cols[4] || "").trim(),
    input: String(cols[5] || "").trim(),
    dataSource: String(cols[6] || "").trim(),
    process: String(cols[7] || "").trim(),
    prompt: String(cols[8] || "").trim(),
    output: String(cols[9] || "").trim(),
    docs: String(cols[10] || "").trim(),
    owner: String(cols[11] || "").trim(),
  });
}

fs.writeFileSync(process.env.TEMP + "/wukan-sop.json", JSON.stringify(steps, null, 2), "utf8");
console.log("steps", steps.length);
steps.forEach((s) =>
  console.log(s.step, s.module.slice(0, 36), "|", s.output.replace(/\n/g, " ").slice(0, 48)),
);
