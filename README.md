# Household Budget Planner

A small, installable web app for planning a monthly household budget:

- Split take-home pay into **necessities**, **savings**, and **variable** spending.
- Add the **people** in your household and their **accounts** (shared or personal, spending or savings); say whose pay each income is and where it lands.
- See the **payday transfer plan**: how much to move from the account each paycheck lands in to your other accounts. Pooled pay gets one list; separate pay gets one per person, with shared costs split by a rule you pick.
- Track **savings goals** (for example, an emergency fund of N months of necessities) and when you'll reach them.
- Compare **scenarios** side by side (for example, now vs. after a new job or a move); add, copy or delete them as your plans change.
- Group items into your **Honeydue categories** and copy the monthly limit for each one.
- Do a **monthly check-in**: type each category's actual total from Honeydue and your savings balances,
  and see what ran over or under and whether each goal is on track (goals can have a "by" date).
- Handle **yearly costs**: set the month each one is paid, set aside a twelfth each payday, and see a
  12-month calendar that warns if a bill would come before the money is there.
- Take the **tour** (the Tour button) for a step-by-step explanation of each part.

## Privacy

This repository contains only the app's code and a set of **example numbers**.
Your real budget is stored in your browser on each device and in plan files you export.
Nothing is sent to a server.

## Install

Open the site, then:

- **iPhone/iPad (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** menu → *Install app* / *Add to Home screen*.
- **Mac/Windows (Chrome or Edge):** the install icon in the address bar. **Mac (Safari 17+):** File → *Add to Dock*.

Installed copies work offline. On iPhone, keep it installed to the home screen: Safari can clear website storage
for sites you haven't visited in a while, but home-screen apps are exempt. Exporting a plan file now and then is a good backup either way.

## Sharing between devices and people

There is no server, so devices sync through a **plan file**:

1. Keep one plan file in a folder you both use (iCloud Drive, Google Drive), or send it by message.
2. After changing the plan, tap **Export plan file** and replace the old file.
3. On another device, tap **Import plan file**.

Importing replaces the plan on that device, so only one person should edit at a time.

## Files

- `index.html`: the whole app (HTML, CSS, JavaScript; no build step, no dependencies)
- `manifest.webmanifest`, `icons/`: app name and icons for installing
- `sw.js`: service worker for offline use
- `tests/smoke.js`: automated check of loading, export/import, offline use and phone layout
  (`node tests/smoke.js`; needs Playwright, see the top of the file)
