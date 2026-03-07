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
- Cathay often renders **duplicate DOM cells for the same visible date**. Deduplicate by day number and keep the smallest candidate by area.
- The strip can be treated as a **mini week view**: once you know the currently selected full date, the cells to the left/right represent contiguous dates
- Cells showing **`Not available`** can be recorded immediately for the current seed cabin without clicking into each one
- When the user requested a date range, prefer harvesting the whole visible strip before falling back to a new homepage search
- The top-of-page "current date" header can be blank or stale after strip clicks, so the selected strip cell is usually more reliable than the header text

### Navigation arrows

- Forward/back arrows are `data-react-aria-pressable` buttons
- Require `forceClick` (PointerEvent sequence)
- After clicking, wait for the calendar strip to re-render before reading new dates
- **Month boundaries**: When advancing past the last day of a month, the strip loads the next month. Detect this by checking if target day appears after navigation.
- On the results page, the **right arrow should be treated as the primary way to continue scanning later dates** in the requested range

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

### Miles fallback

- Some result layouts expose valid nonstop flights in the DOM but omit miles from the parsed card text on the first loaded date
- In those cases, the visible selected strip cell or the active cabin price tile is a reliable fallback source for the miles figure
- Apply that fallback only when flights were parsed successfully but every parsed itinerary is missing miles

## Results Page Quirks

- Business or First seed searches may land on a results page that immediately shows the **"There are no available flights for that date"** modal
- Closing that modal keeps you on the results experience, and the surrounding strip/tile state can still be harvested
- The results page is therefore the primary workspace; the homepage should mainly be used to seed a new cabin/date when the current page cannot reach it

## Debugging Methodology

This section documents the iterative debugging process that led to the working patterns above. Follow this approach when something breaks or the site changes.

### Core principle: Log everything, try multiple strategies, let the user report back

Since the agent cannot see the live browser, the debugging loop is:

1. **Add verbose logging** with a consistent prefix (e.g. `[CX Helper]`) so the user can filter console output
2. **Try multiple approaches in parallel** within the same code — label each strategy (A/B/C/D) in logs
3. **Ask the user to paste console output** back — this is your primary feedback channel
4. **Consolidate** once you identify what works — remove the failed strategies and keep the winner

This is especially important for:
- **Results-page cabin toggles** where the next cabin may only appear after clicking the current one
- **Results-page date arrows** where the correct arrow or click method can vary
- **Strip-cell selection** where a container and its inner button can both be clickable candidates

### What to log

Log aggressively when debugging. For every DOM interaction, log:
- **What you're looking for**: selector, text pattern, aria-label
- **What you found**: number of candidates, their tag names, class names, dimensions, text content
- **What you tried**: which click method, on which element
- **What happened**: did a popup open? Did the value change? Did an options list appear?

Example:
```javascript
log(`Cabin dropdown candidates: ${candidates.length}`);
candidates.forEach((el, i) => {
  const r = el.getBoundingClientRect();
  log(`  [${i}] ${el.tagName}.${el.className} ${r.width}x${r.height} "${el.innerText.trim().slice(0, 40)}"`);
});
```

### Screenshots are invaluable

When logs alone don't explain the behavior, ask the user for a **screenshot of the UI state** (e.g. the open dropdown, the popup layout). This reveals:
- The actual visual structure (custom dropdown vs native select)
- Which element is the real click target vs a wrapper/container
- Whether the interaction actually happened (dropdown opened, value changed)

The cabin class fix was only possible after seeing a screenshot of the open dropdown — it revealed `SPAN.dropdown__value` as the click target, which wasn't obvious from DOM inspection alone.

### Common failure patterns and how we solved them

#### "It worked in DOM but not in UI"
- **Symptom**: Native `<select>` value changed to "J" (Business) but UI still showed "Premium Economy"
- **Root cause**: The `<select>` is decorative/accessibility-only. No React fiber attached. The real UI is a custom dropdown component.
- **Lesson**: On React sites, always verify that the HTML element you're manipulating is actually connected to React state. Check for `__reactFiber$`, `__reactProps$`, `_valueTracker` — if none exist, the element is likely decorative.

