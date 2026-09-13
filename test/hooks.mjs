// Map host-only specifiers onto test stubs.
//
// NOTE: next('./stubs.mjs', ctx) resolves the new specifier RELATIVE TO THE IMPORTING MODULE,
// so it looked for .test-build/stubs.mjs and never took effect. Return an absolute file URL
// with shortCircuit instead — that is what actually redirects the import.
const STUB_URL = new URL('./stubs.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-tools') return { url: STUB_URL, shortCircuit: true };
  return next(specifier, context);
}
