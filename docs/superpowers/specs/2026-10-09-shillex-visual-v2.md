# Shillex visual & motion direction v2

Supersedes the palette, type and "static UI" parts of the design spec (§ Visual direction) and the plan's Global Constraints palette line. The user rejected v1 ("the UI is bad — make everything 10× better and highly animated"). Layout architecture, information density, privacy and honesty rules are unchanged.

## Why v1 failed
It is the most generic dark-mode default: neutral near-black, a single acid-lime accent, Inter everywhere, uniform 8px boxes, no depth, no motion. Nothing in it says "memecoin trenches at 3am".

## Subject, audience, job
- **Subject:** Solana memecoin trench culture. Fast group chats, contract addresses flying past, calls ("watching", "bought", "taking profit", "out"), and the gap between a rumour and a chart.
- **Audience:** traders who live in Axiom, GMGN, Telegram and Discord, often on a phone, and are fluent in dense terminal UIs.
- **Primary job:** follow the conversation around a contract address fast, and trust what is labelled.

## Concept: "Night signal"
A trading floor after midnight, lit by screens. Deep ink-violet space with layered translucent surfaces. Ultraviolet marks *your* actions. Signal-teal marks *tokens*: every CA chip, every token surface. The interface feels alive: things arrive, pulse, roll and settle. Motion always answers something real (a new message, a reaction, a resolved token, a navigation); it never decorates.

## Palette (token names unchanged, so existing CSS keeps working)
| Token | Value | Role |
|---|---|---|
| `--bg` | `#080914` | Midnight ink: app background, violet-black rather than grey |
| `--panel` | `#0F1122` | Columns, sidebars |
| `--raised` | `#171A31` | Inputs, popovers, chips at rest |
| `--hover` | `#1D2140` | Row hover |
| `--line` | `#23274A` | Hairlines |
| `--line-strong` | `#333865` | Emphasised borders |
| `--text` | `#EEEFFF` | Primary text (cool white) |
| `--muted` | `#8A8FB8` | Secondary text (≥ 4.5:1 on `--panel`) |
| `--accent` | `#8B6CFF` | Ultraviolet: primary actions, focus ring, active nav, own stuff |
| `--accent-hover` | `#A28BFF` | |
| `--accent-ink` | `#080914` | Text on accent (midnight ink; white on ultraviolet is only 3.7:1, below AA) |
| `--token` | `#27E0C0` | Signal teal: CA chips, token panel, token links |
| `--up` | `#2BE38A` | |
| `--down` | `#FF4F7B` | |
| `--warn` | `#FFB547` | DEMO labels, self-reported labels, cautions |
| `--heat` | `#FF7A3D` | NEW. Live and trending moments only: live dot, "trending in chat" |

Soft and line variants of accent/token/warn are derived as rgba at 12% and 40%. Add a `--glow-accent` and a `--glow-token` box-shadow (a coloured outer glow, 0 0 24px at about 35%). They are used only on focus, active and just-arrived states.

**Depth:** three surface levels plus glass. Sticky headers and the mobile tab bar use `backdrop-filter: blur(14px) saturate(140%)` over `rgba(8,9,20,.72)`. The page background carries one fixed, very low-contrast radial "aurora" in the top-left (violet) and bottom-right (teal) at under 8% opacity, plus a 2% noise texture (inline SVG data URI). There are no other gradients.

## Type
- **Bricolage Grotesque** (`@fontsource-variable/bricolage-grotesque`, variable width and optical size): wordmark, page titles, big numbers (market cap in the token panel, counts on profiles), empty-state headlines. Use its condensed width (`font-stretch: 75%`–`85%`) at heavy weight for titles. The type itself is the visual element.
- **Geist** (`@fontsource-variable/geist`): all UI and body text.
- **Geist Mono** (`@fontsource-variable/geist-mono`): contract addresses, tickers, prices, timestamps in dense lists. Use it only where alignment matters.
- **Scale (px):** 11 / 12.5 / 14 (body) / 16 / 20 / 28 / 40, with line-height 1.5 for body and 1.1 for display. Sentence case everywhere, and no all-caps labels except the `DEMO` tag and token tickers.
- Remove Inter, JetBrains Mono and Space Grotesk.

## Shape and hierarchy
- **Radius by role, not one radius everywhere:** 4px for chips and tags, 10px for inputs and buttons, 14px for popovers and dialogs, 999px for pills and avatars.
- **Posts are not identical boxed cards.** The feed is a continuous column with hairline separators and a full-row hover wash. Elevation is reserved for floating things: popovers, dialogs, the token panel and the composer when focused.
- **Avatars:** pixel-art avatars inside a 2px ring. The ring turns `--up` with a soft pulse when the person is online, and `--accent` for you.

## Motion system (library: `motion` 13.4.2, imported from `motion/react`)
Global: wrap the app in `<MotionConfig reducedMotion="user">`. Every CSS animation also sits inside `@media (prefers-reduced-motion: no-preference)`. Under reduced motion, transitions become instant or fade only. Never animate layout-affecting properties in CSS; use transform and opacity, or motion's `layout`.

Presets live in `src/lib/motion.ts`, which is the only place durations and springs are defined:
- `spring.snappy`: `{ type: 'spring', stiffness: 520, damping: 34, mass: 0.7 }`, for UI responses such as press, toggle and pill slide.
- `spring.soft`: `{ type: 'spring', stiffness: 260, damping: 28 }`, for panels, sheets and dialogs.
- `spring.bouncy`: `{ type: 'spring', stiffness: 600, damping: 18 }`, for reactions, badges and confirmations.
- `ease.out`: `[0.16, 1, 0.3, 1]`. Durations are 0.12 s (micro), 0.22 s (standard) and 0.4 s (enter).
- Variants: `fadeUp` (y 8 → 0, opacity), `pop` (scale 0.92 → 1), `slideIn(dir)`, `stagger(0.035)`.

