# Generic Auction App Plan

## Objective
Evolve the current cricket-focused app into a template-driven auction platform while keeping existing cricket workflows fully backward compatible.

## Product Direction
- Keep Cricket as the default first-class template.
- Add additional templates (Football, Open Custom) without changing core bidding behavior.
- Separate domain labels/rules from core engine logic.

## Guiding Constraints
- Do not break existing saved auctions or CSV imports.
- Prefer additive schema changes with safe defaults.
- Keep setup UX simple; hide advanced options behind progressive disclosure.

## Phase Plan

### Phase 0: Discovery and Scope Freeze
- Finalize template model (labels, category defaults, optional rules).
- Identify all cricket-specific hardcoded labels in client and server.
- Define compatibility contract for old snapshots/CSV.

Exit criteria:
- Approved template schema and migration strategy.

### Phase 1: Template and Label Abstraction (Low Risk)
- Introduce `templateId` in auction setup data (default: `cricket`).
- Add a template config map for labels:
  - Player -> Item
  - Team -> Bidder
  - Role -> Category
- Refactor UI text to read from template config.

Exit criteria:
- App behaves exactly as today with `templateId=cricket`.
- No behavior changes in tests for cricket mode.

### Phase 2: Category Model Generalization
- Replace fixed role assumptions with template categories.
- Allow category management in setup (add/edit/remove categories per template/custom).
- Ensure player add/edit/import supports dynamic categories.

Exit criteria:
- Setup supports both predefined and custom categories.
- Existing cricket categories still work with old data.

### Phase 3: Import/Export Compatibility Upgrade
- Keep current CSV headers supported (`name`, `role`, `basePrice`, `photoUrl` + aliases).
- Add generic aliases (`itemName`, `category`, `basePrice`, `imageUrl`) without removing old ones.
- Include template metadata in export/snapshot payloads.

Exit criteria:
- Legacy CSV and snapshots restore without manual changes.
- New generic CSV format imports successfully.

### Phase 4: Optional Rule Plugins
- Add optional template-specific rule hooks (e.g., category quotas).
- Keep core auction engine generic and rule-agnostic by default.

Exit criteria:
- Rules can be enabled/disabled per template.
- Cricket-specific constraints are optional, not hardcoded globally.

### Phase 5: UX and Positioning
- Add template chooser in setup.
- Update landing copy from cricket-only language to auction-platform messaging.
- Keep cricket quick-start prominent.

Exit criteria:
- New users can start cricket in one click.
- Non-cricket templates are discoverable and usable.

## Compatibility Checklist (Must Pass)
- Existing cricket snapshot restore works.
- Existing cricket CSV import works.
- Existing online/offline auction flows pass.
- Existing results export works.
- Existing tests pass; add coverage for template/custom flows.

## Risks and Mitigations
- Risk: Over-generalization degrades cricket UX.
  - Mitigation: Preserve a cricket-first preset and defaults.
- Risk: Schema drift breaks saved data.
  - Mitigation: Additive fields only, fallback defaults, migration tests.
- Risk: Setup complexity increases.
  - Mitigation: Basic mode + advanced toggles.

## Check-in Log

### 2026-07-12 (Check-in 1)
Status:
- Idea approved for future iteration.
- Planning document created.

Decisions made:
- Proceed with template-driven architecture.
- Preserve cricket as default template.
- Prioritize backward compatibility.

Next actions:
1. Implement Phase 1 (`templateId` + label abstraction).
2. Add tests validating cricket behavior remains unchanged.
3. Re-review UX copy after label abstraction.

## Next Review Agenda
- Confirm Phase 1 data shape.
- Identify exact files for first refactor PR.
- Split work into small, merge-safe PRs.
