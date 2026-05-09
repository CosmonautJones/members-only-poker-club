// Ambient declaration for pg-query-emscripten 5.1.0.
//
// The package ships JS-only (no .d.ts) and uses an emscripten WASM build of
// libpg_query. Usage pattern from its README:
//
//   import Module from 'pg-query-emscripten';
//   const pgQuery = await new Module();
//   const result = pgQuery.parse('select 1');
//   // → { parse_tree: <AST>, error: null, stderr_buffer: '' }
//
// We type the surface as `any` deliberately — the AST shape mirrors libpg_query's
// PostgreSQL parse-tree JSON, which is large, version-specific, and not a stable
// public contract. Tests that walk the tree do their own structural checks with
// helper functions and accept the runtime risk in exchange for not having to
// type 200+ pg_query node variants.
//
// If a future cycle wants tighter types, swap to `libpg-query` (newer fork with
// types) per spec t0's documented fallback option. For Slice 1, this shim is
// sufficient: the Migration Shape test (AC9) only walks specific subtrees.
declare module 'pg-query-emscripten' {
  interface PgQueryParseResult {
    parse_tree: unknown;
    error: { message: string; lineno?: number; cursorpos?: number } | null;
    stderr_buffer?: string;
  }

  interface PgQueryModule {
    parse(sql: string): PgQueryParseResult;
    parsePlpgsql(sql: string): { plpgsql_funcs: unknown[]; error: unknown };
    fingerprint(sql: string): { fingerprint: string; fingerprint_str: string | null };
    scan(sql: string): { tokens: unknown[]; error: unknown };
  }

  type PgQueryModuleFactory = {
    new (overrides?: Record<string, unknown>): Promise<PgQueryModule>;
  };

  const Module: PgQueryModuleFactory;
  export default Module;
}