#### "Click opens then immediately closes"
- **Symptom**: Dropdown visibly flashes open then closes within the same tick
- **Root cause**: `forceClick` dispatches multiple events (pointer + mouse + click). The dropdown opens on `mousedown` but the subsequent `click` event triggers the "click outside" close handler.
- **Lesson**: Try native `.click()` alone first. Only escalate to `forceClick` if the element doesn't respond to `.click()`. Different components on the same page can require different click strategies.

#### "Clicked the wrong element (container instead of button)"
- **Symptom**: Logs show a click on `DIV.cabinPaxSelection__footer` (1200x80) instead of the Done button (80x40)
- **Root cause**: `querySelector` or `findVisibleElements` returns containers before their children, and containers also match text searches.
- **Lesson**: Always **sort candidates by bounding rect area (smallest first)**. The actual interactive element is almost always the smallest one matching your criteria.

#### "Reading wrong value from DOM tree"
- **Symptom**: Adult count read as "10" instead of "1"
- **Root cause**: Walking up `.parentElement` to find a container, then reading `.innerText`, eventually reached `<html>` which contained "10 Notification" from the page header.
- **Lesson**: Never walk up the DOM tree unbounded. Use targeted selectors (aria-label, specific class names) and positional logic (element between two known buttons) instead.

#### "Data extracted but not recorded"
- **Symptom**: Console showed 3 flights with miles from text strategy, but results table showed 0 miles
- **Root cause**: Strategy selection used `hitsA.length >= hitsB.length` (flight count), ignoring that strategy A had 0 miles while B had miles.
- **Lesson**: When comparing extraction strategies, **prioritize data completeness** (e.g. flights with miles) over raw count.

#### "DOM elements are too large to be cards"
- **Symptom**: DOM strategy found 3 "cards" at 1547x1200 — these were page-level containers
- **Root cause**: Broad selectors matched ancestor elements that contained flight data in their subtree
- **Lesson**: Add **size bounds** to element filtering. A flight card is typically under 800x800. Anything larger is a container.

### The multi-strategy pattern

When interacting with an unknown UI component, deploy **multiple strategies simultaneously** with logging:

```javascript
// Strategy A: Try class-based selector
const a = document.querySelector(".dropdown__value");
log(`Strategy A: ${a ? a.tagName + " " + a.className : "not found"}`);

// Strategy B: Try aria-label
const b = document.querySelector('[aria-label*="cabin"]');
log(`Strategy B: ${b ? b.tagName + " " + b.className : "not found"}`);

// Strategy C: Try text content matching
const c = findVisibleElements("span, div").find(el => /Premium Economy/i.test(el.innerText));
log(`Strategy C: ${c ? c.tagName + " " + c.className : "not found"}`);

// Try each that was found
for (const [label, el] of [["A", a], ["B", b], ["C", c]]) {
  if (el) {
    log(`Trying ${label}: clicking ${el.tagName}.${el.className}`);
    el.click();
    await sleep(500);
    // Log the result
  }
}
```

After the user reports which strategy worked, **consolidate**: keep the winner as primary, optionally keep one fallback, remove the rest.

### Checklist for debugging a new interaction

1. [ ] Add logging with consistent prefix — confirm logs actually appear in user's console
2. [ ] Identify all candidate elements — log tag, class, dimensions, text for each
3. [ ] Try multiple click methods per candidate — `.click()`, `forceClick()`, `dispatchEvent(new MouseEvent(...))`
4. [ ] Ask user to paste console output AND provide screenshot if behavior is unclear
5. [ ] Check if native HTML element has React fiber — if not, it's decorative
6. [ ] Sort candidates by size — smallest is usually the real interactive element
7. [ ] After finding what works, consolidate code and remove debug strategies

## Element Discovery Helpers

### findVisibleElements(selector)

Queries all matching elements and filters to those that are:
- Visible (`offsetParent !== null` or fixed/sticky position)
- Have non-zero bounding rect
- Not hidden via `visibility: hidden` or `display: none`

### normalizeText(str)

Collapses whitespace and trims — useful for comparing element text content that may have extra spaces or newlines.
