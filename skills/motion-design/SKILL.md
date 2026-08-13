---
name: motion-design
description: Judge or write UI motion (CSS/JS animation, Framer Motion / Motion, transitions, micro-interactions) against context-weighted designer philosophies instead of one universal taste. Use whenever adding, reviewing, or auditing any animation — a hover effect, a page transition, a loading state, a modal enter/exit.
user-invocable: true
---

# Motion design

Static-visual taste (layout, color, type, spacing) is `design-critique`'s job. This skill is
the motion-specific fourth axis that skill doesn't cover: **should this animate at all, and if
so, how** — adapted from `kylezantos/design-motion-principles` (MIT), which distills the
*publicly published* work of three designers. The three-lens framing below is that skill's
interpretation, named in tribute — not authored or endorsed by the designers themselves.

## Step 0 — pick a mode

- **Create**: "build", "animate this", "add a transition", "make it feel..." → write motion.
- **Audit**: "review", "is this motion good", "check the animations" → evaluate existing motion.
- Ambiguous → ask which, don't guess.

## The three lenses — weight by context, don't apply one universally

| Lens | Question it asks | Best for |
|---|---|---|
| **Restraint & speed** (Emil Kowalski's public work — Linear, ex-Vercel) | "Should this animate at all?" | Productivity tools, high-frequency interactions |
| **Production polish** (Jakub Krehel's public work) | "Is this subtle enough for production?" | Shipped consumer apps, professional refinement |
| **Creative experimentation** (Jhey Tompkins's public work) | "What could this become?" | Portfolios, kids' apps, marketing delight moments |

A SaaS dashboard should default restraint-primary, polish-secondary, experimentation only for
empty states. A kids' app inverts that — polish and delight lead, restraint only for
high-frequency in-game interactions. State which lens leads *before* writing or judging a single
animation; the same modal deserves a different verdict in each context.

## The frequency gate (the one rule that's closer to universal)

Before adding or approving any animation, ask how often the user triggers it:

| Frequency | Recommendation |
|---|---|
| Rare (monthly) | Delightful, expressive motion welcome |
| Occasional (daily) | Subtle, fast |
| Frequent (100s/day) | No animation, or an instant transition |
| Keyboard-initiated | Never animate |

## Duration — context-dependent, not a universal cap

Restraint contexts: under 300ms, 180ms ideal. Production-polish contexts: 200–500ms for
smoothness. Creative/playful contexts: whatever serves the effect. **Do not flag a duration
without first establishing which lens leads** — a blanket "animations must be under 200ms" rule
is exactly the false-precision this skill exists to avoid.

## The golden rule

> "The best animation is that which goes unnoticed."

If every interaction draws a comment ("nice animation!"), it's probably too prominent for
production — outside kids'/playful contexts, where noticing *is* the goal.

## Motion-specific slop (Audit mode, in addition to `design-critique`'s general slop gates)

- Decorative-by-default motion with no interaction to justify it (a hero element animating in
  for no reason a user would name).
- Every element springing in from `scale(0)` or `opacity: 0` uniformly — the tell of a template,
  not a decision.
- Pulsing/breathing indicators applied everywhere as a default "liveliness" pass.
- Hover-scale on every clickable element regardless of size or context ("hover-scale-spam").
- Uniform stagger on every list, whether or not sequence carries meaning.

## Accessibility — not optional, no exceptions

Every animation, Create or Audit, must respect `prefers-reduced-motion` — either by removing
non-essential motion under that media query, or substituting an instant/cross-fade equivalent.
This is a hard rule, not a taste call; the deterministic check for it is `guard`'s
`checkDesignTokens`-adjacent motion-lint (see `decisions.md` D033).

## Boundary

Like `design-critique`, this is judgment applied through a stated framework, not a deterministic
gate — most of what's above (which lens leads, whether a duration serves its context) resists
scoring the same way color-token drift doesn't. Compose with `design-critique` for the rest of a
component's taste; don't duplicate its slop-gate or token-contract sections here.
