import type { Config } from "drizzle-kit";

// drizzle-kit generate / push 时使用;运行时建表走 src/db.ts 内联 DDL,
// 因此不强依赖此文件,但保留以便后续 schema 演进。
export default {
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
} satisfies Config;
