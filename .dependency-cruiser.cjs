// Onion rings: imports may only point inward. See docs/architecture.md.
const CORE = "^packages/core/";
const APPLICATION = "^packages/(engine|scheduler)/";
const ADAPTERS = "^packages/(sources/[^/]+|storage|evidence|removal|rpc)/";
const ENTRY = "^(apps/[^/]+|features/[^/]+|packages/(ui|graph-view|ui-tokens))/";
const APP_INTERNALS = "^packages/(engine|scheduler|storage|sources|evidence|removal)/";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "package-must-be-in-a-ring",
      comment: "Every package must sit in a ring; an unlisted one would escape every ring rule.",
      severity: "error",
      from: { path: "^(packages|apps|features)/", pathNot: [CORE, APPLICATION, ADAPTERS, ENTRY] },
      to: {},
    },
    {
      name: "core-is-pure",
      comment: "Ring 1 (core) imports nothing outside itself.",
      severity: "error",
      from: { path: CORE },
      to: { pathNot: CORE, dependencyTypesNot: ["core"] },
    },
    {
      name: "core-no-builtins",
      comment: "Ring 1 (core) does no I/O, so no node/bun builtins.",
      severity: "error",
      from: { path: CORE },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "application-inward-only",
      comment: "Ring 2 (engine, scheduler) imports only core and ring 2.",
      severity: "error",
      from: { path: APPLICATION },
      to: { pathNot: "^packages/(core|engine|scheduler)/", dependencyTypesNot: ["core"] },
    },
    {
      name: "application-no-builtins",
      comment: "Ring 2 reaches I/O only through its own interfaces (Source, Store, Http, Clock).",
      severity: "error",
      from: { path: APPLICATION },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "adapters-not-to-entry",
      comment: "Ring 3 (adapters) never imports ring 4 (entry points).",
      severity: "error",
      from: { path: ADAPTERS },
      to: { path: ENTRY },
    },
    {
      name: "entry-only-through-rpc",
      comment: "Ring 4 reaches the app only through packages/rpc; UI never imports storage or sources.",
      severity: "error",
      from: { path: ENTRY },
      to: { path: APP_INTERNALS },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    // TypeScript 7 has no JS compiler API, which the default "tsc" parser needs.
    parser: "swc",
    doNotFollow: { path: "node_modules" },
    // .hutch holds the generated Electrobun devkit; dist/build/artifacts are build output.
    exclude: { path: ["^tests/fixtures/", "/[.]hutch/", "^apps/[^/]+/(dist|build|artifacts)/"] },
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "default"],
      mainFields: ["module", "main"],
    },
  },
};

// Not part of the config schema; tests/boundaries.test.ts reuses these to catch dependency-free unringed modules.
Object.defineProperty(module.exports, "rings", {
  value: { CORE, APPLICATION, ADAPTERS, ENTRY },
  enumerable: false,
});
