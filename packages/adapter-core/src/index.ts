import type { ProjectAdapter } from "./types";

export type {
  BuildOptions,
  CommandOutcome,
  TestStrictOutcome,
  TestFullOutcome,
  FormatOutcome,
  ProjectAdapter,
} from "./types";

export type AdapterType = "java-ddd" | "node-express";

export type AdapterFactory = (projectPath: string) => ProjectAdapter;

const registry = new Map<AdapterType, AdapterFactory>();

export function registerAdapter(
  type: AdapterType,
  factory: AdapterFactory,
): void {
  registry.set(type, factory);
}

export function getAdapter(
  type: AdapterType,
  projectPath: string,
): ProjectAdapter {
  const factory = registry.get(type);
  if (!factory) {
    throw new Error(`No adapter registered for type: ${type}`);
  }
  return factory(projectPath);
}
