// Deployment config. Safe to commit: a browser API key is public by design.
// Lock it down in Google Cloud Console -> Credentials -> your key:
//   Application restrictions: HTTP referrers -> https://<you>.github.io/*
//   API restrictions:         Google Drive API only
export const CONFIG = {
  // Leave blank to make visitors paste their own key. Fill it in to ship a shared key.
  apiKey: '',

  // Let visitors override the built-in key with their own (useful once quota runs out).
  allowUserKey: true,

  // Shown in the Support box. Leave blank to hide it.
  donateUrl: '',
  donateLabel: 'Support this project',
};
