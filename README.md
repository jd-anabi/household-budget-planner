# Household Budget Planner

A small, installable web app for planning a monthly household budget:

- Split take-home pay into **necessities**, **savings**, and **variable** spending.
- See the **payday transfer plan**: how much to move from the account your paychecks land in to joint checking, joint savings, personal savings, and investing.
- Track **savings goals** (for example, an emergency fund of N months of necessities) and when you'll reach them.
- Compare **scenarios** side by side (for example, "now" vs. "both working + rent").
- Copy a list of monthly **category limits** to enter into a tracking app such as Honeydue.

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
