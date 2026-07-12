<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your
training data. Before writing Next.js code, first check for local docs under
`node_modules/next/dist/docs/`. If that folder is absent, inspect the installed
Next.js package/types and use the official Next.js documentation for the
installed version instead.
Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Instruction Priority

The Next.js rule above is mandatory. Before making changes involving Next.js APIs, routing, layouts, server components, client components, server actions, metadata, caching, middleware, or config, inspect local documentation in `node_modules/next/dist/docs/` when present. If it is not present, inspect the installed package/types and use the official Next.js documentation for the installed version.

Do not skip this step.

# Codex Project Instructions

Follow these instructions for every task in this repository.

## Core behavior

- Read the relevant files before editing.
- Make the smallest correct change.
- Do not refactor unrelated code.
- Do not rename files, functions, APIs, or variables unless necessary.
- Prefer simple, readable code over clever code.
- Preserve the existing code style.
- Explain assumptions before making risky changes.
- When fixing bugs, identify the likely cause before editing.
- When possible, add or update a test that proves the fix.
- After editing, run the smallest relevant verification command.
- Summarize what changed and how it was verified.

## Project safety

- Do not add dependencies unless explicitly needed.
- Do not change environment files, secrets, deployment config, or CI unless asked.
- Do not make broad formatting-only changes.
- Do not remove comments or documentation unless they are incorrect.
- Ask before making destructive changes.

## Next.js-specific instruction

This project uses a newer Next.js version.

Before changing routing, layouts, server components, client components, server actions, metadata, caching, middleware, or config, read the relevant local documentation from `node_modules/next/dist/docs/` when present. If it is not present, inspect the installed package/types and use the official Next.js documentation for the installed version.

Do not rely only on older Next.js knowledge.

## Karpathy-style coding guideline

Think carefully. Prefer clarity. Keep changes surgical. Verify behavior.
