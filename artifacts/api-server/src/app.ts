import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
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

// Serve nova_bot.py bundled directly — zero CDN dependency
const _botScript = (() => {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(__dir, "../public/nova_bot.py"), "utf-8");
  } catch {
    return null;
  }
})();

app.get("/nova_bot.py", (_req, res) => {
  if (_botScript) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(_botScript);
  }
  res.redirect(302, "https://raw.githubusercontent.com/thenecioia-png/nova-ui/main/nova_bot.py");
});

app.use("/api", router);

export default app;
