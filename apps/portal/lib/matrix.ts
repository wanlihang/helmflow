import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface Legacy {
  flowCode: string;
  activities: string[];
}

export interface Target {
  handler: string;
  actions: string[];
  context: string;
}

export type FeatureStatus =
  | "not-started"
  | "clarifying"
  | "pending-goal"
  | "implementing"
  | "done"
  | "blocked"
  | "abandoned";

export type FeaturePriority = "P0" | "P1" | "P2";

export interface Feature {
  id: string;
  name: string;
  legacy: Legacy;
  target: Target;
  priority: FeaturePriority;
  status: FeatureStatus;
}

export interface Domain {
  id: string;
  name: string;
  features: Feature[];
}

export interface FeatureMatrix {
  project: string;
  description?: string;
  schemaVersion: number;
  domains: Domain[];
}

const MATRIX_PATH = join(process.cwd(), "data", "feature-matrix.yaml");

let cached: FeatureMatrix | null = null;

export function loadMatrix(): FeatureMatrix {
  if (cached) return cached;
  const raw = readFileSync(MATRIX_PATH, "utf-8");
  const parsed = parse(raw) as FeatureMatrix;
  cached = parsed;
  return parsed;
}

export function getFeature(id: string): Feature | undefined {
  const matrix = loadMatrix();
  for (const domain of matrix.domains) {
    const found = domain.features.find((f) => f.id === id);
    if (found) return found;
  }
  return undefined;
}

export function getDomainOfFeature(id: string): Domain | undefined {
  const matrix = loadMatrix();
  return matrix.domains.find((d) => d.features.some((f) => f.id === id));
}

export function getTotalFeatureCount(): number {
  return loadMatrix().domains.reduce((sum, d) => sum + d.features.length, 0);
}
