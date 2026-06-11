import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { createAsyncStorage } from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyDm5zsdmw5KY_Em6i8BoNA4AZWOCLeCSdk",
  authDomain: "beyxtournament.firebaseapp.com",
  projectId: "beyxtournament",
  storageBucket: "beyxtournament.firebasestorage.app",
  messagingSenderId: "557197275610",
  appId: "1:557197275610:web:a94d0a77a8f6aeef3c50e3",
};

const app = initializeApp(firebaseConfig);

const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(createAsyncStorage("app")),
});

const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, googleProvider, db, storage };

