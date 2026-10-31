import { encodeParams, decodeParams, hashParams } from "../ai/modelFile";
import { V4Network, type V4NetworkSpec } from "./network";

/** Modelldatei für v4-Netze (gleiche Primitive wie v2/v3, eigener Typ-Tag). */
export type V4ModelFile = {
  format: "lhitl-aurora-v4/1";
  id: string;
  parent: string | null;
  algorithm: string;
  spec: V4NetworkSpec;
  objective: string;
  training: Record<string, unknown>;
  episodes: number;
  paramsHash: string;
  params: string;
  metrics?: Record<string, unknown>;
  notes?: string;
};

export function createV4ModelFile(
  net: V4Network,
  meta: Omit<V4ModelFile, "format" | "spec" | "params" | "paramsHash">,
): V4ModelFile {
  return {
    format: "lhitl-aurora-v4/1",
    ...meta,
    spec: net.spec,
    paramsHash: hashParams(net.params),
    params: encodeParams(net.params),
  };
}

export function loadV4Network(file: V4ModelFile): V4Network {
  if (file.format !== "lhitl-aurora-v4/1") throw new Error(`Unerwartetes Format: ${file.format}`);
  const params = decodeParams(file.params);
  if (hashParams(params) !== file.paramsHash) throw new Error(`Prüfsumme von ${file.id} stimmt nicht`);
  return new V4Network(file.spec, params);
}
