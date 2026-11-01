# Money Book: Firebase edition (web app + Android APK)

This is the same Money Book app (Home, Ledger, Dues, Purchases, Namaz, Charge, Profile, Import/Export, Statements, Pivots), but it syncs through **Google Firebase** instead of the Google Sheet:

* **Offline first:** every entry is saved on the device straight away. Changes queue while offline and upload when the connection returns.
* **Firebase Authentication:** sign in with email and password (works on the web and in the APK), or with Google (web only).
* **Cloud Firestore:** stores your data under `users/{your uid}/…`. Security rules let only you read or write it.
* **Live sync:** an entry added on your phone appears on your laptop within about 2 seconds, without reloading.
* **Android APK:** Capacitor wraps the same app; exports open the Android share sheet.

```
public/                 the web app (deployed to Firebase Hosting, and copied into the APK)
  firebase-config.js    ← paste your Firebase config here (or paste it inside the app)
  firebase-sync.js      Firebase SDK + sync layer, bundled from src/firebase-entry.js (no CDN needed)
src/firebase-entry.js   source of the sync layer
firestore.rules         security rules: each user only sees their own data
firebase.json           Hosting + Firestore + local emulator settings
android/                Android Studio project (Capacitor)
.github/workflows/      builds the APK on GitHub for you
```

## 1. Create the Firebase project (about 5 minutes)
1. Go to https://console.firebase.google.com and click **Add project**. Give it a name, e.g. `money-book`; Analytics is optional.
2. **Build → Authentication → Get started → Sign-in method.** Enable **Email/Password**. Optionally enable **Google**, which works on the web only.
3. **Build → Firestore Database → Create database.** Pick a location near you (e.g. `asia-south1`) and start in **production mode**.
4. **Project settings (⚙) → Your apps → Web (`</>`).** Register an app and copy the `firebaseConfig` block.
5. Paste that block into `public/firebase-config.js`:
   ```js
   window.FIREBASE_CONFIG = { apiKey: "…", authDomain: "…", projectId: "…", storageBucket: "…", messagingSenderId: "…", appId: "…" };
   ```
   Or leave the file as is and paste the config inside the app under **More → Cloud sync**.

## 2. Publish the security rules and the web app
```bash
npm install
npx firebase login
npx firebase use --add          # choose your project
npm run deploy                  # bundles Firebase, deploys Hosting + firestore.rules
```
The app is then live at `https://<project-id>.web.app`. Open it on any device. Then:
1. Go to **More → Cloud sync** and choose **Create account** (first time) or **Sign in**.
2. Tap **Add to Home screen** to install it like an app.

If you only want the rules, run `npx firebase deploy --only firestore:rules`, or paste `firestore.rules` into the console under **Firestore → Rules → Publish**.

## 3. Get the Android APK
I could not build the APK in my environment (its network blocks Google's Android SDK downloads). Pick whichever option suits you.

**Option A: GitHub builds it for you (no installs)**
1. Create a GitHub repository and push this folder to it (with your `firebase-config.js` filled in, or leave it empty and paste the config in the app).
2. Open **Actions → Build Android APK**. It runs on every push, or tap **Run workflow**.
3. After about 5 minutes, open the run and download **Artifacts → money-book-apk**. Unzip it to get `app-debug.apk`.
4. Copy the APK to your phone and open it. Allow **Install unknown apps** for your browser or file manager.

**Option B: Android Studio**
```bash
npm install
npm run android:sync     # bundles Firebase and copies public/ into android/
npm run android:open     # opens Android Studio
```
In Android Studio, choose **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.

**Option C: command line (needs JDK 21 + Android SDK)**
```bash
npm install
npm run apk:debug        # → android/app/build/outputs/apk/debug/app-debug.apk
```

**A signed release APK (for the Play Store or for sharing)**
1. Create a keystore once:
   ```bash
   keytool -genkey -v -keystore release.keystore -alias moneybook -keyalg RSA -keysize 2048 -validity 10000
   ```
2. **For GitHub Actions:** add these repository secrets:
   * `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w0 release.keystore`)
   * `ANDROID_KEYSTORE_PASSWORD`
   * `ANDROID_KEY_ALIAS` (`moneybook`)
   * `ANDROID_KEY_PASSWORD`

   The workflow then also builds `app-release.apk`.
3. **Locally:** use **Build → Generate Signed Bundle / APK** in Android Studio.

**APK notes**
* Inside the APK, sign in with **email and password**. Google blocks its sign-in popup inside app WebViews, so the Google button is hidden there.
* The APK contains the web app, so it opens and works offline. Firebase only needs the internet for syncing.
* Excel, CSV and JSON exports open the Android **share sheet**, so you can save the file to Files or Drive or send it on WhatsApp.
* After you change anything in `public/`, run `npm run android:sync` again before building.

## How sync works
1. Every save goes to the device first, marked as *pending*. The badge at the top right shows `Offline · 3`, `2 pending` or `Synced`.
2. When online and signed in, the app first **downloads and merges** any newer cloud data (the newest edit of a record wins). Then it uploads its pending records in batches.
3. A live Firestore listener brings other devices' changes in straight away.
4. **First sign-in on a device that already has data:** that data is uploaded to your account. Blank default accounts are never uploaded, so they can't overwrite your real opening balances.
5. **Signing in to a different account** replaces this device's data with that account's data.

Firestore layout: `users/{uid}/{Accounts|Ledger|Dues|Purchases|Namaz|Profile}/{recordId}`, plus a server `syncedAt` timestamp on every document. A Firestore free-tier (Spark) project easily covers personal use.

## Test locally with the Firebase emulators (no real project needed)
```bash
npm install
npx firebase emulators:start --only auth,firestore,hosting --project demo-moneybook
```
Open http://127.0.0.1:5000 and go to **More → Cloud sync**. Paste:
```
{ "apiKey": "demo-key", "projectId": "demo-moneybook", "authDomain": "demo-moneybook.firebaseapp.com", "appId": "1:1:web:1", "emulator": "127.0.0.1" }
```
Then create any account.

## What was tested (against the Firebase Auth + Firestore emulators)
| Check | Result |
|---|---|
| Create account → this device's October data uploaded | 100 ledger docs in Firestore, total ৳1,305.39 |
| Wrong password | "Wrong email or password" |
| Second device signs in | Same 100 entries and same total (৳1,305.39) |
| Live update from device A to device B | Arrived in about 1.6 s, no reload |
| Device B offline → adds entry → back online | Uploaded and appeared on A; both totals ৳1,762.39 |
| Profile change | Synced to the other device |
| Security rules | Another user reading your data → **403**; own data → 200; unknown collection → 403 |
| Sign in as another account | Device shows only that account's data |
