import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = typeof err.status === "number" ? err.status : 500;
  const message = typeof err.message === "string" && err.message ? err.message : "Internal error";
  logger.error("request_error", { status, message });
  res.status(status).json({ error: message });
}
