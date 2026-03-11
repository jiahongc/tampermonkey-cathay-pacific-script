# Cathay Pacific Award Flight Helper

A Tampermonkey userscript that automates Cathay Pacific award flight searches across a date range.

## Features

- Search for award availability across multiple dates automatically
- Multi-select cabins (First / Business / Premium Economy / Economy)
- Automatically set the homepage cabin class and passenger count for each required seed search
- Swap button to quickly reverse origin and destination with one click
- Keep searches focused on direct CX (Cathay Pacific) flights only
- Extract flight details: flight number, departure/arrival times, duration, miles required
- Reuse the results page efficiently by harvesting visible `Not available` dates from the date strip
- Advance through later dates with the results-page right arrow instead of restarting from the homepage each time
- Reuse in-page cabin toggles when a searched cabin exposes additional selected cabins
- Automatically dismiss the results-page "no available flights for that date" modal and continue scanning
- Automatically recover from Cathay's transient `Error (3002)` page by returning to the homepage and resuming the run
- Built-in pacing now handles homepage submissions, result-page date hops, and longer cooldowns after 3002 recovery
- Dual-strategy flight parsing (DOM-based + text-based) for reliable data extraction
- Falls back to visible strip/tile pricing when flights parse correctly but miles are missing from the card text
- Results displayed in a collapsible panel overlay
- Scrollable results table area with sticky headers for wider result sets
- Stop button to halt automation at any time
- Settings saved across page navigations

## Scripts

| File | Description |
|---|---|
| `cathay-award-helper.js` | Production version — clean panel without debug log |
| `cathay-award-helper-debug.js` | Debug version — includes in-panel debug log with Copy/Clear controls |

Both versions are functionally identical. The debug version adds a live log panel that captures `[CX Helper]` console output for easier troubleshooting.

## Installation

### From Greasy Fork (recommended)

Install directly from [Greasy Fork](https://greasyfork.org/en/scripts/568672-cathay-award-helper).

### Manual

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Create a new userscript in Tampermonkey
3. Copy the contents of `cathay-award-helper.js` (or the debug version) into the editor
4. Save the script

## Usage

1. Go to [cathaypacific.com](https://www.cathaypacific.com/)
2. The helper panel appears in the top-right corner
3. Select a route preset or enter custom origin/destination — use the **⇄** button to swap them
4. Fill in the start date, number of days, one or more cabins, and number of adults
5. Click **Search date range** to start the automated search
6. The script will automatically set the homepage seed cabin and passengers, then continue most traversal from the results page
7. Use the **Stop** button to halt at any time
8. Results appear in the panel table with Date, Cabin, Flight, Time, Duration, and Miles columns, with elapsed run time shown above the table
9. If something behaves unexpectedly, install the debug version and use the **Copy logs** button to share the `[CX Helper]` logs

## How It Works

The script automates the Cathay Pacific booking interface by:

1. **Homepage setup** — Starts from Cathay's homepage, sets the seed cabin via the custom dropdown, adjusts passenger count, and opens the first result page
2. **Results-page traversal** — Uses the visible date strip, `Not available` cells, right-arrow pagination, and modal dismissal to cover as much of the requested range as possible without rerunning the search
3. **Cabin reuse** — If the results page exposes other selected cabins as in-page toggles, it clicks and scrapes them there before falling back to another homepage seed search
4. **Recovery** — If Cathay returns its transient request-processing error page, the script returns to the homepage and resumes from there
5. **Result extraction** — Parses flight availability using two strategies (DOM-based and text-based) and picks the one with the most complete data

For technical details on the website's DOM patterns and interaction methods, see [cathay-website-patterns.md](cathay-website-patterns.md).

## Requirements

- Tampermonkey (or compatible userscript manager)
- A Cathay Pacific account (for award availability)
