import { getDb } from "@/lib/db";
import { countQueueByState, listQueue } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/queue → 常驻 worker 的开发队列状态(各 state 计数 + 最近项)
export async function GET(): Promise<Response> {
  const db = getDb();
  const counts = countQueueByState(db);
  const items = listQueue(db, undefined, 100);
  return NextResponse.json({ counts, items });
}
