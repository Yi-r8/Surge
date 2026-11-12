// Surge 内存详情面板脚本（type=generic，供 [Panel] 调用）
// 独立模块，和“Surge 内存面板”（经典单面板）分开，互不影响。
// 内容：同一条进度条（▬ 当前、┅ 到峰值、─ 未用）+ 占用构成的条数明细
//   （DNS 缓存、虚拟 IP、活动请求、临时规则、封禁）。
// 注意：Surge 只报内存总占用，不报各部分的 MB 明细，所以详情面板
// 只能显示各部分的条数/个数，各占多少 MB 是拿不到的，不要硬编。
// 峰值用 $persistentStore 持久化（和经典面板共用同一个 key），检测到
// 引擎重启（uptime 变小）自动重置。
// 数据源：优先调 /v1/mcp 的 dump_runtime_data（一次拿到全部计数字段）；
// 拿不到时回退 /v1/metrics（Prometheus 纯文本；虚拟 IP / 临时规则两项
// 没有，显示 —）。$httpAPI 无需鉴权。
var LIMIT_MB = 50; // iOS Network Extension 内存上限约 50 MB
var PEAK_KEY = "surge-memory-peak-v1";
var BAR_WIDTH = 16;

function fmtUptime(sec) {
  sec = Math.floor(sec);
  if (sec < 60) return sec + " 秒";
  if (sec < 3600) return Math.floor(sec / 60) + " 分钟";
  if (sec < 86400) return (sec / 3600).toFixed(1) + " 小时";
  return (sec / 86400).toFixed(1) + " 天";
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

function trackPeak(mb, uptimeSec) {
  // 峰值跟踪：读出旧峰值，引擎重启则重置；和经典面板共用同一个 key。
  var peak = mb;
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
      }
    }
  } catch (e) {}
  try {
    $persistentStore.write(
      JSON.stringify({ peak: peak, uptime: uptimeSec }),
      PEAK_KEY
    );
  } catch (e) {}
  return peak;
}

function renderDetail(d) {
  var mb = d.mem / 1048576;
  var peak = trackPeak(mb, d.uptime);
  var pct = ((mb / LIMIT_MB) * 100).toFixed(1);
  var peakPct = ((peak / LIMIT_MB) * 100).toFixed(1);
  var num = function (v, unit) {
    return v == null ? "—" : v + " " + unit;
  };
  var lines = [
    "▬▬▬ 当前 " + mb.toFixed(1) + " MB (" + pct + "%)",
    "┅┅┅ 峰值 " + peak.toFixed(1) + " MB (" + peakPct + "%)",
    dualBar(mb / LIMIT_MB, peak / LIMIT_MB, mb, peak),
    "DNS 缓存 " + num(d.dns, "条") + " | 虚拟 IP " + num(d.vip, "条"),
    "活动请求 " + num(d.activeReq, "个") + " | 临时规则 " + num(d.tempRules, "条"),
    "封禁 " + num(d.bans, "个") + " | 运行 " + (d.uptime != null ? fmtUptime(d.uptime) : "—"),
  ];
  $done({
    title: "Surge 内存详情",
    content: lines.join("\n"),
    icon: "list.bullet",
    "icon-color": colorFor(mb),
  });
}

function failDetail(msg) {
  $done({ title: "Surge 内存详情", content: "读取失败：" + msg, style: "error" });
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
