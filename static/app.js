'use strict';

const KIND_LABELS = { R: '电阻', V: '电压源', I: '电流源' };
const PARAM_UNITS = { R: 'Ω', V: 'V', I: 'A' };
const OBS_PLACEHOLDERS = {
  voltage: '非接地节点编号，如 2',
  current: '元件名称，如 R1',
};

const EXAMPLE_NETLIST = [
  '# 示例：含电压源与电流源的直流电路',
  'V1 1 0 12',
  'R1 1 2 6',
  'R2 2 0 6',
  'R3 2 3 12',
  'I1 0 3 0.5',
].join('\n');

const netlistEl = document.getElementById('netlist');
const solveBtn = document.getElementById('solve-btn');
const exampleBtn = document.getElementById('example-btn');
const clearBtn = document.getElementById('clear-btn');
const errorEl = document.getElementById('error');
const resultsEl = document.getElementById('results');
const voltageTbody = document.querySelector('#voltage-table tbody');
const currentTbody = document.querySelector('#current-table tbody');
const obsTypeEl = document.getElementById('obs-type');
const obsTargetEl = document.getElementById('obs-target');
const sensBtn = document.getElementById('sens-btn');
const sensOutputEl = document.getElementById('sens-output');
const sensSummaryEl = document.getElementById('sens-summary');
const sensTbody = document.querySelector('#sens-table tbody');
const thNode1El = document.getElementById('th-node1');
const thNode2El = document.getElementById('th-node2');
const thLoadEl = document.getElementById('th-load');
const thBtn = document.getElementById('th-btn');
const thOutputEl = document.getElementById('th-output');
const thSummaryEl = document.getElementById('th-summary');
const thTbody = document.querySelector('#th-table tbody');

// 数值格式化：去掉无意义的尾零，极大/极小值用科学计数法
function fmt(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return String(x);
  if (Math.abs(x) < 1e-12) return '0';
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-4) return x.toExponential(4);
  return String(Number(x.toPrecision(6)));
}

// 在 fmt 基础上显式标注正负号
function fmtSigned(x) {
  const s = fmt(x);
  if (s === '0' || s.startsWith('-')) return s;
  return `+${s}`;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultsEl.hidden = true;
  sensOutputEl.hidden = true;
  thOutputEl.hidden = true;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function addRow(tbody, cells) {
  const tr = document.createElement('tr');
  for (const { text, isNum, sign } of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    if (isNum) td.className = 'num';
    if (sign > 0) td.classList.add('pos');
    else if (sign < 0) td.classList.add('neg');
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

function renderResults(data) {
  voltageTbody.textContent = '';
  currentTbody.textContent = '';

  addRow(voltageTbody, [
    { text: '0（地）' },
    { text: '0', isNum: true },
  ]);
  for (const item of data.node_voltages) {
    addRow(voltageTbody, [
      { text: String(item.node) },
      { text: fmt(item.voltage), isNum: true },
    ]);
  }

  for (const item of data.currents) {
    addRow(currentTbody, [
      { text: item.name },
      { text: KIND_LABELS[item.kind] || item.kind },
      { text: `${item.from} → ${item.to}` },
      { text: fmt(item.current), isNum: true },
    ]);
  }

  resultsEl.hidden = false;
}

async function solve() {
  clearError();
  solveBtn.disabled = true;
  try {
    const resp = await fetch('/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ netlist: netlistEl.value }),
    });
    let data;
    try {
      data = await resp.json();
    } catch {
      showError(`服务器返回异常（HTTP ${resp.status}）`);
      return;
    }
    // 出错时仅提示原因，输入内容保留在文本框中
    if (!data.ok) {
      showError(data.error || '求解失败');
      return;
    }
    renderResults(data);
  } catch {
    showError('无法连接服务器，请检查服务是否正常运行');
  } finally {
    solveBtn.disabled = false;
  }
}

solveBtn.addEventListener('click', solve);
exampleBtn.addEventListener('click', () => {
  netlistEl.value = EXAMPLE_NETLIST;
  clearError();
});
clearBtn.addEventListener('click', () => {
  netlistEl.value = '';
  clearError();
  resultsEl.hidden = true;
  sensOutputEl.hidden = true;
  thOutputEl.hidden = true;
  netlistEl.focus();
});
netlistEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') solve();
});

// ---------- 灵敏度分析 ----------

