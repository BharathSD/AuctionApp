---
name: CSV And Schema Compatibility Guardrails
description: "Use when editing player import/export, auction payload schema, setup data models, or CSV parsing/serialization to preserve backward compatibility and avoid user data breakage."
applyTo:
  - "**/*.csv"
  - "**/generate-comprehensive-excel.js"
  - "client/src/pages/Setup.jsx"
  - "client/src/hooks/useAuctionStorage.js"
  - "client/src/hooks/useOfflineAuction.js"
  - "client/src/hooks/useOnlineAuction.js"
  - "server/**/*.js"
---
# CSV And Schema Compatibility Guardrails

- Treat previously saved auction data and older CSV templates as supported unless a migration is explicitly added.
- Never silently rename or remove persisted fields without a compatibility fallback.
- For schema additions, prefer optional fields with sane defaults.
- Preserve accepted alias keys for imports when possible, and document any new aliases.
- On import parse failures, return row-level actionable errors instead of generic failures.
- Keep export column order stable unless there is a clear migration note.
- If introducing photo/image fields, update all of these together:
  - CSV import parsing and validation
  - In-memory player schema
  - Persisted storage shape
  - Export generation
  - UI forms and previews
- Add or update tests for:
  - legacy CSV headers
  - mixed old/new schema payloads
  - missing optional fields
  - invalid numeric values and malformed rows
