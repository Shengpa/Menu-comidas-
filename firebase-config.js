// Credenciales de tu proyecto Firebase ("plan-de-comidas-da5c9").
const firebaseConfig = {
  apiKey: "AIzaSyAOG_mYMROu5-P3IHWuwi-pW-chK4b_F68",
  authDomain: "plan-de-comidas-da5c9.firebaseapp.com",
  projectId: "plan-de-comidas-da5c9",
  storageBucket: "plan-de-comidas-da5c9.firebasestorage.app",
  messagingSenderId: "127053741615",
  appId: "1:127053741615:web:68acffc61c8eda4b6890da",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
