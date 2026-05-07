import { pgTable, serial, integer, text, timestamp, doublePrecision, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workersTable } from "./workers";

export const detectionsTable = pgTable("detections", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id")
    .notNull()
    .references(() => workersTable.id),
  uploadId: text("upload_id").notNull(),
  status: text("status", { enum: ["safe", "unsafe"] }).notNull(),
  violations: jsonb("violations").$type<string[]>().notNull().default([]),
  confidence: doublePrecision("confidence").notNull(),
  bbox: jsonb("bbox").$type<number[]>().notNull().default([]),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
});

export const insertDetectionSchema = createInsertSchema(detectionsTable).omit({ id: true, timestamp: true });
export type InsertDetection = z.infer<typeof insertDetectionSchema>;
export type Detection = typeof detectionsTable.$inferSelect;
