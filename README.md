# Cathay Pacific Award Flight Helper

A Tampermonkey userscript that automates Cathay Pacific award flight searches across a date range.

## Features

- Search for award availability across multiple dates automatically
- Filter to direct CX (Cathay Pacific) flights only
- Extract flight details: flight number, departure/arrival times, duration, miles required
- Results displayed in a convenient panel overlay
- Stop button to halt automation at any time
- Settings saved to localStorage for persistence

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Create a new userscript in Tampermonkey
3. Copy the contents of `cathay-award-helper.user.js` into the editor
4. Save the script

## Usage

1. Go to [cathaypacific.com](https://www.cathaypacific.com/)
2. Set your route (origin/destination) and trip type manually
3. The helper panel appears in the top-right corner
4. Fill in the date range and cabin class in the panel
5. Click **Search date range** to start the automated search
6. Use the **Stop** button to halt at any time
7. Results appear in the panel table with Date, Flight, Time, Duration, and Miles columns

## Requirements

- Tampermonkey (or compatible userscript manager)
- A Cathay Pacific account (for award availability)
