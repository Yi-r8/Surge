// Surge 运行监控面板脚本（type=generic，供 [Panel] 调用）
//
// 详情版：运行时长、启动时间、当前内存 + 同一条 16 格进度条
// （▬ 当前、┅ 到峰值、─ 未用）+ 观测峰值/最低 + 占用构成的条数明细
// （活动连接、DNS 缓存、虚拟 IP、临时规则、封禁）。
//
// 注意：Surge 只报内存总占用，不报各部分的 MB 明细，所以详情面板
// 只能显示各部分的条数/个数，各占多少 MB 是拿不到的，不要硬编。
//
// 峰值/最低用 $persistentStore 持久化（本模块独立的 key，只统计本模块
// 采样；检测到引擎重启（uptime 变小）自动重置），和经典面板的 key 分开。
//
// 数据源：优先调 /v1/mcp 的 dump_runtime_data（一次拿到全部计数字段）；
// 拿不到时回退 /v1/metrics（Prometheus 纯文本；虚拟 IP / 临时规则两项
// 没有，显示 —）。$httpAPI 无需鉴权。

var LIMIT_MB = 50; // iOS Network Extension 内存上限约 50 MB
var PEAK_KEY = "surge-memory-detail-v2";
var BAR_WIDTH = 16;

function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

// 运行时长：11 小时 28 分 / 1 天 2 小时 / 28 分 / 45 秒
function fmtUptime(sec) {
  sec = Math.floor(sec);
  if (sec < 60) return sec + " 秒";
  if (sec < 3600) return Math.floor(sec / 60) + " 分";
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  if (sec < 86400) return h + " 小时 " + m + " 分";
  var d = Math.floor(sec / 86400);
  return d + " 天 " + Math.floor((sec % 86400) / 3600) + " 小时";
}

// 启动时间：现在减 uptime，格式 MM-DD HH:mm
function fmtStartTime(uptimeSec) {
  var t = new Date(Date.now() - uptimeSec * 1000);
  return (
    pad(t.getMonth() + 1) +
    "-" +
    pad(t.getDate()) +
    " " +
    pad(t.getHours()) +
    ":" +
    pad(t.getMinutes())
  );
}

// 更新时间：HH:mm:ss
function fmtNow() {
  var t = new Date();
  return pad(t.getHours()) + ":" + pad(t.getMinutes()) + ":" + pad(t.getSeconds());
}

// 双段进度条：直接用原始占用比例算格数，不要先把百分比四舍五入
// 成整数再算——两次取整会把峰值和当前的差距吃掉（比如 23.3 和
// 23.7 都变成 47%，虚线段就画不出来了）。
// 0→当前画 ▬（粗横条），当前→峰值画 ┅（细虚线，半透明感），
// 其余画 ─（细实线轨道）；峰值高于当前时至少留一格虚线段，
// 保证差距可见。
function dualBar(curFrac, peakFrac, curMB, peakMB) {
  var cur = Math.round(curFrac * BAR_WIDTH);
  var peak = Math.round(peakFrac * BAR_WIDTH);
  if (cur > BAR_WIDTH) cur = BAR_WIDTH;
  if (peak > BAR_WIDTH) peak = BAR_WIDTH;
  if (cur < 0) cur = 0;
  if (peak < 0) peak = 0;
  if (peak < cur) peak = cur;
  if (peakMB > curMB && peak === cur && peak < BAR_WIDTH) peak = cur + 1;
  var s = "";
  for (var i = 0; i < BAR_WIDTH; i++) {
    if (i < cur) s += "▬";
    else if (i < peak) s += "┅";
    else s += "─";
  }
  return s;
}

function colorFor(mb) {
  if (mb >= 40) return "#FF3B30"; // 红：接近上限
  if (mb >= 30) return "#FF9500"; // 橙：偏高
  return "#34C759"; // 绿：正常
}

