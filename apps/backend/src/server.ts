import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { createApiRouter } from "./routes.js";

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));
app.use("/api", createApiRouter());

app.use((_req, res) => {
  res.status(404).json({ error: { message: "Route not found", code: "NOT_FOUND" } });
});

app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      sourceConfigured: config.sourceConfigured,
      electionPath: config.ECI_ELECTION_PATH || undefined,
      keralaStatePage: config.ECI_KERALA_STATE_PAGE || undefined
    },
    "Kerala election results API listening"
  );
});
