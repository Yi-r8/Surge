// Surge 内存面板脚本（type=generic，供 [Panel] 调用）
// 数据源：$httpAPI 调 /v1/metrics（Prometheus 纯文本）；
// 若拿不到，再调 /v1/mcp 的 dump_runtime_data（JSON）。
// 返回 {title, content, style} 给信息面板显示。
var LIMIT_MB = 50; // iOS Network Extension 内存上限约 50 MB

function fmtUptime(sec) {
  sec = Math.floor(sec);
  if (sec < 60) return sec + " 秒";
  if (sec < 3600) return Math.floor(sec / 60) + " 分钟";
  if (sec < 86400) return (sec / 3600).toFixed(1) + " 小时";
  return (sec / 86400).toFixed(1) + " 天";
}

function render(memBytes, uptimeSec, activeReq, dnsCache) {
  var mb = memBytes / 1048576;
  var pct = Math.round((mb / LIMIT_MB) * 100);
  var style = "good";
  if (mb >= 40) style = "error";
  else if (mb >= 30) style = "alert";
  else if (mb >= 20) style = "info";
  var lines = ["内存：" + mb.toFixed(1) + " MB（" + pct + "% / " + LIMIT_MB + " MB）"];
  var extra = [];
  if (uptimeSec != null) extra.push("运行 " + fmtUptime(uptimeSec));
  if (activeReq != null) extra.push("请求 " + activeReq);
  if (dnsCache != null) extra.push("DNS 缓存 " + dnsCache);
  if (extra.length) lines.push(extra.join(" | "));
  $done({ title: "Surge 内存", content: lines.join("\n"), style: style });
}

function fail(msg) {
  $done({ title: "Surge 内存", content: "读取失败：" + msg, style: "error" });
}

// 路径 1：/v1/metrics（Prometheus 纯文本）
function tryMetrics() {
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
          render(
            parseInt(m[1], 10),
            up ? parseFloat(up[1]) : null,
            ar ? parseInt(ar[1], 10) : null,
            dc ? parseInt(dc[1], 10) : null
          );
          return;
        }
      }
      tryMcp();
    });
  } catch (e) {
    tryMcp();
  }
}

// 路径 2：/v1/mcp dump_runtime_data（JSON）
function tryMcp() {
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
            render(
              mem,
              data.uptime != null ? data.uptime : null,
              data["active-requests"],
              data["dns-cache-entries"]
            );
          } else {
            fail("无内存数据");
          }
        } catch (e2) {
          fail("解析失败");
        }
      }
    );
  } catch (e) {
    fail("接口不可用");
  }
}

tryMetrics();
