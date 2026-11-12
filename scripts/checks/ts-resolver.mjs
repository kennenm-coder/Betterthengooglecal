// Lets a check import the app's own .ts files with plain `node`: Node 24 strips
// the types itself, but the app's imports leave off the ".ts" (Next resolves
// them). This adds it for relative imports that have no extension.
//
//     import { register } from "node:module";
//     register("./ts-resolver.mjs", import.meta.url);

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await next(specifier + ".ts", context);
    } catch {
      /* not a .ts file: fall through */
    }
  }
  return next(specifier, context);
}