function renderSensitivity(data) {
  sensTbody.textContent = '';
  const obs = data.observation;
  const label = obs.type === 'voltage'
    ? `节点 ${obs.node} 电压`
    : `元件 ${obs.name} 电流（${obs.from} → ${obs.to}）`;
  sensSummaryEl.textContent =
    `观测量：${label}，当前值 ${fmt(obs.value)} ${obs.unit}。` +
    '下表为观测量对每个元件数值的局部导数，以及该数值改为原值 1.01 倍时' +
    '观测量的一阶变化量（按变化量绝对值降序）。';

  for (const row of data.sensitivities) {
    addRow(sensTbody, [
      { text: row.name },
      { text: KIND_LABELS[row.kind] || row.kind },
      { text: `${fmt(row.value)} ${PARAM_UNITS[row.kind] || ''}`, isNum: true },
      {
        text: `${fmtSigned(row.derivative)} ${row.derivative_unit}`,
        isNum: true,
        sign: row.derivative,
      },
      {
        text: `${fmtSigned(row.delta)} ${row.delta_unit}`,
        isNum: true,
        sign: row.delta,
      },
    ]);
  }
  sensOutputEl.hidden = false;
}

async function sensitivity() {
  clearError();
  const target = obsTargetEl.value.trim();
  if (!target) {
    showError(obsTypeEl.value === 'voltage'
      ? '请填写要观测的非接地节点编号'
      : '请填写要观测电流的元件名称');
    return;
  }
  const observation = obsTypeEl.value === 'voltage'
    ? { type: 'voltage', node: target }
    : { type: 'current', element: target };

  sensBtn.disabled = true;
  try {
    const resp = await fetch('/sensitivity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ netlist: netlistEl.value, observation }),
    });
    let data;
    try {
      data = await resp.json();
    } catch {
      showError(`服务器返回异常（HTTP ${resp.status}）`);
      return;
    }
    // 出错时仅提示原因，网表与观测对象输入均保留
    if (!data.ok) {
      showError(data.error || '灵敏度分析失败');
      return;
    }
    renderSensitivity(data);
  } catch {
    showError('无法连接服务器，请检查服务是否正常运行');
  } finally {
    sensBtn.disabled = false;
  }
}

sensBtn.addEventListener('click', sensitivity);
obsTypeEl.addEventListener('change', () => {
  obsTargetEl.placeholder = OBS_PLACEHOLDERS[obsTypeEl.value] || '';
  obsTargetEl.focus();
});
obsTargetEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sensitivity();
});

// ---------- 两端口戴维南等效分析 ----------

function renderThevenin(data) {
  thTbody.textContent = '';
  const th = data.thevenin;
  thSummaryEl.textContent =
    `端口：节点 ${th.node_p}（+）→ 节点 ${th.node_n}（−），` +
    `负载电阻 RL = ${fmt(th.load)} Ω。` +
    '负载电流正方向为第一节点 → 第二节点（负值表示实际方向相反）；' +
    '交换两个端点时电压、电流变号，功率不变。';

  const rows = [
    { label: '开路电压 Voc', value: th.voc, unit: th.voc_unit, sign: true,
      note: `V(${th.node_p}) − V(${th.node_n})，端口开路时` },
    { label: '等效电阻 Rth', value: th.rth, unit: th.rth_unit, sign: false,
      note: '独立源置零后注入 1 A 试验电流求得；被理想电压源短接时为 0' },
    { label: '端口电压 VL', value: th.vl, unit: th.vl_unit, sign: true,
      note: '负载两端电压，第一节点侧为 +，VL = IL × RL' },
    { label: '负载电流 IL', value: th.il, unit: th.il_unit, sign: true,
      note: '正方向：第一节点 → 第二节点，IL = Voc / (Rth + RL)' },
    { label: '负载功率 PL', value: th.pl, unit: th.pl_unit, sign: false,
      note: 'PL = VL × IL，恒为非负' },
  ];
  for (const row of rows) {
    addRow(thTbody, [
      { text: row.label },
      {
        text: `${row.sign ? fmtSigned(row.value) : fmt(row.value)} ${row.unit}`,
        isNum: true,
        sign: row.sign ? row.value : 0,
      },
      { text: row.note },
    ]);
  }
  thOutputEl.hidden = false;
}

async function thevenin() {
  clearError();
  const node1 = thNode1El.value.trim();
  const node2 = thNode2El.value.trim();
  const load = thLoadEl.value.trim();
  if (!node1 || !node2) {
    showError('请填写两个不同的端口节点编号（允许节点 0）');
    return;
  }
  if (!load) {
    showError('请填写正的有限负载电阻（单位 Ω）');
    return;
  }

  thBtn.disabled = true;
  try {
    const resp = await fetch('/thevenin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ netlist: netlistEl.value, node1, node2, load }),
    });
    let data;
    try {
      data = await resp.json();
    } catch {
      showError(`服务器返回异常（HTTP ${resp.status}）`);
      return;
    }
    // 出错时仅提示原因，网表与端口输入均保留
    if (!data.ok) {
      showError(data.error || '戴维南等效分析失败');
      return;
    }
    renderThevenin(data);
  } catch {
    showError('无法连接服务器，请检查服务是否正常运行');
  } finally {
    thBtn.disabled = false;
  }
}

thBtn.addEventListener('click', thevenin);
for (const el of [thNode1El, thNode2El, thLoadEl]) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') thevenin();
  });
}
