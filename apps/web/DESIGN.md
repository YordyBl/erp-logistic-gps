---
name: ERP Logistic
description: Precise, reliable delivery execution and private evidence review for Lima and Callao.
colors:
  background: "oklch(0.97 0.006 245)"
  surface: "oklch(1 0 0)"
  ink: "oklch(0.24 0.035 240)"
  muted: "oklch(0.47 0.026 240)"
  line: "oklch(0.88 0.012 240)"
  primary: "oklch(0.39 0.075 232)"
  primary-deep: "oklch(0.25 0.05 235)"
  signal-amber: "oklch(0.69 0.16 55)"
  success: "oklch(0.43 0.09 158)"
  warning: "oklch(0.45 0.11 55)"
  danger: "oklch(0.48 0.15 28)"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 4rem)"
    fontWeight: 720
    lineHeight: 0.98
    letterSpacing: "-0.065em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3vw, 2.8rem)"
    fontWeight: 710
    lineHeight: 1
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.91rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.68rem"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "11px 16px"
    height: "43px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "11px 16px"
    height: "43px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "11px 13px"
    height: "45px"
  surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: ERP Logistic

## 1. Overview

**Creative North Star: "La ruta bajo control"**

The interface serves drivers moving through assigned stops and staff responsible for delivery outcomes. It should feel precise, reliable, and direct: each route is an ordered sequence, every order has a visible state, and evidence availability is never confused with a local preview or a pending upload.

The visual language pairs deep blue operational framing with an amber route signal, set against quiet cool surfaces. Dense information is grouped by task rather than flattened into a generic dashboard. The memorable signature is the route sequence itself: numbered stop markers connected along one clear path. Manifest is a visual and UX reference only; its code, assets, and brand identity must not be reused.

**Key Characteristics:**
- Route and order states remain explicit and scannable.
- Amber marks the next action or route progress; status colors communicate outcomes.
- Evidence rows distinguish local previews, saved photos, and available private files.
- The layout compresses to mobile without hiding the driver's primary actions.

## 2. Colors

The palette is cool and operational: deep blue anchors navigation and primary actions, amber marks route progress, and restrained semantic colors identify outcomes.

### Primary
- **Route Blue** (`oklch(0.39 0.075 232)`): Primary buttons, links, route codes, and active operational labels.
- **Deep Dispatch Blue** (`oklch(0.25 0.05 235)`): Login feature panel and persistent navigation rail.

### Secondary
- **Signal Amber** (`oklch(0.69 0.16 55)`): Route progress, logo signal, and the highest-priority in-flow action. Keep it purposeful rather than decorative.

### Tertiary
- **Delivery Green** (`oklch(0.43 0.09 158)`): Available evidence and completed delivery states.
- **Attention Amber** (`oklch(0.45 0.11 55)`): In-progress states that need attention without indicating failure.
- **Incident Red** (`oklch(0.48 0.15 28)`): Failed outcomes and destructive or incident actions.

### Neutral
- **Cool Mist** (`oklch(0.97 0.006 245)`): Page canvas behind work surfaces.
- **Clean Surface** (`oklch(1 0 0)`): Forms, route details, result panels, and dialogs.
- **Operational Ink** (`oklch(0.24 0.035 240)`): Primary text on light surfaces.
- **Quiet Slate** (`oklch(0.47 0.026 240)`): Supporting copy, secondary labels, and timestamps.
- **Divider Slate** (`oklch(0.88 0.012 240)`): Structural borders, progress tracks, and row separators.

**The Route Signal Rule.** Amber identifies route progress and the next meaningful action; it is not a substitute for semantic delivery, warning, or incident states.

## 3. Typography

**Display Font:** Inter (with ui-sans-serif, system-ui, sans-serif fallbacks)  
**Body Font:** Inter (with ui-sans-serif, system-ui, sans-serif fallbacks)  
**Label/Mono Font:** ui-monospace, SFMono-Regular, monospace

**Character:** Inter keeps operational copy direct and legible, while the compact monospaced face makes route codes, timestamps, and small metadata feel precise without turning the whole interface into a terminal.

### Hierarchy
- **Display** (weight 720, `clamp(2.5rem, 5vw, 4rem)`, line-height 0.98): Login statement; short, confident copy only.
- **Headline** (weight 710, `clamp(2rem, 3vw, 2.8rem)`, line-height 1): Primary page titles.
- **Title** (weight 700, `1.25rem`, line-height 1.25): Dialog and result headings.
- **Body** (weight 400, `0.91rem`, line-height 1.55): Instructions and supporting explanation; keep long copy within 65ch.
- **Label** (weight 700, `0.68rem`, letter-spacing `0.08em`): Route codes, compact metadata, and small section identifiers. Use uppercase sparingly for true operational labels.

