---
name: design-critique
description: Pre-emit self-critique for UI/visual/design output (components, CSS, copy, layouts) — anti-slop gates, taste dials, and a design-token contract check, run BEFORE the work is shown, not after. Use whenever producing or editing anything with a visual/UX surface.
user-invocable: true
---

# Design critique

A checklist run against your OWN output before you show it, not a linter run after the fact. This
is the one home for several related ideas (hallmark's pre-emit self-critique, a slop-gate list,
astryx-style token discipline) folded into a single skill rather than several overlapping ones or
a whole new source module — the value here is procedural judgment, which is what a skill is for;
building deterministic tooling around subjective taste would be false precision.

## Slop gates — catch these before emitting

- **Generic AI-visual-cliché markers**: purple/blue gradient backgrounds with no reason, emoji
  used as section icons, everything centered regardless of content type, decorative rounded
  corners/shadows applied uniformly instead of purposefully, stock-phrase headers ("Unlock the
  power of...").
- **Padding/spacing that wasn't decided, just defaulted.** If every gap is the same "safe" value,
  that's the tell of not having actually looked at the layout.
- **Copy that describes instead of communicates.** "This section shows your recent activity" above
  a list literally showing recent activity is filler, not information.

## Pre-emit self-critique (do this last, right before showing the work)

Look at what you are about to output and ask, plainly: would someone who does this for a living
ship it, or does it read as generated? If the honest answer is "generated," name the specific
reason (not "needs polish") and fix that one thing before emitting — vague dissatisfaction doesn't
converge, a named defect does.

## Taste dials — calibrate, don't default

State (even briefly, to yourself) where this piece sits on the axes that matter for its context:
formal ↔ playful, dense ↔ spacious, bold ↔ restrained. A dashboard for financial data and a
landing page for a kids' app should not default to the same visual voice.

## Token-contract check

If the project already defines a design-token system (CSS custom properties, a Tailwind config, a
theme object), every color/spacing/type value in new work should reference a token, not a one-off
magic value — an unreferenced `#3b82f6` next to a token file that defines `--color-primary` is a
drift bug, not a style choice. If no token system exists, this check doesn't apply — don't invent
one uninvited.

## Boundary

This is a self-review pass, not a build gate — there's no CI enforcement here, deliberately: taste
resists deterministic scoring, and a false-precision linter for it would produce confident-wrong
verdicts. It also isn't a replacement for testing the actual rendered result in a browser when the
work is inspectable that way — this catches what looking at code alone can catch. Motion/animation
taste is a large enough topic to warrant its own skill rather than sprawling this one — see
`motion-design` for anything with a transition, animation, or micro-interaction in it.
