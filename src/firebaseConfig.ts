import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, User as FirebaseUser } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyA5_3BXFLpLoqWrXDLwqwbLt4C978fQlK0",
  authDomain: "atpukur-guys.firebaseapp.com",
  projectId: "atpukur-guys",
  storageBucket: "atpukur-guys.firebasestorage.app",
  messagingSenderId: "12877971938",
  appId: "1:12877971938:web:0f3b42d6f6387ab62eb9bb"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, signOut };
export type { FirebaseUser };
