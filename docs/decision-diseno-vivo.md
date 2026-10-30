# Product decision: live design (authorized)

Date: 2026-10-28. Supersedes the earlier instructions that required
approval to generate, update or export drafts. It removes no
history: recorded approvals stay visible as optional reviews, and
approved baselines keep their invariants.

## What changes

- Saving, generating and continuing to design need no approval.
- Ctrl+S saves a version and refreshes the derived views.
- Review (approve) is optional and informative.
- The developer keeps control of their edits.
- AI never silently overwrites manual content: its results go to
  separate proposals that the person takes in.
- "Stale" means "needs syncing/review", not a ban on working.
  Dependencies are never silently updated to fake coherence.

## What does NOT change (current structural blocks)

- Missing references, invalid content, concurrency conflicts
  (`expected_*`) and disk errors still block.
- The review (approve) action still requires a current and valid
  version, human authorship and explicit confirmation: those are
  the review's own rules, not a barrier to other work.
- Historical approved baselines are immutable and reproducible;
  their invariants (approved, current and coherent versions,
  source closure, nothing archived) are never relaxed
  retroactively.
- Safe deletion still requires zero approvals, zero dependents,
  zero baselines and zero mentions in generations.
- Provenance, exact versions as sources and validate → persist →
  publish atomicity stay fully intact.

## Superseded earlier rules (historical context)

1. "Only the current and valid version may be approved" — CURRENT
   only as a rule of the review action; SUPERSEDED as a requirement
   to generate, save, update or deliver drafts.
2. "Generating designs requires approved sources" (`not_approved`) —
   SUPERSEDED: generation starts from current saved versions.
3. "Accepting updates requires approved sources" (`update_stale`
   for missing approval, `source_not_approved`) — SUPERSEDED:
   existing and current sources are enough; review is reported.
4. "Re-approving a stale derivative is not enough" — SUPERSEDED as
   a mandatory flow; review stays available but no longer blocks
   syncing.
5. "A baseline must include approved versions" — CURRENT for
   approved baselines; the work/draft delivery is a NEW and
   separate concept, without that requirement, and must not be
   called coherent or verified while it has pending items.
6. "Pending approval" states — the label becomes optional review;
   the computed status still exists as information.

## Stages

- Stage A (saving without barriers): remove barriers 2–4, central
  Ctrl+S, local derivatives, opt-in AI automation per module (off
  by default), exportable work/draft delivery.
- Stage B (mockups): versioned Mockup artifact with its own
  editor, flow/ER generation from requirements and mockups under
  the existing contracts, with no style editor or Figma.
