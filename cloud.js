/**
 * LIFE-OS cloud layer
 * Google Auth + Firestore sync. Local storage remains the fast cache.
 *
 * Cloud map (Firebase console → Firestore):
 *   accounts/{googleUid}/workspace
 *   accounts/{googleUid}/profiles/{localUserId}
 *   accounts/{googleUid}/profiles/{localUserId}/days/{YYYY-MM-DD}
 */
(function () {
  'use strict';

  const QUEUE_KEY = 'lifeos_cloud_queue';
  const PROFILE_DEBOUNCE_MS = 700;
  const DAY_DEBOUNCE_MS = 400;

  const cloud = {
    ready: false,
    applying: false,
    app: null,
    auth: null,
    db: null,
    user: null,
    unsubscribers: [],
    profileTimers: {},
    dayTimers: {},
    lastStatus: 'Cloud idle'
  };

  function cfg() {
    return window.LIFEOS_FIREBASE || {};
  }

  function isConfigured() {
    const box = cfg();
    if (!box.enabled) return false;
    const c = box.config || {};
    return !!(c.apiKey && c.projectId && c.appId && !String(c.apiKey).startsWith('PASTE_'));
  }

  function setStatus(text) {
    cloud.lastStatus = text;
    const el = document.getElementById('cloudSyncStatus');
    if (el) el.textContent = text;
    updateChip();
  }

  function updateChip() {
    const btn = document.getElementById('btnCloudAccount');
    if (!btn) return;
    if (!isConfigured()) {
      btn.textContent = 'CLOUD SETUP';
      btn.title = 'Firebase keys pending';
      return;
    }
    if (cloud.user) {
      const shortName = (cloud.user.displayName || cloud.user.email || 'Signed in').split(' ')[0];
      btn.textContent = shortName.toUpperCase();
      btn.title = cloud.user.email || 'Signed in';
      return;
    }
    btn.textContent = 'SIGN IN';
    btn.title = 'Sign in with Google to sync phone and laptop';
  }

  function renderCloudTab() {
    const signed = document.getElementById('cloudSignedAs');
    const setup = document.getElementById('cloudSetupBox');
    const session = document.getElementById('cloudSessionBox');
    if (setup) setup.classList.toggle('hidden', isConfigured());
    if (session) session.classList.toggle('hidden', !isConfigured());
    if (signed) {
      signed.textContent = cloud.user
        ? (cloud.user.email + '  ·  uid ' + cloud.user.uid)
        : (isConfigured() ? 'Not signed in — phone/laptop sync off' : 'Firebase keys not pasted yet');
    }
    const photo = document.getElementById('cloudPhoto');
    if (photo) {
      if (cloud.user && cloud.user.photoURL) {
        photo.src = cloud.user.photoURL;
        photo.classList.remove('hidden');
      } else {
        photo.classList.add('hidden');
      }
    }
    const loginBtn = document.getElementById('btnGoogleSignIn');
    const outBtn = document.getElementById('btnGoogleSignOut');
    const syncBtn = document.getElementById('btnCloudSyncNow');
    if (loginBtn) loginBtn.classList.toggle('hidden', !!cloud.user);
    if (outBtn) outBtn.classList.toggle('hidden', !cloud.user);
    if (syncBtn) syncBtn.classList.toggle('hidden', !cloud.user);
    setStatus(cloud.lastStatus);
    updateChip();
  }

  function showAuthOverlay(show) {
    const overlay = document.getElementById('cloudAuthOverlay');
    if (!overlay) return;
    overlay.classList.toggle('hidden', !show);
  }

  function jsonClone(value) {
    if (value == null) return null;
    return JSON.parse(JSON.stringify(value));
  }

  function stripUndefined(value) {
    return JSON.parse(JSON.stringify(value, (_k, v) => v === undefined ? null : v));
  }

  function accountPath() {
    return 'accounts/' + cloud.user.uid;
  }

  function workspaceRef() {
    return cloud.db.doc(accountPath() + '/workspace/state');
  }

  function profileRef(profileId) {
    return cloud.db.doc(accountPath() + '/profiles/' + profileId);
  }

  function dayRef(profileId, dayKey) {
    return cloud.db.doc(accountPath() + '/profiles/' + profileId + '/days/' + dayKey);
  }

  function daysCol(profileId) {
    return cloud.db.collection(accountPath() + '/profiles/' + profileId + '/days');
  }

  function stopListeners() {
    cloud.unsubscribers.forEach((fn) => {
      try { fn(); } catch (_) { /* ignore */ }
    });
    cloud.unsubscribers = [];
  }

  async function ensureFirebase() {
    if (cloud.ready) return true;
    if (!isConfigured()) {
      setStatus('Cloud off — paste Firebase keys in firebase-config.js');
      renderCloudTab();
      return false;
    }
    if (!window.firebase) {
      setStatus('Firebase SDK missing');
      return false;
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(cfg().config);
    }
    cloud.auth = firebase.auth();
    cloud.db = firebase.firestore();
    try {
      await cloud.db.enablePersistence({ synchronizeTabs: true });
    } catch (_) { /* already enabled or unsupported */ }
    cloud.ready = true;
    return true;
  }

  async function pullAndMerge() {
    if (!cloud.user || !cloud.app) return;
    cloud.applying = true;
    setStatus('Syncing from Google account…');
    try {
      const snap = await workspaceRef().get();
      if (!snap.exists) {
        await pushEverything('First upload from this device');
        return;
      }
      const remoteDays = {};
      const users = snap.data().users || [];
      for (const user of users) {
        const profileSnap = await profileRef(user.id).get();
        const daySnaps = await daysCol(user.id).get();
        const days = {};
        daySnaps.forEach((doc) => { days[doc.id] = doc.data(); });
        remoteDays[user.id] = {
          profile: profileSnap.exists ? profileSnap.data() : null,
          days
        };
      }
      cloud.app.applyRemoteSnapshot({
        workspace: snap.data(),
        profiles: remoteDays
      });
      // Sign-in can happen after this device has accumulated offline/local logs.
      // Push the app-level union back so those logs reach every other device.
      await pushEverything('Merged local and cloud data');
      setStatus('Synced · ' + new Date().toLocaleTimeString());
    } catch (error) {
      console.warn('[LIFE-OS cloud] pull failed', error);
      setStatus('Sync failed: ' + (error.message || 'network'));
    } finally {
      cloud.applying = false;
    }
  }

  async function pushEverything(reason) {
    if (!cloud.user || !cloud.app) return;
    const shot = cloud.app.collectSnapshot();
    let batch = cloud.db.batch();
    let writes = 0;
    const commitIfFull = async () => {
      if (writes < 400) return;
      await batch.commit();
      batch = cloud.db.batch();
      writes = 0;
    };
    batch.set(workspaceRef(), stripUndefined({
      users: shot.workspace.users,
      activeUserId: shot.workspace.activeUserId,
      updatedAt: Date.now(),
      email: cloud.user.email,
      displayName: cloud.user.displayName || '',
      photoURL: cloud.user.photoURL || ''
    }), { merge: true });
    writes++;

    Object.entries(shot.profiles).forEach(([profileId, profile]) => {
      batch.set(profileRef(profileId), stripUndefined({
        name: profile.name,
        prefs: profile.prefs,
        appearance: profile.appearance,
        mappings: profile.mappings,
        schedules: profile.schedules,
        reminderMarks: profile.reminderMarks,
        activeTask: profile.activeTask,
        updatedAt: Date.now()
      }), { merge: true });
      writes++;
    });
    await batch.commit();
    batch = cloud.db.batch();
    writes = 0;
    for (const [profileId, profile] of Object.entries(shot.profiles)) {
      for (const [dayKey, day] of Object.entries(profile.days || {})) {
        batch.set(dayRef(profileId, dayKey), stripUndefined({
          timeline: day.timeline || [],
          taskSwitches: day.taskSwitches || 0,
          updatedAt: Date.now()
        }), { merge: true });
        writes++;
        await commitIfFull();
      }
    }
    if (writes) await batch.commit();
    setStatus((reason || 'Uploaded') + ' · ' + new Date().toLocaleTimeString());
  }

  async function pushProfile(profileIdOverride) {
    if (!cloud.user || !cloud.app || cloud.applying) return;
    const shot = cloud.app.collectSnapshot();
    const profileId = profileIdOverride || shot.workspace.activeUserId;
    const profile = shot.profiles[profileId];
    if (!profile) return;
    await workspaceRef().set(stripUndefined({
      users: shot.workspace.users,
      activeUserId: shot.workspace.activeUserId,
      updatedAt: Date.now()
    }), { merge: true });
    await profileRef(profileId).set(stripUndefined({
      name: profile.name,
      prefs: profile.prefs,
      appearance: profile.appearance,
      mappings: profile.mappings,
      schedules: profile.schedules,
      reminderMarks: profile.reminderMarks,
      activeTask: profile.activeTask,
      updatedAt: Date.now()
    }), { merge: true });
    setStatus('Saved to cloud · ' + new Date().toLocaleTimeString());
  }

  async function pushDay(dayKey, profileIdOverride) {
    if (!cloud.user || !cloud.app || cloud.applying || !dayKey) return;
    const shot = cloud.app.collectSnapshot();
    const profileId = profileIdOverride || shot.workspace.activeUserId;
    const day = (shot.profiles[profileId] && shot.profiles[profileId].days || {})[dayKey];
    if (!day) return;
    await dayRef(profileId, dayKey).set(stripUndefined({
      timeline: day.timeline || [],
      taskSwitches: day.taskSwitches || 0,
      updatedAt: Date.now()
    }), { merge: true });
    await profileRef(profileId).set(stripUndefined({
      activeTask: shot.profiles[profileId].activeTask,
      updatedAt: Date.now()
    }), { merge: true });
  }

  function listen() {
    stopListeners();
    if (!cloud.user || !cloud.app) return;
    const activeId = cloud.app.getActiveUserId();

    cloud.unsubscribers.push(workspaceRef().onSnapshot((doc) => {
      if (!doc.exists || cloud.applying) return;
      const data = doc.data();
      if (data && data.users) cloud.app.applyWorkspace(data);
    }, (error) => console.warn('[LIFE-OS cloud] workspace listen', error)));

    cloud.unsubscribers.push(profileRef(activeId).onSnapshot((doc) => {
      if (!doc.exists || cloud.applying) return;
      cloud.app.applyRemoteProfile(activeId, doc.data());
    }, (error) => console.warn('[LIFE-OS cloud] profile listen', error)));

    cloud.unsubscribers.push(daysCol(activeId).onSnapshot((snap) => {
      if (cloud.applying) return;
      snap.docChanges().forEach((change) => {
        if (change.type === 'removed') return;
        cloud.app.applyRemoteDay(activeId, change.doc.id, change.doc.data());
      });
    }, (error) => console.warn('[LIFE-OS cloud] days listen', error)));
  }

  async function handleSignedIn(user) {
    cloud.user = user;
    showAuthOverlay(false);
    renderCloudTab();
    await pullAndMerge();
    listen();
    if (cloud.app && cloud.app.afterCloudSync) cloud.app.afterCloudSync();
  }

  function handleSignedOut() {
    cloud.user = null;
    stopListeners();
    setStatus('Signed out — this device only');
    renderCloudTab();
  }

  async function signIn() {
    if (!(await ensureFirebase())) {
      showAuthOverlay(true);
      renderCloudTab();
      return;
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const mobile = /Mobi|Android/i.test(navigator.userAgent) || window.matchMedia('(display-mode: standalone)').matches;
    try {
      if (mobile) {
        await cloud.auth.signInWithRedirect(provider);
        return;
      }
      const result = await cloud.auth.signInWithPopup(provider);
      await handleSignedIn(result.user);
    } catch (error) {
      if (error && error.code === 'auth/popup-blocked') {
        await cloud.auth.signInWithRedirect(provider);
        return;
      }
      console.warn('[LIFE-OS cloud] sign-in', error);
      const message = friendlyAuthError(error);
      setStatus(message);
      showToastSafe(message, 'error');
    }
  }

  async function signOut() {
    if (!cloud.auth) return;
    await cloud.auth.signOut();
    handleSignedOut();
  }

  function showToastSafe(message, type) {
    if (cloud.app && cloud.app.toast) cloud.app.toast(message, type);
  }

  function friendlyAuthError(error) {
    const code = error && error.code || '';
    const message = error && error.message || '';
    if (message.indexOf('CONFIGURATION_NOT_FOUND') !== -1 || code === 'auth/operation-not-allowed') {
      return 'Google sign-in is not enabled in Firebase yet. In project fir-d6d80, open Authentication → Sign-in method, enable Google, choose a support email, and save.';
    }
    if (code === 'auth/unauthorized-domain') {
      return 'This website domain is not authorized in Firebase. Add its hostname in Authentication → Settings → Authorized domains.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Could not reach Firebase. Check your internet connection and reload LIFE-OS.';
    }
    return message || 'Google sign-in failed. Check the Firebase Authentication settings.';
  }

  function notifyLocalChange(kind, extra) {
    if (!cloud.user || cloud.applying) return;
    const profileId = cloud.app.getActiveUserId();
    if (kind === 'day' && extra && extra.key) {
      const dayTimerKey = profileId + ':' + extra.key;
      clearTimeout(cloud.dayTimers[dayTimerKey]);
      cloud.dayTimers[dayTimerKey] = setTimeout(() => {
        pushDay(extra.key, profileId).catch((error) => console.warn('[LIFE-OS cloud] day push', error));
      }, DAY_DEBOUNCE_MS);
    }
    clearTimeout(cloud.profileTimers[profileId]);
    cloud.profileTimers[profileId] = setTimeout(() => {
      pushProfile(profileId).catch((error) => console.warn('[LIFE-OS cloud] profile push', error));
    }, PROFILE_DEBOUNCE_MS);
  }

  async function boot(app) {
    cloud.app = app;
    renderCloudTab();
    updateChip();
    if (!(await ensureFirebase())) return;
    try {
      const redirect = await cloud.auth.getRedirectResult();
      if (redirect && redirect.user) await handleSignedIn(redirect.user);
    } catch (error) {
      console.warn('[LIFE-OS cloud] redirect', error);
    }
    cloud.auth.onAuthStateChanged(async (user) => {
      if (user) {
        if (!cloud.user || cloud.user.uid !== user.uid) await handleSignedIn(user);
      } else {
        handleSignedOut();
      }
    });
  }

  window.LifeOSCloud = {
    boot,
    signIn,
    signOut,
    syncNow: function () {
      if (!cloud.user) return signIn();
      return pullAndMerge().then(() => {
        if (cloud.app && cloud.app.afterCloudSync) cloud.app.afterCloudSync();
      });
    },
    notifyLocalChange,
    onLocalUserSwitch: function () {
      if (!cloud.user) return;
      listen();
      notifyLocalChange('workspace');
    },
    isConfigured,
    isSignedIn: function () { return !!cloud.user; },
    renderCloudTab,
    showAuthOverlay,
    jsonClone
  };

  document.addEventListener('click', (event) => {
    if (event.target.closest('#btnCloudAccount')) {
      document.getElementById('btnSettings')?.click();
      document.querySelector('#settingsModal .settings-tabs [data-tab="cloud"]')?.click();
    }
    if (event.target.closest('#btnGoogleSignIn') || event.target.closest('#btnGoogleSignInOverlay')) {
      signIn();
    }
    if (event.target.closest('#btnGoogleSignOut')) signOut();
    if (event.target.closest('#btnCloudSyncNow')) window.LifeOSCloud.syncNow();
    if (event.target.closest('#btnCloseCloudAuth') || event.target.closest('#btnSkipCloudAuth')) {
      showAuthOverlay(false);
    }
  });
})();
