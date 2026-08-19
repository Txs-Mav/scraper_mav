#!/usr/bin/env node
// MCP Go-Data — serveur lecture seule sur la base Supabase prod via PostgREST.
// Lit NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans dashboard_web/.env.local.
// Aucune écriture possible : seules des requêtes GET/HEAD sont émises.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE =
  process.env.GODATA_ENV_FILE ?? resolve(HERE, "../../dashboard_web/.env.local");

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv(ENV_FILE);
const BASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE_URL || !SERVICE_KEY) {
  console.error(`Variables Supabase manquantes dans ${ENV_FILE}`);
  process.exit(1);
}
const REST = `${BASE_URL.replace(/\/$/, "")}/rest/v1`;

const MAX_CHARS = 60_000;

async function rest(path, { method = "GET", headers = {}, params } = {}) {
  const url = new URL(`${REST}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.append(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...headers,
    },
  });
  return res;
}

function textResult(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length > MAX_CHARS) {
    text =
      text.slice(0, MAX_CHARS) +
      `\n… [tronqué à ${MAX_CHARS} caractères — réduis limit ou select]`;
  }
  return { content: [{ type: "text", text }] };
}

function errorResult(res, body) {
  return {
    isError: true,
    content: [{ type: "text", text: `HTTP ${res.status} ${res.statusText}\n${body}` }],
  };
}

let specCache = null;
async function openApiSpec() {
  if (specCache) return specCache;
  const res = await rest("/");
  if (!res.ok) throw new Error(`Impossible de lire le schéma (HTTP ${res.status})`);
  specCache = await res.json();
  return specCache;
}

const server = new McpServer({ name: "godata", version: "1.0.0" });

server.registerTool(
  "list_tables",
  {
    description:
      "Liste les tables et vues exposées par la base Supabase Go-Data (prod), avec le nombre de colonnes.",
    inputSchema: {},
  },
  async () => {
    const spec = await openApiSpec();
    const tables = Object.entries(spec.definitions ?? {})
      .map(([name, def]) => ({
        table: name,
        columns: Object.keys(def.properties ?? {}).length,
      }))
      .sort((a, b) => a.table.localeCompare(b.table));
    return textResult(tables);
  }
);

server.registerTool(
  "describe_table",
  {
    description:
      "Décrit les colonnes d'une table Go-Data : nom, type, clé primaire, valeur par défaut.",
    inputSchema: { table: z.string().describe("Nom exact de la table") },
  },
  async ({ table }) => {
    const spec = await openApiSpec();
    const def = spec.definitions?.[table];
    if (!def) {
      return {
        isError: true,
        content: [{ type: "text", text: `Table inconnue : ${table}. Utilise list_tables.` }],
      };
    }
    const required = new Set(def.required ?? []);
    const cols = Object.entries(def.properties ?? {}).map(([name, p]) => ({
      column: name,
      type: p.format ?? p.type,
      required: required.has(name),
      pk: /Primary Key/i.test(p.description ?? ""),
      default: p.default,
    }));
    return textResult(cols);
  }
);

server.registerTool(
  "query",
  {
    description:
      "Interroge une table Go-Data en lecture seule (PostgREST). " +
      "filters est un objet colonne → expression PostgREST, ex. {\"brand\": \"eq.CFMOTO\", \"price\": \"gte.10000\", \"model\": \"ilike.*ATV*\"}. " +
      "Opérateurs : eq, neq, gt, gte, lt, lte, like, ilike, in.(a,b), is.null, not.is.null…",
    inputSchema: {
      table: z.string().describe("Nom de la table"),
      select: z
        .string()
        .optional()
        .describe("Colonnes à retourner, ex. \"id,brand,model,price\" (défaut : *)"),
      filters: z
        .record(z.string(), z.string())
        .optional()
        .describe("Filtres PostgREST colonne → expression"),
      order: z
        .string()
        .optional()
        .describe("Tri PostgREST, ex. \"price.desc\" ou \"scraped_at.desc.nullslast\""),
      limit: z.number().int().min(1).max(1000).optional().describe("Défaut 100, max 1000"),
      offset: z.number().int().min(0).optional(),
    },
  },
  async ({ table, select, filters, order, limit, offset }) => {
    const params = {
      select: select ?? "*",
      order,
      limit: limit ?? 100,
      offset,
      ...(filters ?? {}),
    };
    const res = await rest(`/${encodeURIComponent(table)}`, { params });
    const body = await res.text();
    if (!res.ok) return errorResult(res, body);
    return textResult(JSON.parse(body));
  }
);

server.registerTool(
  "count_rows",
  {
    description:
      "Compte les lignes d'une table Go-Data (count exact), avec les mêmes filtres que query.",
    inputSchema: {
      table: z.string().describe("Nom de la table"),
      filters: z.record(z.string(), z.string()).optional(),
    },
  },
  async ({ table, filters }) => {
    const res = await rest(`/${encodeURIComponent(table)}`, {
      method: "HEAD",
      headers: { Prefer: "count=exact" },
      params: { select: "*", limit: 1, ...(filters ?? {}) },
    });
    if (!res.ok) return errorResult(res, await res.text());
    const range = res.headers.get("content-range") ?? "";
    const count = range.split("/")[1] ?? "inconnu";
    return textResult({ table, count: Number(count) });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
