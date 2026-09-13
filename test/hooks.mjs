// Map host-only specifiers onto test stubs (same pattern as dsh-session-handoff).
export async function resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-tools') return next('./stubs.mjs', context);
  return next(specifier, context);
}
