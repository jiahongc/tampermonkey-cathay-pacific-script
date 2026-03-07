# Cathay Pacific Award Flight Helper

A Tampermonkey userscript that automates Cathay Pacific award flight searches across a date range.

## Features

- Search for award availability across multiple dates automatically
- Automatically set cabin class (First / Business / Premium Economy / Economy) and passenger count
- Filter to direct CX (Cathay Pacific) flights only
- Extract flight details: flight number, departure/arrival times, duration, miles required
- Dual-strategy flight parsing (DOM-based + text-based) for reliable data extraction
- Results displayed in a collapsible panel overlay
- Stop button to halt automation at any time
- Settings saved across page navigations

## Installation

### From Greasy Fork (recommended)

Install directly from [Greasy Fork](https://greasyfork.org/en/scripts/568672-cathay-award-helper).

### Manual

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Create a new userscript in Tampermonkey
3. Copy the contents of `cathay-award-helper.user.js` into the editor
4. Save the script

## Usage

1. Go to [cathaypacific.com](https://www.cathaypacific.com/)
2. Set your route (origin/destination) and trip type manually
3. The helper panel appears in the top-right corner
4. Fill in the date range, cabin class, and number of adults
5. Click **Search date range** to start the automated search
6. The script will automatically set cabin class and passengers on the homepage, then navigate through each date
7. Use the **Stop** button to halt at any time
8. Results appear in the panel table with Date, Flight, Time, Duration, and Miles columns

## How It Works

The script automates the Cathay Pacific booking interface by:

1. **Homepage setup** — Sets cabin class via the custom dropdown and adjusts passenger count using the +/- buttons
2. **Date navigation** — Navigates the calendar date strip day-by-day, triggering searches for each date in your range
3. **Result extraction** — Parses flight availability using two strategies (DOM-based and text-based) and picks the one with the most complete data

For technical details on the website's DOM patterns and interaction methods, see [cathay-website-patterns.md](cathay-website-patterns.md).

## Requirements

- Tampermonkey (or compatible userscript manager)
- A Cathay Pacific account (for award availability)
