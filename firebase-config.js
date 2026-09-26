/* firebase-config.js
   -------------------------------------------------------------
   Fill this in with YOUR Firebase project's values.
   Firebase console → Project settings (gear icon) → General →
   "Your apps" → Web app → SDK setup and configuration → Config.

   These values are NOT secret — they identify your project to
   Google's servers, the same way a URL does. The actual security
   boundary is the Firestore rules (firestore.rules) and Firebase
   Authentication, not this file. It is safe to publish this file
   on GitHub Pages.
   ------------------------------------------------------------- */
export const firebaseConfig = {
  apiKey: "AIzaSyBEW2T1at86MXPWBeucyc7shV2izwoXFxQ",
  authDomain: "ernievero-stock.firebaseapp.com",
  projectId: "ernievero-stock",
  storageBucket: "ernievero-stock.firebasestorage.app",
  messagingSenderId: "389196424709",
  appId: "1:389196424709:web:adaae7237406f7d86e9e6c"
};

/* The email of the ONE admin account you create by hand in
   Firebase Authentication → Sign-in method → Email/Password.
   The admin never sees or types this email — the Admin Login
   page only asks for the password, and uses this constant behind
   the scenes to know which account to sign in. */
export const ADMIN_EMAIL = "admin@ernievero-stock.local";