Required motion inventory, each answering a real event:
1. **App entrance, once per session:** the wordmark letters stagger in, then nav items stagger at 35 ms. This is the single orchestrated load moment.
2. **Auth screen signature:** behind the sign-in card, a slow "signal river". It is a canvas or CSS layer of fictional CA chips and short shill lines drifting upward in columns at low opacity, with a parallax tilt on pointer move. It pauses when the tab is hidden and is static under reduced motion.
3. **Nav:** the active item has a pill background that slides between items (`layoutId`). An unread badge does a `spring.bouncy` scale bump when its count increases, and its digits roll.
4. **Tabs** (feed, profile, community, and so on): a sliding underline (`layoutId`), with content that cross-slides in the direction of the tab change.
5. **Route change:** the centre column cross-fades with an 8px y-shift (AnimatePresence keyed by pathname segment). Scroll position is restored.
6. **New items arriving** (feed "N new posts" pill, chat messages, notifications): they slide in from their natural edge with `layout` so the siblings glide. A just-arrived item gets a 1.2 s `--glow-accent` (own) or `--glow-token` (token-related) fade. The "N new posts" pill drops from the top with `spring.bouncy`.
7. **Reactions:** pressing a reaction plays an emoji burst of 6–8 particles flying out and fading over 450 ms, plus a scale bump on the button. The count rolls with an odometer (`AnimatedNumber`).
8. **Bookmark and repost:** the icon morphs or fills with `spring.bouncy`. Repost spins 180°.
9. **Composer:** grows on focus with `layout` and shows a circular character-count ring that turns `--warn` then `--down` near the limit. The Post button morphs to a spinner, then a check, then resets. The new post lands at the top of the feed with motion 6.
10. **CA chip:**
    - Pending: a skeleton shimmer sweep.
    - Resolved: a colour cross-fade and a tiny pop.
    - Hover: a 2px lift and teal glow.
    - Preview: springs from the chip (`transformOrigin` at the chip).
11. **Token panel:** slides in from the right with `spring.soft` (desktop) or a bottom sheet with drag-to-dismiss (mobile). Stats count up once on first resolve, and price or market-cap changes flash `--up` or `--down` for 600 ms.
12. **Dialogs, menus, popovers, toasts:**
    - Dialogs scale from 0.96 with a fade; the scrim fades in.
    - Menus and popovers pop from their anchor side.
    - Toasts stack with a spring and swipe to dismiss on touch.
13. **Loading:** skeleton rows with a shimmer sweep that match the real layout. No spinners except inside buttons.
14. **Presence and typing:** the online ring pulses gently (2.4 s). The typing indicator is three dots in a wave.
15. **Calls:** the status pill timeline animates its connector line drawing in. A new call update arrives with motion 6 and a `--heat` flash.
16. **Press feedback everywhere:** buttons and rows scale to 0.97 on press with `spring.snappy`.

Performance budget: animate only transform, opacity and filter. Avoid `layout` on long lists except for arrival and removal. Stagger only the first page of a list. Particles are DOM nodes or a small canvas, cleaned up after the animation. Target 60 fps on a mid-range phone.

## Copy and labels
Sentence case. Errors say what happened and what to do. Empty states invite action ("No posts yet. Follow a few people from Discover to fill this."). `DEMO` and "self-reported" labels stay `--warn` and are never animated away.

## Accessibility floor (unchanged, re-verified)
- The focus ring is 2px `--accent` with a 2px offset, plus `--glow-accent`.
- Contrast is AA, keyboard paths work everywhere, and `prefers-reduced-motion` is fully honoured.
- Motion never carries meaning on its own: every animated state also has a static visual or text.

## v3 addendum: atmosphere (2026-10-10)
The user rejected v2's static backdrop ("looks terrible… add automatic animation… good atmosphere"). v2's palette, type and motion presets stay; this replaces the "one fixed backdrop" rule.
- **`<Atmosphere/>`** (`components/atmosphere`), mounted once at the app root, behind every screen: a sky gradient (`--sky-top` → `--bg` → `--sky-low`), two blurred aurora clouds drifting on 48 s and 62 s loops, a plum and ember horizon glow that breathes, a 2.5% grain, and the signature element, a **candle skyline**. It's a canvas of candlesticks standing on pillars that fade to the ground, so the chart reads as a city at night. A candle prints every 3.2 s, the skyline glides left, the live candle glows, and a dashed last-price line crosses the sky. New posts (ultraviolet) and chat messages (teal) kick the live candle and send a flare up (`useAtmospherePulse` in the shell). It runs at 30 fps, pauses while the tab is hidden, and draws one still frame under reduced motion.
- **Glass columns:** the side columns are thin frost (`--column-side` plus a 10 px blur) and the centre is denser (`--column`) to keep text readable. Reading pages cap the centre at `--center-max` (680 px) and centre the shell, so the sky shows at the sides; community and messages pages (`data-wide`) use the full width.
- **Right rail** (Task 23): sentence-case condensed headings. Live rooms carry a five-bar activity meter whose height follows messages in the last 15 minutes, and it sways only while the room is live. New coins carry a thin teal mentions bar relative to the busiest coin. These bars are relative and are not a ranking.
