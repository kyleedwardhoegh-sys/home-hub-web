// The Training Hub moved to the site root (2026-10-13). Screens still running the old
// /training/ page poll this file for updates; when it changes they reload into
// training/index.html, which forwards to the root.
location.replace("../" + location.search + location.hash);
