import { register } from "node:module";

// Node's ESM resolver needs a file extension, but the sources use the
// extensionless specifiers TypeScript and the bundler expect. This hook fills
// them in so the tests can import the real modules rather than a copy.
register("./ts-resolve-hooks.mjs", import.meta.url);
