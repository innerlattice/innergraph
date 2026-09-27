// SchemaAccess: reads, validates and queries the user's Schema. The only component that
// interprets Schema documents; everyone else asks it about types and Roles.
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { type Attributes, type EdgeTypeDef, NODE_SHAPES, type Role, type Schema } from "../core/types.js";
import type { Db } from "./database.js";

const attributeDef = z.object({
  type: z.enum(["string", "number", "boolean", "enum"]).default("string"),
  values: z.array(z.string()).optional(),
  description: z.string().optional(),
});
const attributes = z.record(z.string(), attributeDef).default({});
const endpoint = z.union([z.literal("*"), z.array(z.string())]).default("*");

const schemaDoc = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  description: z.string().optional(),
  nodeTypes: z.record(
    z.string(),
    z.object({
      description: z.string().optional(),
      label: z.enum(["name", "statement", "title"]).optional(),
      labelHint: z.string().optional(),
      display: z.object({ shape: z.enum(NODE_SHAPES).optional(), color: z.string().optional() }).optional(),
      attributes,
    }),
  ),
  edgeTypes: z.record(
    z.string(),
    z.object({
      description: z.string().optional(),
      from: endpoint,
      to: endpoint,
      role: z.enum(["derivational", "causal", "identity"]).optional(),
      attributes,
    }),
  ),
});

export class SchemaError extends Error {}

export function parseSchema(text: string): Schema {
  const result = schemaDoc.safeParse(YAML.parse(text));
  if (!result.success) throw new SchemaError(z.prettifyError(result.error));
  const schema = result.data as Schema;
  assertEndpointsExist(schema);
  return schema;
}

function assertEndpointsExist(schema: Schema): void {
  for (const [name, def] of Object.entries(schema.edgeTypes)) {
    const unknown = [def.from, def.to].flatMap((e) => (e === "*" ? [] : e)).filter((t) => !schema.nodeTypes[t]);
    if (unknown.length > 0) throw new SchemaError(`Edge type ${name} references unknown node types: ${unknown.join(", ")}`);
  }
}

export function loadSchemaFile(file: string): Schema {
  return parseSchema(readFileSync(file, "utf8"));
}

export function rolesOf(schema: Schema | null): Record<string, Role | undefined> {
  const roles: Record<string, Role | undefined> = {};
  for (const [name, def] of Object.entries(schema?.edgeTypes ?? {})) roles[name] = def.role;
  return roles;
}

function allows(endpointDef: EdgeTypeDef["from"], nodeType: string): boolean {
  return endpointDef === "*" || endpointDef.includes(nodeType);
}

export function checkNode(schema: Schema, type: string, attrs: Attributes): string[] {
  const def = schema.nodeTypes[type];
  if (!def) return [`unknown node type "${type}"`];
  return Object.keys(attrs)
    .filter((key) => !def.attributes[key])
    .map((key) => `unknown attribute "${key}" on ${type}`);
}

export function checkEdge(schema: Schema, type: string, fromType: string, toType: string): string[] {
  const def = schema.edgeTypes[type];
  if (!def) return [`unknown edge type "${type}"`];
  const errors: string[] = [];
  if (!allows(def.from, fromType)) errors.push(`${type} cannot start at ${fromType}`);
  if (!allows(def.to, toType)) errors.push(`${type} cannot end at ${toType}`);
  return errors;
}

/** Node types that take part in any derivational Edge type. */
export function derivationalNodeTypes(schema: Schema): Set<string> {
  const types = new Set<string>();
  for (const def of Object.values(schema.edgeTypes)) {
    if (def.role !== "derivational") continue;
    for (const end of [def.from, def.to]) {
      for (const t of end === "*" ? Object.keys(schema.nodeTypes) : end) types.add(t);
    }
  }
  return types;
}

export class SchemaAccess {
  constructor(private readonly db: Db) {}

  current(): Schema | null {
    const row = this.db
      .prepare("SELECT body FROM events WHERE type = 'SchemaChanged' ORDER BY hlc DESC LIMIT 1")
      .get() as { body: Buffer } | undefined;
    return row ? (JSON.parse(row.body.toString("utf8")).schema as Schema) : null;
  }

  require(): Schema {
    const schema = this.current();
    if (!schema) throw new SchemaError("Vault has no Schema yet");
    return schema;
  }
}
