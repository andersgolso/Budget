# Budget app setup (about 15 minutes, once)

## 1. Turn on Chase text alerts
Chase app > profile icon > Alerts & messages > Manage alerts. For each card and checking account, turn on transaction alerts for every purchase (set the threshold to $0.01) and send them by **text**. Turn on direct deposit alerts too so income shows up.

When the first alert arrives, save that number as a contact named **Chase Alerts**.

## 2. Put the app online (GitHub Pages, free)
1. github.com > New repository > name it `budget` > Public > Create.
2. Add file > Upload files > upload these 7 files: `index.html`, `app.js`, `parser.js`, `sw.js`, `manifest.webmanifest`, `icon-180.png`, `icon-512.png`. Commit.
3. Settings > Pages > Source: Deploy from a branch > `main` / `(root)` > Save.
4. After a minute it's live at `https://YOUR-USERNAME.github.io/budget/`.

The repo only holds the app code. Your transactions never leave your phone.

## 3. Add it to your home screen
Open that URL in **Safari** > Share > Add to Home Screen. Open it once from the home screen while online; after that it works with no signal.

## 4. Shortcut that logs every Chase text
Shortcuts app > Automation > New Automation > **Message**
- Sender: **Chase Alerts**
- Choose **Run Immediately** (turn off Notify When Run) > Next > New Blank Automation

Add two actions:
1. **Text**: type `@@`, insert the **Current Date** variable, type `|`, insert **Shortcut Input**.
   No spaces between them. Example result: `@@Oct 25, 2026 at 10:20 AM|Chase Freedom: You made a $71.30...`
2. **Append to Text File**: text = the Text from step 1, file = `budget-log.txt` in the **Shortcuts** folder, turn on **Make New Line**.

The first time it runs, iOS may ask for permission to write the file. Allow it.

## 5. Daily use
- Open Budget > **Sync** > pick `budget-log.txt` (it'll be under Recents). Syncing the same file again only adds new entries.
- First time: go to **Budgets** and set your real monthly numbers.
- When something lands in Uncategorized, tap it, pick a category, leave "Always put ... in" checked. That merchant is sorted automatically from then on.
- Cash or Venmo: tap **+**.
- Older history: chase.com > account > Download account activity (CSV) > Budgets > Import Chase CSV. Duplicates of texts you already synced are skipped.
- Export a backup from Budgets once a month. Deleting the home screen icon deletes the data.

## Updating the app later
Replace the changed files in the GitHub repo and change `budget-v1` to `budget-v2` in `sw.js`. The phone picks it up the next time it opens online.
