# Cathay Pacific Website DOM Patterns

Technical reference for automating interactions on `cathaypacific.com`. These patterns were discovered through iterative testing and may change as Cathay updates their site.

## General Notes

- The site uses **React** with custom components — native HTML elements (e.g. `<select>`) often exist for accessibility but have no React fiber attached.
- Many interactive elements use `data-react-aria-pressable="true"` and require **PointerEvents** to trigger properly. Standard `MouseEvent` clicks are ignored.
- The site navigates across subdomains (e.g. `www.cathaypacific.com` to `book.cathaypacific.com`), so `localStorage` is per-origin. Use `window.name` for cross-origin state persistence.

## Click Strategies

### forceClick (for React Aria elements)

Dispatches the full event sequence needed by React Aria pressable elements:

```
pointerdown → mousedown → pointerup → mouseup → click → native .click()
```

This is required for **calendar navigation arrows** and other `data-react-aria-pressable` buttons.

### Native .click() only (for custom dropdowns)

Some custom dropdowns (e.g. cabin class) will **open then immediately close** if given the full `forceClick` sequence, because the extra events trigger the dropdown's "click outside" close handler. Use a plain `.click()` for these.

## Cabin & Passenger Popup

### Opening the popup

- Target element: `div.bookTripPanel__cabinPax__comboBox` (or similar container)
- The popup overlays the page with class/passenger selection

### Cabin class dropdown

The cabin class uses a **custom dropdown component**, not a native `<select>`.

- **Native `<select>` exists but is decorative** — no React fiber, no `_valueTracker`, no `__reactProps`. Changing its value does nothing to the UI.
- **Click target**: `SPAN.dropdown__value` — the span showing the current cabin name (e.g. "Premium Economy")
- **Click method**: Native `.click()` only (not `forceClick`)
- **Options appear as**: visible `<span>` or `<div>` elements matching `/^(First|Business|Premium Economy|Economy)$/i`
- **Selecting an option**: Native `.click()` on the matching element
- **Sort candidates by size** (smallest first) to avoid clicking container divs

Available cabin values:
| Display Name | Select Value |
|---|---|
| First | F |
| Business | J |
| Premium Economy | W |
| Economy | Y |

### Adult passenger count

- Uses `+` / `-` buttons discoverable via `aria-label`:
  - Decrease: `aria-label` matching `/decrease\s*adult/i`
  - Increase: `aria-label` matching `/increase\s*adult/i`
- **Reading current count**: Find the numeric element positioned **between** the two buttons (by DOM x-coordinate). Do NOT walk up DOM parents to read text — you'll reach the `<html>` element and pick up unrelated page numbers.
- Buttons are `data-react-aria-pressable`, so use `forceClick`.

### Done button

- Text content: "Done"
- Found among `button, div, a, span` elements
- **Sort candidates by bounding rect area** (smallest first) to avoid clicking the footer container (`div.cabinPaxSelection__footer`) instead of the actual button
- Use `forceClick` for React Aria compatibility

## Calendar / Date Navigation

### Date strip cells

- Calendar uses a horizontal strip of date cells
- Each cell contains text like `MON 15` or `TUE 16`
- Match with regex: `/\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+(\d{1,2})\b/i`
- Capture group 1 gives the day number

### Navigation arrows

- Forward/back arrows are `data-react-aria-pressable` buttons
- Require `forceClick` (PointerEvent sequence)
- After clicking, wait for the calendar strip to re-render before reading new dates
- **Month boundaries**: When advancing past the last day of a month, the strip loads the next month. Detect this by checking if target day appears after navigation.

## Flight Results Parsing

Two strategies are used in parallel, and the one with better data wins.

### Strategy A: DOM-based

- Look for flight card elements containing flight info, times, and miles
- **Filter out oversized elements**: Any element with `width > 800` or `height > 800` is a page container, not a flight card
- Cards typically contain: flight number (`CX\d+`), departure/arrival times, duration, and miles

### Strategy B: Text-based

- Extract visible text from the results area
- Parse flight details using regex patterns
- Miles extracted from text like `75,000 miles` or `75000`

### Strategy selection

```
if strategyA has more flights with miles → use A
if strategyB has more flights with miles → use B
if tied on miles → use whichever has more total flights (A wins ties)
```

## Element Discovery Helpers

### findVisibleElements(selector)

Queries all matching elements and filters to those that are:
- Visible (`offsetParent !== null` or fixed/sticky position)
- Have non-zero bounding rect
- Not hidden via `visibility: hidden` or `display: none`

### normalizeText(str)

Collapses whitespace and trims — useful for comparing element text content that may have extra spaces or newlines.
