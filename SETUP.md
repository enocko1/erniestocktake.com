# Ernievero Stock App — Firebase setup guide

## What changed
- `index.html` — your original app, same design/layout/features. Data now lives in
  Firestore instead of localStorage, scoped to an anonymous Firebase UID per browser.
  Added one read-only menu item: **View Master Stock List**.
- `admin.html` — new, separate admin page. Not linked from `index.html` anywhere;
  you (or your admin) reach it by typing the URL directly.
- `firebase-config.js` — shared config both pages import. **You must fill this in.**
- `firestore.rules` — the actual security boundary (see "Where security really lives" below).

No existing markup, styling, calculations, or the add/edit/delete/import/export
workflow were changed — only how data is stored.

---

## 1. Create a Firebase project
1. Go to https://console.firebase.google.com → **Add project** → follow the prompts
   (Google Analytics is optional, you don't need it).
2. Once created, click the **Web** icon (`</>`) to register a web app. Give it any
   nickname. You do **not** need Firebase Hosting — you're deploying to GitHub Pages.
3. Firebase shows you a `firebaseConfig` object. Copy those values into
   `firebase-config.js` (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`).

## 2. Enable Authentication
In the Firebase console → **Build → Authentication → Sign-in method**, enable:
- **Anonymous** — this is what lets normal users use the app with no login.
- **Email/Password** — this is how the admin logs in.

Then, still in Authentication, go to the **Users** tab → **Add user** and create
the one admin account:
- Email: anything, e.g. `admin@ernievero-stock.local` (it doesn't need to be real —
  Firebase doesn't send mail to it for password sign-in). Use exactly this value,
  or your own choice, as `ADMIN_EMAIL` in `firebase-config.js`.
- Password: choose a strong password. **This is the password the admin types on
  the Admin Login page.**

After creating the user, click into it and copy its **User UID** — you'll need it
in the next step.

## 3. Set up Firestore
1. Firebase console → **Build → Firestore Database → Create database**.
2. Choose **Production mode** (not test mode) and pick a region close to your users.
3. Go to the **Rules** tab, delete the default contents, and paste in the contents
   of `firestore.rules` from this project — but first replace `ADMIN_UID_HERE`
   with the actual UID you copied in step 2. Click **Publish**.

That's the entire database setup — no manual collections need to be created;
Firestore creates `masterStock/current` and `users/{uid}/entries/*` automatically
the first time each is written.

## 4. Authorize your GitHub Pages domain
Firebase only allows sign-in from domains you've approved.
Firebase console → **Authentication → Settings → Authorized domains → Add domain**,
and add your GitHub Pages domain, e.g. `yourusername.github.io`.

## 5. Deploy to GitHub Pages
1. Fill in `firebase-config.js` (steps 1–2 above) before pushing — don't leave the
   placeholder values in.
2. Push `index.html`, `admin.html`, and `firebase-config.js` to your repository
   (same folder, so the relative `./firebase-config.js` import works).
3. Repo → **Settings → Pages** → Source: deploy from the branch/folder containing
   these files (e.g. `main` / `/root`). Save.
4. Wait a minute for GitHub to build, then visit the published URL. Normal users
   land on `index.html`. The admin visits `https://yourusername.github.io/yourrepo/admin.html`.

---

## Where the admin password is stored and how it's secured
The password is **never stored in your code or on GitHub Pages at all.** When you
created the admin account in step 2, Firebase Authentication stored a salted hash
of the password on Google's servers — the same system every Firebase app uses.
The Admin Login page just sends the typed password to Firebase's sign-in endpoint
over HTTPS; Firebase checks it and returns a signed credential (a UID) if correct.
Your code never sees or stores the password itself, before or after login.

The actual access control isn't "does the admin page hide its buttons" — it's the
line in `firestore.rules`: `request.auth.uid == "ADMIN_UID_HERE"`. That's checked
by Firestore's servers on every write, regardless of what the browser sends, so a
normal user cannot write to `masterStock` even if they opened dev tools and called
the Firestore API directly.

## Where security really lives
Three things work together:
- **Anonymous Authentication** gives every normal user a real Firebase UID —
  not something invented client-side or stored only in localStorage.
- **Firestore rules** (`firestore.rules`) enforce, on Google's servers, that a
  UID can only read/write its own `users/{uid}/entries/*`, and that only the
  admin's UID can write `masterStock`.
- The admin/normal-user **pages** are just UI — `admin.html` isn't linked from
  the app, but that's convenience, not the security boundary. The rules are.

## Testing that User A can't see User B's entries
1. Open your published `index.html` in one browser (e.g. Chrome).
2. Open it again in a **different browser, or an incognito/private window** —
   using the same browser tab won't create a second identity, since Firebase
   persists the anonymous session for that browser.
3. Add a few different stock entries in each window.
4. Confirm each window only ever shows its own entries — never the other's,
   even after refreshing.
5. To confirm this is enforced server-side (not just a coincidence of the UI):
   open browser dev tools console on window A, and try:
   ```js
   // paste a real UID copied from window B's Firebase Auth (e.g. via
   // Firebase console → Authentication → Users) in place of OTHER_UID
   import("./firebase-config.js").then(async ({firebaseConfig}) => {
     const {initializeApp} = await import("https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js");
     const {getFirestore, collection, getDocs} = await import("https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js");
     const db = getFirestore(initializeApp(firebaseConfig, "test"));
     try {
       const snap = await getDocs(collection(db, "users", "OTHER_UID", "entries"));
       console.log("got", snap.size, "docs — THIS WOULD BE A PROBLEM");
     } catch (e) {
       console.log("blocked as expected:", e.code); // should be 'permission-denied'
     }
   });
   ```
   You should see `permission-denied`, not the other user's data.
6. You can also use the Firebase console's **Firestore → Rules → Rules
   Playground** to simulate a read of `users/OTHER_UID/entries/anything` as a
   different authenticated UID, and confirm it's denied.

## Known limits worth knowing about
- **Master data size**: the whole uploaded table is stored as one Firestore
  document (1 MiB limit). Fine for typical stock lists (thousands of short
  rows); if you ever need a much larger master list, it would need to move to
  a subcollection instead of a single document.
- **Bulk import/clear-all size**: entries are written in a single Firestore
  batch, which caps at 500 operations. Importing or clearing more than ~500
  rows at once would need to be split into multiple batches — say if this
  comes up and it can be added.
- **Same-device admin use**: if the admin logs in on the *same browser* a
  normal user has been using, the browser's anonymous session is replaced by
  the admin's session while logged in. Logging out returns to a fresh
  anonymous identity (a new UID), losing continuity with that browser's
  earlier entries. Simplest fix: use a separate browser/device for admin
  work, which is the normal setup anyway.
