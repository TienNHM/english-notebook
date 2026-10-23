// Firebase web config (public identifiers, not secrets: access is controlled by firestore.rules).
// Set to null to run local-only (no login, data stays in this browser).
export const firebaseConfig = {
  apiKey: "AIzaSyDqXhccFWD7Id3KexTxdOC7k6_8Eq9u2x8",
  authDomain: "tiennhm-english-notebook.firebaseapp.com",
  projectId: "tiennhm-english-notebook",
  appId: "1:628826559800:web:0d13c43165a5dc58ea5dcd",
};

// Address of the agent API Worker (see worker/). Empty = not deployed yet: the "Connect an AI agent" screen says so.
export const agentApiUrl = "";
