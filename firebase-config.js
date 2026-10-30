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
  enabled: true,
  config: {
    apiKey: 'AIzaSyB44gFxDLrmM33OMbmwGqvtyQOXv5C-ye8',
    authDomain: 'fir-d6d80.firebaseapp.com',
    projectId: 'fir-d6d80',
    storageBucket: 'fir-d6d80.firebasestorage.app',
    messagingSenderId: '549762021449',
    appId: '1:549762021449:web:78434cf065a04f27146798',
    measurementId: 'G-GBWF3T8RLE'
  }
};
