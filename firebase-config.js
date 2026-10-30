/**
 * LIFE-OS cloud keys — yeh TERE Firebase project ke hain.
 *
 * 1) https://console.firebase.google.com pe project banao (naam: life-os)
 * 2) Authentication → Sign-in method → Google ON
 * 3) Firestore Database → Create (production mode) → rules file se paste
 * 4) Project settings → Your apps → Web app → config copy
 * 5) Neeche paste karo aur enabled: true
 *
 * Authorized domains mein add karo: localhost, tera Vercel domain
 */
window.LIFEOS_FIREBASE = {
  enabled: false,
  config: {
    apiKey: 'PASTE_API_KEY',
    authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
    projectId: 'PASTE_PROJECT_ID',
    storageBucket: 'PASTE_PROJECT_ID.appspot.com',
    messagingSenderId: 'PASTE_SENDER_ID',
    appId: 'PASTE_APP_ID'
  }
};
