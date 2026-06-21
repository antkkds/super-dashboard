import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const SERVICES: Record<string, { name: string; port: number; health: string }> = {
  auth:      { name: "🔐 Auth Service",      port: 3001, health: "/health" },
  user:      { name: "👤 User Service",      port: 3002, health: "/health" },
  logistics: { name: "📦 Logistics Service", port: 3003, health: "/health" },
  market:    { name: "📰 Market Intel",       port: 3004, health: "/health" },
  trading:   { name: "💱 Trading Engine",     port: 3005, health: "/health" },
  ml:        { name: "🤖 ML Forecast",        port: 3006, health: "/health" },
};

// ── Health check ──
app.get("/api/health", async (_req, res) => {
  const results = await Promise.allSettled(
    Object.entries(SERVICES).map(async ([id, svc]) => {
      try {
        const r = await fetch(`http://localhost:${svc.port}${svc.health}`, { signal: AbortSignal.timeout(3000) });
        const data = await r.json();
        return { id, name: svc.name, status: "ok", data };
      } catch {
        return { id, name: svc.name, status: "error" };
      }
    })
  );
  const services = results.map((r) => (r.status === "fulfilled" ? r.value : { status: "error" }));
  const allOk = services.every((s) => s.status === "ok");
  res.json({ status: allOk ? "ok" : "degraded", timestamp: new Date().toISOString(), services });
});

// ── Proxy: /api/gateway/{service}/* ──
app.use("/api/gateway/:service", async (req, res) => {
  const svc = SERVICES[req.params.service as keyof typeof SERVICES];
  if (!svc) return res.status(404).json({ error: `Unknown service: ${req.params.service}` });

  // req.originalUrl = /api/gateway/market/api/prices
  // Remove the /api/gateway/{service} prefix
  const prefix = `/api/gateway/${req.params.service}`;
  const targetPath = req.originalUrl.replace(prefix, "") || "/";
  const query = new URLSearchParams(req.query as Record<string, string>).toString();
  const url = query ? `http://localhost:${svc.port}${targetPath}?${query}` : `http://localhost:${svc.port}${targetPath}`;

  try {
    const opts: RequestInit = {
      method: req.method,
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10000),
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      const body = Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body || {});
      opts.body = body;
    }
    const resp = await fetch(url, opts);
    const text = await resp.text();
    try {
      res.status(resp.status).json(JSON.parse(text));
    } catch {
      res.status(resp.status).send(text);
    }
  } catch (e: any) {
    res.status(502).json({ error: `Cannot reach ${svc.name}`, detail: e.message });
  }
});

// Also support /api/gateway/{service} (no trailing path)
app.all("/api/gateway/:service", async (req, res) => {
  const svc = SERVICES[req.params.service as keyof typeof SERVICES];
  if (!svc) return res.status(404).json({ error: `Unknown service: ${req.params.service}` });
  try {
    const resp = await fetch(`http://localhost:${svc.port}/`, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    res.json(data);
  } catch (e: any) {
    res.status(502).json({ error: `Cannot reach ${svc.name}`, detail: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Super Dashboard running at http://localhost:${PORT}`);
  console.log(`   Services: ${Object.keys(SERVICES).join(", ")}`);
});
