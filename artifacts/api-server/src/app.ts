import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Serve nova_bot.py directly from GitHub raw (bypasses GitHub Pages CDN cache)
app.get("/nova_bot.py", async (_req, res) => {
  try {
    const raw = await fetch("https://raw.githubusercontent.com/thenecioia-png/nova-ui/main/nova_bot.py");
    if (!raw.ok) throw new Error(`GitHub raw: ${raw.status}`);
    const script = await raw.text();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(script);
  } catch {
    // Fallback to GitHub Pages if raw fetch fails
    res.redirect(302, "https://thenecioia-png.github.io/nova-ui/nova_bot.py");
  }
});

app.use("/api", router);

export default app;
