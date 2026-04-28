---
name: sdk-sync
description: >
  Use after making any change to the TypeScript SDK that affects the public API surface
  (new method, changed parameter, new error code, removed feature, changed return type).
  Guides the AI through updating CONTRACT.md, bumping the version, creating the right
  commit, and generating the Python SDK tracking issue. Rigid — all steps are mandatory.
---

# SDK Sync: Keep TypeScript and Python SDKs in Lockstep

This skill is **rigid**. Complete every step in order. Do not skip any.

## When to invoke this skill

Invoke after making any change that affects the **public API surface**:
- New public method or class
- New parameter on an existing method
- Changed required/optional status of a parameter
- Changed return type or return shape
- New error code that a method can raise
- Removed or renamed method or parameter

Do NOT invoke for:
- Internal refactors with no API surface change
- Bug fixes that don't change method signatures
- Changes to `README.md`, tests, or build config only

---

## Checklist

Create a task for each item below and complete them in order.

### Step 1 — Audit the diff

Read the changes you just made in `src/`. For each modified file, answer:

1. Did any **public method signature** change? (new param, removed param, type change)
2. Did any **return type** change? (new field, removed field, type change)
3. Was any **new public class or method** added?
4. Was any **public method or class removed or renamed**?
5. Were any **new error codes** added to `ErrorCode` in `errors.ts`?

Write down your answers before proceeding. If the answer to ALL five is "no", this skill does not apply — stop here.

---

### Step 2 — Determine the version bump

Read the current `version` field from `package.json`.

Apply semver:
- **patch** (x.y.Z+1): bug fix, no API change — this skill should not have been invoked
- **minor** (x.Y+1.0): new method, new optional param, new error code, new return field
- **major** (X+1.0.0): removed method, removed required param, renamed method, breaking type change

New version = `current + bump`. Write it down.

---

### Step 3 — Update CONTRACT.md

Read `CONTRACT.md` at the repo root.

Update **only the sections that changed**:
- Change the `version: X.Y.Z` line at the top to the new version
- Add/remove/update the method entry in the relevant `## module` section
- Follow the exact CONTRACT.md format (see format reference below)
- If adding a method: add it under the correct module section
- If removing a method: delete its entry entirely
- If changing a param: update the `params:` block inline
- If adding an error code: add it to the `errors:` line of every method that can raise it AND to the `ErrorCode values:` list in `## errors`

**CONTRACT.md format reference:**
```
# SDK Contract

version: X.Y.Z

## module-name

### methodName(params) → ReturnType
params:
  paramName: type (required|optional, default: value)
ReturnType:
  field: type
  nestedObject: { field: type, field: type }
errors: error_code_1, error_code_2
```

Do NOT add implementation details, TypeScript-specific types, or internal notes to CONTRACT.md.

---

### Step 4 — Update package.json

Edit `package.json`: set `"version"` to the new version from Step 2.

Verify it matches the `version:` line in `CONTRACT.md`.

---

### Step 5 — Create the atomic commit

Stage exactly these files:
- All modified `src/` files from your change
- `CONTRACT.md`
- `package.json`

Commit message format:
```
<type>(sdk): <short description>

CONTRACT: bumped to vX.Y.Z — <one line summary of what changed in the API surface>
```

Where `<type>` is `feat`, `fix`, `refactor`, or `chore`. Examples:
```
feat(sdk): add conversation.stream() method

CONTRACT: bumped to v1.1.0 — added stream() to Conversation, added StreamEvent types
```
```
feat(sdk): add models[] fallback support to chat.completions.create()

CONTRACT: bumped to v1.2.0 — models param added to create(), mutually exclusive with model
```

---

### Step 6 — Generate the Python SDK tracking issue

Output the following text block exactly, filling in the placeholders. The developer will post this as an issue in the `llm4agents-sdk-python` GitHub repo.

---

**Issue title:**
```
[sync] CONTRACT updated to vX.Y.Z
```

**Issue body:**
```markdown
## SDK Contract updated to vX.Y.Z

The TypeScript SDK was updated in commit: <commit-hash>

### What changed in the API surface

<paste the exact diff of CONTRACT.md — only the changed lines, with +/- markers>

### What needs to be implemented in the Python SDK

<for each changed item, write one bullet:>
- [ ] <module>.<method>: <what changed — e.g. "add `models` param (optional, list of strings)">
- [ ] <if new error code>: add `error_code` to `ErrorCode` and `LLM4AgentsError` mapping
- [ ] Update Python SDK version to vX.Y.Z in pyproject.toml

### Semver impact

<patch | minor | major> bump — <one sentence why>

### Reference

- TS SDK commit: <link>
- CONTRACT.md: <link to CONTRACT.md at the new version>
```

---

**After outputting the issue text:**
Tell the developer: "Post this as an issue in `llm4agents-sdk-python`. The GitHub Action will also create it automatically on merge to main if configured. Close the issue when the Python PR is merged."

---

## Important rules

- The CONTRACT.md update and the functional change MUST be in the same commit
- Never bump a major version without confirming with the developer — breaking changes need sign-off
- Never commit without a `CONTRACT:` line in the commit message if CONTRACT.md was modified
- If you are unsure whether a change affects the public API surface, err on the side of running this skill