function trackPeakMin(mb, uptimeSec) {
  // 峰值/最低跟踪：读出旧值，引擎重启则重置；本模块独立的 key。
  var peak = mb;
  var min = mb;
  try {
    var raw = $persistentStore.read(PEAK_KEY);
    if (raw) {
      var obj = JSON.parse(raw);
      var storedUptime = obj.uptime;
      if (
        uptimeSec == null ||
        storedUptime == null ||
        uptimeSec >= storedUptime
      ) {
        peak = Math.max(mb, obj.peak || 0);
        min = obj.min != null ? Math.min(mb, obj.min) : mb;
      }
    }
  } catch (e) {}
  try {
    $persistentStore.write(
      JSON.stringify({ peak: peak, min: min, uptime: uptimeSec }),
      PEAK_KEY
    );
  } catch (e) {}
  return { peak: peak, min: min };
}

function renderDetail(d) {
  var mb = d.mem / 1048576;
  var pm = trackPeakMin(mb, d.uptime);

  var num = function (v) {
    return v == null ? "—" : String(v);
  };

  var uptimeText = d.uptime != null ? fmtUptime(d.uptime) : "—";
  var startText = d.uptime != null ? fmtStartTime(d.uptime) : "—";

  var lines = [
    "已运行时长 " + uptimeText,
    "启动于 " + startText,
    "",
    "当前内存占比 " + mb.toFixed(1) + " MiB",
    dualBar(mb / LIMIT_MB, pm.peak / LIMIT_MB, mb, pm.peak),
    "观测峰值 " + pm.peak.toFixed(1) + " MiB · 最低 " + pm.min.toFixed(1) + " MiB",
    "活动连接 " + num(d.activeReq) + " · DNS 缓存 " + num(d.dns),
    "虚拟 IP " + num(d.vip) + " · 临时规则 " + num(d.tempRules) + " · 封禁 " + num(d.bans),
    "更新 " + fmtNow() + " · 自动刷新 60 秒",
    "",
    "峰值仅统计本模块采样；重启后重新记录。",
  ];

  $done({
    title: "Surge 运行监控",
    content: lines.join("\n"),
    icon: "list.bullet",
    "icon-color": colorFor(mb),
  });
}

function failDetail(msg) {
  $done({ title: "Surge 运行监控", content: "读取失败：" + msg, style: "error" });
}

// 路径 2（回退）：/v1/metrics（Prometheus 纯文本）
function detailViaMetrics() {
  try {
    $httpAPI("GET", "/v1/metrics", null, function (result) {
      var text = null;
      if (typeof result === "string") text = result;
      else if (result && typeof result.body === "string") text = result.body;
      else if (result && typeof result.data === "string") text = result.data;
      if (text) {
        var m = /surge_memory_bytes\s+(\d+)/.exec(text);
        if (m) {
          var up = /surge_uptime_seconds\s+([\d.]+)/.exec(text);
          var ar = /surge_active_requests\s+(\d+)/.exec(text);
          var dc = /surge_dns_cache_entries\s+(\d+)/.exec(text);
          var bn = /surge_active_bans\s+(\d+)/.exec(text);
          renderDetail({
            mem: parseInt(m[1], 10),
            uptime: up ? parseFloat(up[1]) : null,
            activeReq: ar ? parseInt(ar[1], 10) : null,
            dns: dc ? parseInt(dc[1], 10) : null,
            vip: null,
            tempRules: null,
            bans: bn ? parseInt(bn[1], 10) : null,
          });
          return;
        }
      }
      failDetail("无内存数据");
    });
  } catch (e) {
    failDetail("接口不可用");
  }
}

// 路径 1（优先）：/v1/mcp dump_runtime_data（JSON，一次拿到全部计数字段）
function detailViaMcp() {
  try {
    $httpAPI(
      "POST",
      "/v1/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "dump_runtime_data", arguments: { type: "performance" } },
      },
      function (result) {
        try {
          var c =
            result && result.result && result.result.content && result.result.content[0];
          var data = c && c.text ? JSON.parse(c.text) : null;
          var mem = data && (data["memory-bytes"] || data.memoryBytes);
          if (mem) {
            renderDetail({
              mem: mem,
              uptime: data.uptime != null ? data.uptime : null,
              activeReq: data["active-requests"],
              dns: data["dns-cache-entries"],
              vip: data["virtual-ip-entries"],
              tempRules: data["temporary-rules"],
              bans: data["active-bans"],
            });
          } else {
            detailViaMetrics();
          }
        } catch (e2) {
          detailViaMetrics();
        }
      }
    );
  } catch (e) {
    detailViaMetrics();
  }
}

detailViaMcp();
