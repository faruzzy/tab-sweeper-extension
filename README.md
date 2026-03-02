# Tab Sweeper (Chrome Extension)

A Manifest V3 extension to help reduce tab overload.

## Features
- Tracks how long web tabs stay open.
- Sends a warning notification when tabs exceed `warningMinutes`.
- Auto-closes tabs after `closeMinutes`, except domains in your `exceptionDomains` list.
- Saves auto-closed tabs locally and shows a report grouped by day.

## Install (unpacked)
1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:
   - Select the folder where you cloned/downloaded this repository

## Configure
1. Open extension **Settings** (Options page).
2. Set:
   - Warn after minutes
   - Auto-close after minutes
   - Sweep interval in seconds
3. Add exception domains that should never be auto-closed.
4. Click **Save Settings**.

## Test defaults
- Warn after: `1` minute
- Auto-close after: `5` minutes (non-exception domains)
- Sweep interval: `30` seconds

## Closed tabs report
- Open from popup (`Saved Tabs`) or directly:
  - `chrome-extension://<your-extension-id>/saved.html`
- The report is grouped by day with daily tab counts.

## Notes
- Data is stored in `chrome.storage.local`.
- Existing tabs are tracked from the time the extension starts.
- Only `http` and `https` tabs are tracked.
