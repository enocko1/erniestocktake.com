# Ernievero Stock App — setup & deployment guide

## What this version does
The app is now a **stock-taking system**: the admin uploads the expected stock (the `SYSTEM`
column of the Excel sheet), every counter enters what they physically count, and the app shows the
difference instantly.

| Formula | Meaning |
|---|---|
| **Variance = Counted − Expected** | `+` overcount (orange), `0` correct (green), `−` undercount (red) |
| **Remaining = Expected − Counted** | units still unaccounted for (shown separately, clearly labelled) |

A product nobody has counted is **"Not counted"** (grey) — never treated as a confirmed zero.
Typing `0` records a real zero count (which is then an undercount if stock was expected).

### Files (upload ALL of them to the same folder)
| File | Purpose |
|---|---|
| `index.html` | Counter app (same look, colours, dark mode, mobile layout as before) |
| `admin.html` | Admin dashboard (separate page, password login) |
| `stock-utils.js` | **New.** Shared formulas, Excel/CSV parsing and report logic used by both pages |
| `firebase-config.js` | Your Firebase config — **unchanged** |
| `firestore.rules` | Security rules — **updated, must be re-published** (step 2) |

### Data layout in Firestore
* `masterStock/current` — the product list `{items:[{id,name,expected}], count, fileName, updatedAt…}`.
  Written as **one document**, so an import is all-or-nothing: if anything fails, the old list stays.
* `users/{uid}/entries/{productId}` — one counter's count for one product (their private data).
* `users/{uid}` — the counter's display name (what the admin sees).

A product's id is derived from its name, so counts stay attached to the right product when the
admin re-uploads an updated list.

---

## 1. One-time Firebase setup (skip what you already did)
1. Firebase console → **Authentication → Sign-in method**: enable **Anonymous** and **Email/Password**.
2. **Authentication → Users**: the one admin account already exists
   (`admin@ernievero-stock.local`, UID `RcQgwLcHVZTGxW6U9zK3F0bcY872`). Use a **strong password**.
3. **Authentication → Settings → User actions**: untick **"Enable create (sign-up)"** if you see it.
   This stops strangers creating extra email/password accounts with your public API key.
4. **Authentication → Settings → Authorized domains**: add your GitHub Pages domain (`yourname.github.io`).
5. **Firestore Database** must exist in **Production mode**.

## 2. Deploy the new security rules (REQUIRED)
The old rules reject the new data shapes, so the app will show "permission denied" until you do this.
1. Firebase console → **Firestore Database → Rules**.
2. Replace everything with the contents of `firestore.rules` from this folder. The admin UID in it is
   already your real one — don't change it.
3. Click **Publish**.
4. (Optional, CLI) `firebase deploy --only firestore:rules` if you use the Firebase CLI.

## 3. Deploy the pages
Copy `index.html`, `admin.html`, `stock-utils.js`, `firebase-config.js` into your GitHub Pages repo (same
folder), commit and push. After a minute, hard-refresh (Ctrl+Shift+R / clear site data on phones) so the
browsers drop the old cached files.

## 4. First run
1. Open `…/admin.html`, log in, go to **Master data**, choose `OCT 2026 STOCKS1.xlsx`, press
   **Check file & preview**.
2. Check the preview (header found on row 3; ITEM DETAILS = column B, SYSTEM = column C; 1,409 products).
   Press **Import**. If the file has errors (duplicates, missing names, bad numbers) the import is
   blocked and the current data is left untouched.
3. Counters open `…/index.html`, enter their name once, and start counting.

> **Heads-up about your file:** 5 products have a **negative SYSTEM quantity**
> (A3 Forever Bright Lot 12 = −12, EFFIMAX BATH 500ML 24 = −240, Mega Growth Kit 4 = −8,
> Victoria World Spray L/s 96 = −1, Zafaran Body Lotion 250ml 36 = −180). They are shown as
> warnings and imported as-is — fix them in the sheet first if they are errors. The sheet's
> TOTAL and DIFF columns are ignored, as requested.

