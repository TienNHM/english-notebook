// Firebase web config (public identifiers, not secrets: access is controlled by firestore.rules).
// Set to null to run local-only (no login, data stays in this browser).
export const firebaseConfig = {
  apiKey: "AIzaSyDqXhccFWD7Id3KexTxdOC7k6_8Eq9u2x8",
  authDomain: "tiennhm-english-notebook.firebaseapp.com",
  projectId: "tiennhm-english-notebook",
  appId: "1:628826559800:web:0d13c43165a5dc58ea5dcd",
};

// App Check (reCAPTCHA v3) site key, a public identifier. Empty = App Check off. Steps to turn it on: docs/OPERATIONS.md.
export const appCheckSiteKey = "";

// "Cộng đồng" tab (public collections). Keep false until the Firestore rules and indexes are deployed (docs/OPERATIONS.md).
// To preview it in one browser while this is false: localStorage.setItem("english-notebook-community", "1") in the console.
export const communityEnabled = false;

// Address of the agent API Worker (see worker/). Empty = not deployed: the "Connect an AI agent" screen says so.
export const agentApiUrl = "https://english-notebook-agent-api.tiennhm-it.workers.dev";
