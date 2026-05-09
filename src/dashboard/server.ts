import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 4000;

const DATA_DIR = path.join(process.cwd(), "data");
const POSITIONS_FILE = path.join(DATA_DIR, "positions.json");
const TRADES_FILE = path.join(DATA_DIR, "trades.jsonl");
const SNAPSHOT_FILE = path.join(DATA_DIR, "latestSnapshot.json");
const MARKS_FILE = path.join(DATA_DIR, "marks.jsonl");

function readJson(file: string, fallback: any) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function readJsonl(file: string) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

app.get("/api/state", (_req, res) => {
  const account = readJson(POSITIONS_FILE, {
    cashUsd: 10000,
    positions: [],
    updatedAt: null,
  });

  const latestSnapshotRaw = readJson(SNAPSHOT_FILE, {
    updatedAt: null,
    rows: [],
  });

  res.json({
    account,
    latestSnapshot: {
      updatedAt: latestSnapshotRaw.updatedAt || null,
      rows: latestSnapshotRaw.rows || [],
    },
    trades: readJsonl(TRADES_FILE),
    marks: readJsonl(MARKS_FILE),
  });
});

app.get("/", (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Krypt Agent Crypto Bridge Console</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: Consolas, Arial, sans-serif; margin: 14px; background:#050816; color:#e8ecff; }
    h1 { margin:0; font-size:28px; }
    .muted { color:#8c98c7; }
    .status { display:inline-block; padding:4px 10px; border-radius:999px; background:#17234d; color:#b9c7ff; font-size:12px; margin-top:6px; }
    .grid { display:grid; grid-template-columns: repeat(6, 1fr); gap:10px; margin-top:14px; }
    .card { background:#10172b; border:1px solid #2c3c70; border-radius:10px; padding:12px; }
    .metric { font-size:24px; font-weight:bold; margin-top:6px; }
    .section { margin-top:12px; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th, td { border-bottom:1px solid #28365f; padding:6px; text-align:left; white-space:nowrap; }
    th { color:#95aaff; position:sticky; top:0; background:#10172b; }
    .green { color:#74ff9d; }
    .red { color:#ff7d8a; }
    .yellow { color:#ffd166; }
    .blue { color:#79a8ff; }
    .split { display:grid; grid-template-columns: 2fr 1fr; gap:10px; }
    .scroll { max-height:320px; overflow:auto; }
    .pill { padding:3px 8px; border-radius:999px; background:#202b52; display:inline-block; }
  </style>
</head>
<body>
  <h1>Krypt Agent Crypto</h1>
  <div class="muted">Bridge-console mode · live refresh every 5 seconds</div>
  <div id="status" class="status">Connecting...</div>

  <div class="grid">
    <div class="card"><div class="muted">Cash</div><div id="cash" class="metric">$0.00</div></div>
    <div class="card"><div class="muted">Open</div><div id="openPositions" class="metric">0</div></div>
    <div class="card"><div class="muted">Deployed</div><div id="deployed" class="metric">$0.00</div></div>
    <div class="card"><div class="muted">Unrealized</div><div id="openPnl" class="metric">$0.00</div></div>
    <div class="card"><div class="muted">Equity</div><div id="equity" class="metric">$0.00</div></div>
    <div class="card"><div class="muted">Bot State</div><div id="botState" class="metric">-</div></div>
  </div>

  <div class="section card">
    <h2>P&L / Equity</h2>
    <canvas id="pnlChart" height="80"></canvas>
  </div>

  <div class="split section">
    <div class="card">
      <h2>Latest Scan</h2>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Symbol</th><th>State</th><th>Reason</th><th>Spot</th><th>Futures</th>
              <th>Ann.%</th><th>Basis%</th><th>Signal</th><th>Net</th><th>Funding</th><th>Basis</th>
            </tr>
          </thead>
          <tbody id="scanBody"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>Open Positions</h2>
      <div class="scroll">
        <table>
          <thead><tr><th>Symbol</th><th>Side</th><th>Notional</th><th>Entry Basis</th><th>Opened</th></tr></thead>
          <tbody id="positionsBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="split section">
    <div class="card">
      <h2>Mark Inspector</h2>
      <div class="scroll">
        <table>
          <thead><tr><th>Time</th><th>Symbol</th><th>Spot</th><th>Futures</th><th>Basis%</th><th>Net</th><th>Funding</th><th>Basis PnL</th><th>Hours</th></tr></thead>
          <tbody id="marksBody"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>Trades</h2>
      <div class="scroll">
        <table>
          <thead><tr><th>Time</th><th>Type</th><th>Symbol</th><th>P&L</th><th>Reason</th></tr></thead>
          <tbody id="tradesBody"></tbody>
        </table>
      </div>
    </div>
  </div>

<script>
let pnlChart;
let history = [];

function money(v) { return "$" + Number(v || 0).toFixed(2); }
function num(v, d=4) { return Number(v || 0).toFixed(d); }
function cls(v) { return Number(v || 0) >= 0 ? "green" : "red"; }

function stateColor(state) {
  if (state === "IN_POSITION") return "green";
  if (state === "OPENING_POSITION") return "yellow";
  if (state === "EXIT_TRIGGERED") return "red";
  if (state === "ERROR") return "red";
  return "blue";
}

function initChart() {
  pnlChart = new Chart(document.getElementById("pnlChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label:"Unrealized", data:[], tension:0.25, yAxisID:"pnl" },
        { label:"Cash", data:[], tension:0.25, yAxisID:"equity" },
        { label:"Equity", data:[], tension:0.25, yAxisID:"equity" }
      ]
    },
    options: {
      animation:false,
      responsive:true,
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{ labels:{ color:"#e8ecff" } } },
      scales:{
        x:{ ticks:{ color:"#8c98c7" }, grid:{ color:"#1e2948" } },
        pnl:{ type:"linear", position:"left", ticks:{ color:"#8c98c7" }, grid:{ color:"#1e2948" }, title:{ display:true, text:"Unrealized P&L", color:"#8c98c7" } },
        equity:{ type:"linear", position:"right", ticks:{ color:"#8c98c7" }, grid:{ drawOnChartArea:false }, title:{ display:true, text:"Cash / Equity", color:"#8c98c7" } }
      }
    }
  });
}

async function load() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();

    const account = data.account || {};
    const positions = account.positions || [];
    const snapshot = data.latestSnapshot?.rows || [];
    const trades = data.trades || [];
    const marks = data.marks || [];

    const deployed = positions.reduce((a,p)=>a+Number(p.notionalUsd || 0),0);
    const openPnl = snapshot.reduce((a,r)=>a+Number(r.mark?.netPnlUsd || 0),0);
    const cash = Number(account.cashUsd || 10000);
    const equity = cash + openPnl;

    const activeState = positions.length > 0
      ? "IN_POSITION"
      : snapshot.some(r => r.state === "ERROR")
      ? "ERROR"
      : "WAITING";

    document.getElementById("status").textContent = "Connected · " + new Date().toLocaleTimeString();
    document.getElementById("cash").textContent = money(cash);
    document.getElementById("openPositions").textContent = positions.length;
    document.getElementById("deployed").textContent = money(deployed);
    document.getElementById("openPnl").textContent = money(openPnl);
    document.getElementById("openPnl").className = "metric " + cls(openPnl);
    document.getElementById("equity").textContent = money(equity);
    document.getElementById("equity").className = "metric " + cls(equity - 10000);
    document.getElementById("botState").textContent = activeState;

    document.getElementById("scanBody").innerHTML = snapshot.map(r => \`
      <tr>
        <td>\${r.symbol}</td>
        <td class="\${stateColor(r.state)}"><span class="pill">\${r.state}</span></td>
        <td>\${r.stateReason || "-"}</td>
        <td>\${num(r.spotLast,4)}</td>
        <td>\${num(r.futuresLast,4)}</td>
        <td class="\${cls(r.annualizedFundingPct)}">\${num(r.annualizedFundingPct,2)}</td>
        <td>\${num(r.basisPct,4)}</td>
        <td>\${r.signal}</td>
        <td class="\${cls(r.mark?.netPnlUsd)}">\${r.mark ? money(r.mark.netPnlUsd) : "-"}</td>
        <td>\${r.mark ? money(r.mark.estimatedFundingPnlUsd) : "-"}</td>
        <td class="\${cls(r.mark?.basisPnlUsd)}">\${r.mark ? money(r.mark.basisPnlUsd) : "-"}</td>
      </tr>\`).join("") || '<tr><td colspan="11">No scan</td></tr>';

    document.getElementById("positionsBody").innerHTML = positions.map(p => \`
      <tr>
        <td>\${p.symbol}</td>
        <td>\${p.side}</td>
        <td>\${money(p.notionalUsd)}</td>
        <td>\${num(p.entryBasisPct,4)}</td>
        <td>\${p.openedAt}</td>
      </tr>\`).join("") || '<tr><td colspan="5">No open positions</td></tr>';

    document.getElementById("marksBody").innerHTML = marks.slice(-40).reverse().map(m => \`
      <tr>
        <td>\${new Date(m.time).toLocaleTimeString()}</td>
        <td>\${m.symbol}</td>
        <td>\${num(m.spotLast,4)}</td>
        <td>\${num(m.futuresLast,4)}</td>
        <td>\${num(m.basisPct,4)}</td>
        <td class="\${cls(m.netPnlUsd)}">\${money(m.netPnlUsd)}</td>
        <td>\${money(m.estimatedFundingPnlUsd)}</td>
        <td class="\${cls(m.basisPnlUsd)}">\${money(m.basisPnlUsd)}</td>
        <td>\${num(m.hoursOpen,2)}</td>
      </tr>\`).join("") || '<tr><td colspan="9">No marks</td></tr>';

    document.getElementById("tradesBody").innerHTML = trades.slice(-30).reverse().map(t => \`
      <tr>
        <td>\${new Date(t.time).toLocaleTimeString()}</td>
        <td>\${t.type}</td>
        <td>\${t.symbol}</td>
        <td class="\${cls(t.pnlUsd)}">\${t.pnlUsd !== undefined ? money(t.pnlUsd) : "-"}</td>
        <td>\${t.reason || "-"}</td>
      </tr>\`).join("") || '<tr><td colspan="5">No trades</td></tr>';

    history.push({ time:new Date().toLocaleTimeString(), unrealized:openPnl, cash, equity });
    if (history.length > 150) history.shift();

    pnlChart.data.labels = history.map(x=>x.time);
    pnlChart.data.datasets[0].data = history.map(x=>x.unrealized);
    pnlChart.data.datasets[1].data = history.map(x=>x.cash);
    pnlChart.data.datasets[2].data = history.map(x=>x.equity);
    pnlChart.update();
  } catch (err) {
    document.getElementById("status").textContent = "Error: " + err.message;
    console.error(err);
  }
}

initChart();
load();
setInterval(load, 5000);
</script>
</body>
</html>
  `);
});

app.listen(PORT, () => console.log("Dashboard running at http://localhost:" + PORT));