---

## How counters use it
* The list **is** the master list. Search by name; filter by *Not counted / Correct / Overcount / Undercount*.
* **Quick count:** type the physical total in the *Counted* box, press **Enter** (moves to the next product).
  Variance, remaining and status update while typing.
* **Cartons / pieces:** tap ✎ to count as *Items × Cartons + Pieces* (sums like `50+6+8` work).
* 🗑 clears one count (back to *Not counted*). Menu → *Clear All My Counts* clears everything (double confirmation).
* The top-right badge shows **✓ All saved** only once the server has confirmed. If a save fails, a red
  banner names the product — it is never shown as saved when it was not.
* Menu → export your report to CSV / Excel / PDF, or **Import my counts** from a CSV/Excel
  (e.g. a file you exported earlier and edited).

## How the admin uses it
* **Overview** – products, counted / not counted, total expected, total counted, overcount, shortage,
  net variance, users who submitted, products where users disagree. Export the overall Excel report
  (sheets: Summary, Products, Counts by user, Not counted, Users) or the product-by-product CSV.
* **Products** – every product with expected, count, variance, status and each user's count; search/filter.
* **Users** – per-user totals and *last saved* time; **View report**, **Excel** export, **Delete entries**.
  *Reset ALL users' entries* requires typing `RESET`.
* **Master data** – upload / replace with preview, or delete.

### Several users counting the same product (no double counting)
Counts are **never added together** across users. Each user's variance is always computed from their
own count (Users tab / "Counts by user" sheet). For the overall figures the admin picks **one** count
per product: the *most recent* (default), *highest*, or *lowest* — or views a single user. Products
where users' counts differ are flagged "⚠ counts differ".

---

## Security: where it is actually enforced
Hiding buttons is **not** the protection. `firestore.rules` is checked by Google's servers on every request:
* Only the admin UID can write/replace/delete `masterStock`.
* A counter can read/write **only** `users/{their own uid}/…`; each entry is type-checked
  (numbers ≥ 0, id = product id, uid = writer). Negative or malformed counts are rejected server-side.
* Only the admin can read other users' entries (collection-group query) or list users.
* Everything else is denied.

### Test the rules (Firebase console → Firestore → Rules → Rules Playground)
| Simulate | Expected |
|---|---|
| Authenticated (non-admin uid `abc`) **get** `/users/xyz/entries/anything` | ❌ Denied |
| Authenticated `abc` **get** `/users/abc/entries/anything` | ✅ Allowed |
| Authenticated `abc` **set** `/masterStock/current` | ❌ Denied |
| Authenticated `abc` **set** `/users/abc/entries/p1` with `numItems:-1` | ❌ Denied |
| Authenticated `RcQgwLcHVZTGxW6U9zK3F0bcY872` **set** `/masterStock/current` | ✅ Allowed |
| Admin **get** `/users/xyz/entries/anything` | ✅ Allowed |

Also try two browsers (one private window): each must see only its own counts.

## Known limits
* **Counters are anonymous** (as before): identity lives in that browser. Clearing site data or using
  another device creates a *new* user and the earlier counts stay under the old identity (the admin
  would see two entries with the same name). Counters should keep using the same browser. A login
  (email link / Google) could be added later if cross-device identity is needed.
* **Master list is one document** (1 MiB limit) — fine for ~10,000 products; the importer warns if exceeded.
* **Same-browser admin use:** logging in as admin replaces that browser's anonymous counter identity; use
  a different browser/device for admin work.
* Counts saved by the *previous* version of the app are carried over automatically (matched by product
  name) the first time that browser opens the new app; empty placeholder rows are dropped.
* A master list uploaded by the *previous* version has no SYSTEM data in the new format —
  re-upload the Excel file once.
* Removed on purpose: the "+ Add item" button and "Import all from master" (counts must belong to a
  master product to be compared; free-text items could not be). Per-user "Import CSV/Excel" now imports
  *counts* matched to master products.
