import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD4rIgujWeacr6LTjJTa1Y6kA1ybQVpymE",
  authDomain: "mfy-monitoring.firebaseapp.com",
  projectId: "mfy-monitoring",
  storageBucket: "mfy-monitoring.firebasestorage.app",
  messagingSenderId: "448425026238",
  appId: "1:448425026238:web:d4f9230c3cac284f9f34ef"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Yangi yozuv qo'shish
export const addRecord = async (record) => {
  // Rasmlarni saqlamaymiz (juda katta) — URL o'rniga null
  const { facePhoto, passportPhoto, ...rest } = record;
  await addDoc(collection(db, "records"), rest);
};

// Real-time o'qish
export const listenRecords = (callback) => {
  const q = query(collection(db, "records"), orderBy("timestamp", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
};
