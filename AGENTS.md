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

## Karpathy-inspired engineering discipline

These rules are mandatory for implementation, review, and refactoring work in
this repository. They are adapted from
`multica-ai/andrej-karpathy-skills` and complement the project-specific rules
above.

### Think before coding

- Inspect the relevant code, tests, schemas, and documentation before editing.
- State material assumptions and surface meaningful tradeoffs.
- Do not silently choose between materially different interpretations.
- Ask only when ambiguity cannot be resolved safely from the repository.
- Prefer the simpler approach when it fully satisfies the requirement.

### Keep the implementation minimal

- Write the minimum code required to meet explicit success criteria.
- Do not add speculative features, configuration, extension points, or error
  handling for impossible states.
- Do not introduce an abstraction for a single use.
- Keep functions, modules, and components focused on one clear responsibility.
- Prefer readable control flow and explicit data structures over clever code.

### Reuse deliberately

- Search for an existing helper, component, schema, service, or runtime path
  before creating another implementation.
- Keep shared behavior in one authoritative implementation.
- Extract a reusable abstraction only when it removes meaningful duplication,
  reduces complexity, or follows an established repository pattern.
- Do not force unrelated behavior through one abstraction merely to avoid a
  few repeated lines.
- Prefer composition and existing project primitives over new frameworks or
  dependencies.

### Reuse UI and libraries

- Treat `components.json` and `src/components/ui` as the authoritative UI
  primitive configuration and library for this project.
- Use an existing `@/components/ui` primitive before creating a custom button,
  input, dialog, menu, card, table, tooltip, form control, or similar element.
- When a primitive is missing, prefer adding the official shadcn component
  before considering another UI library.
- Import Radix primitives directly only when shadcn does not expose the needed
  capability. Keep the exception narrow and wrap reusable behavior in
  `src/components/ui`.
- Use another UI library only for a capability shadcn does not reasonably
  provide, such as a graph canvas or specialized chart. Document the gap and
  keep vendor-specific code behind a small reusable project component.
- Search existing dependencies and repository code before implementing common
  behavior or installing another package.
- Do not add a package that duplicates an installed library or a reasonable
  platform API.
- Add a dependency only when the capability gap is real, the library is
  maintained, and using it is simpler and safer than a local implementation.
- Use `lucide-react` for interface icons and `cn` from `@/lib/utils` for class
  composition.
- Reuse existing variants and component APIs. Add a shared variant only when
  several consumers need the same behavior.
- Compose domain components from UI primitives instead of copying or forking
  primitive source for each page.
- Do not change a shared primitive to solve a single-screen styling issue when
  composition or a local `className` is sufficient.
- Preserve the accessibility, keyboard, focus, disabled, loading, and
  responsive behavior supplied by the shared primitive.
- Forms with user-entered values must report validation errors inside the
  relevant form and preserve entered values after a failed submission. Reuse
  `ActionStateForm` and `ActionFormError` for server-action forms instead of
  redirecting validation failures through page-level query parameters.

### Make surgical changes

- Every changed line must trace directly to the requested behavior or its
  verification.
- Do not refactor, rename, reformat, or clean up unrelated code.
- Match the surrounding style and ownership boundaries.
- Remove only imports, variables, functions, or files made obsolete by the
  current change.
- Mention unrelated problems when relevant, but do not fix them without scope.

### Protect contracts and boundaries

- Keep tenant and project scope explicit in reads, writes, jobs, caches, and
  external operations.
- Validate untrusted input at system boundaries with typed schemas.
- Keep business rules deterministic and separate from UI, model wording, and
  provider-specific adapters.
- Preserve backward compatibility unless the task explicitly changes the
  contract.
- Keep side effects authorized, idempotent where needed, and auditable.
- Never expose secrets, credentials, private reasoning, or unnecessary PII.

### Execute against verifiable goals

- Define concrete success criteria before substantial implementation.
- For bug fixes, reproduce the failure with the smallest useful test when
  practical.
- Add or update focused tests in proportion to risk and blast radius.
- Run the smallest relevant checks first, then broader checks when shared
  contracts or runtime behavior changed.
- Inspect the final diff for unrelated edits, duplication, and unnecessary
  complexity.
- Do not declare completion until the requested behavior and verification pass.
