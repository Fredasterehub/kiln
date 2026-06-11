---
status: complete
tier: standard
visual_direction: minimal
counts:
  features: 9
  screens: 4
open_questions:
  - id: OQ-1
    text: Which OAuth provider best fits a small team — Auth0, Clerk, or self-hosted Keycloak?
    priority: high
    timing: before-build
  - id: OQ-2
    text: Should the audit log be append-only in Postgres or streamed to an external sink?
    priority: medium
    timing: during-build
---

# VISION — Team Expense Tracker

## 1. One-liner
A web app where a small team submits, approves, and reports on expenses, with role-based access
and an audit trail.

## 2. Problem
The team currently tracks expenses in a shared spreadsheet. Approvals are ad hoc, there is no audit
trail, and month-end reporting is manual and error-prone.

## 3. Users
- Submitters (file expenses), Approvers (approve/reject), Admins (manage users, export reports).

## 4. Functional Requirements
- FR-001 Submitters create an expense with amount, category, date, and receipt upload.
- FR-002 Approvers see a queue and approve or reject with a comment.
- FR-003 Admins export a month's approved expenses as CSV.
- FR-004 Role-based access control across all routes.
- FR-005 Every state change is written to an immutable audit log.

## 5. Success Criteria (executable intents)
- SC-001 A submitter can file an expense and it appears in the approver's queue.
- SC-002 An approved expense appears in the CSV export with the correct total.
- SC-003 A submitter cannot access an admin route (403).

## 6. Non-Goals
- No mobile app. No multi-currency. No accounting-system integration in v1.

## 7. Tech Stack
- Node + a web framework, Postgres, a hosted OAuth provider (see OQ-1), server-rendered UI.

## 8. Constraints
- Must handle real money figures correctly (no floating-point currency). Auth is third-party.
- Audit log must be tamper-evident.

## 9. Open Questions
- OQ-1 [Priority: high, Timing: before-build] Which OAuth provider best fits a small team?
- OQ-2 [Priority: medium, Timing: during-build] Append-only Postgres audit log vs external sink?

## 12. Style / Visual Direction
Clean, minimal, utilitarian — function over flourish; a single accent color; no marketing gloss.