**The Readable Route Rule.** Use monospaced text for codes and compact metadata only; recipient names, addresses, explanations, and actions stay in the sans-serif family.

## 4. Elevation

Depth is mostly structural: cool page canvas, white working surfaces, and thin borders establish hierarchy. Shadows are nearly imperceptible at rest; the modal backdrop is the one deliberate elevation change. Sticky navigation and headers use position and surface contrast, not ornamental glow.

### Shadow Vocabulary
- **Surface lift** (`0 2px 10px oklch(0.24 0.035 240 / 0.025)`): Barely separates a work surface from the page canvas.
- **Modal lift** (`0 18px 70px oklch(0.12 0.02 240 / 0.24)`): Separates a focused photo or outcome dialog from the dimmed workspace.

**The Quiet Elevation Rule.** Keep ordinary cards and panels flat-looking; reserve a pronounced shadow for a modal that temporarily owns focus.

## 5. Components

### Buttons
- **Character:** Confident, compact actions with labels that name the result.
- **Shape:** Gently rounded (`8px`); minimum height `43px`.
- **Primary:** Route blue with white text; `11px 16px` padding.
- **Hover / Focus:** Darken the primary fill on hover; show a visible amber focus outline (`3px`, `3px` offset) for keyboard navigation.
- **Secondary / Quiet / Danger:** Secondary uses a surface and divider border; quiet is text-led; danger uses incident red and is reserved for incident actions.

### Chips
- **Style:** Compact status pills (`5px` radius) with a semantic tinted background and readable semantic text.
- **State:** Neutral, success, warning, and danger each have a distinct color role; never signal status by color alone.

### Cards / Containers
- **Character:** Work surfaces group one operational unit, not decorative content.
- **Corner Style:** Softly rounded (`9–10px`).
- **Background:** Clean surface over the cool mist canvas.
- **Shadow Strategy:** Barely visible surface lift; use divider borders to define edges.
- **Border:** One-pixel cool divider.
- **Internal Padding:** Usually `16–22px`; reduce at narrow mobile widths without compressing controls.

### Inputs / Fields
- **Style:** White surface, one-pixel divider, gently rounded (`8px`), minimum height `45px`.
- **Focus:** Route-blue border and soft outer ring; keyboard focus uses the visible amber outline.
- **Error / Disabled:** Incident-red error copy on a pale red wash; disabled controls remain visibly inactive and cannot imply a completed action.

### Navigation
- **Style:** Deep dispatch blue rail on desktop, grouped route links with a clear active surface; at tablet widths the rail becomes a compact top row.
- **Typography:** Sans-serif labels; compact monospaced group identifiers only where useful.
- **States:** Active and hover states use a lighter blue surface and amber signal; don't rely on the amber accent alone to identify the active destination.
- **Mobile:** Keep the route/evidence destination visible while hiding secondary rail details.

### Route Sequence
- **Character:** The signature component is a real ordered path, not generic numbered decoration.
- **Structure:** Numbered stop markers follow route sequence and connect to the next stop with a thin divider.
- **Order rows:** Group each order under its stop and keep recipient, address, package count, status, and available actions together.
- **Progress:** Show route progress against resolved orders; offer route completion only after each order has an outcome and the driver explicitly confirms it.

### Evidence Rows
- **Character:** Treat upload state as operational data, not a gallery flourish.
- **Preview:** Show a local preview only as pending; it cannot enable confirmation.
- **Saved:** Use an explicit saved/available label after the API confirms the upload.
- **Private view:** Open authorized evidence in a focused dialog; never expose a public object URL or deletion action.

## 6. Do's and Don'ts

### Do:
- **Do** use Route Blue for primary actions and Deep Dispatch Blue for the persistent navigation frame.
- **Do** reserve Signal Amber for route progress and the next meaningful action.
- **Do** state whether a photo is a local preview, saved, or available before enabling a delivery outcome.
- **Do** keep the route's sequence visible and preserve an explicit confirmation before closing the route.
- **Do** keep keyboard focus, mobile actions, and reduced-motion behavior usable.

### Don't:
- **Don't** reuse Manifest's code, assets, or brand identity; it is only a visual and UX reference.
- **Don't** reuse evidence-storage claims or labels to imply that a local preview is already private, saved, or available.
- **Don't** use colored side stripes as card or alert decoration.
- **Don't** add decorative numbered section markers; stop numbers are reserved for the actual route order.
- **Don't** use heavy shadows on ordinary work surfaces or hide required actions at mobile widths.
