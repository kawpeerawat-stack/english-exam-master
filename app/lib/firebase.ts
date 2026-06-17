import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: "AIzaSyBc9vwV3bvHzOwzlwjtOTsE1Ce7fHEktm8",
  authDomain: "smart-vocab-master.firebaseapp.com",
  projectId: "smart-vocab-master",
  storageBucket: "smart-vocab-master.firebasestorage.app",
  messagingSenderId: "225185933112",
  appId: "1:225185933112:web:16d0d75359279ec44a83cd"
};

// reCAPTCHA v3 site key — เป็น "คีย์สาธารณะ" ใส่ในโค้ดได้
const RECAPTCHA_SITE_KEY = "6Lf5ciQtAAAAAKa75OcaW0Fr5CXPVIdFgwsfKpGU";

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

if (typeof window !== "undefined" && RECAPTCHA_SITE_KEY) {
  if (process.env.NODE_ENV === "development") {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.error("App Check init error:", e);
  }
}

export const auth = typeof window !== "undefined" ? getAuth(app) : null as any;
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
