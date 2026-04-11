import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { createApiRouter } from "./routes.js";

const app = express();
const allowedOrigins = new Set(
  [
    "https://kerala-election.onrender.com",
    "https://results.onekeralam.in",
    "http://localhost:5173",
    "http://localhost:5174",
    ...config.FRONTEND_ORIGIN.split(",")
  ]
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
);
const allowAnyOrigin = allowedOrigins.has("*");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowAnyOrigin || allowedOrigins.has(origin.replace(/\/+$/, ""))) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: false,
    optionsSuccessStatus: 204
  })
);
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
