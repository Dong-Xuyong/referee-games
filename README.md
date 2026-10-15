# Referee Games

Pre-match cards for assigned games.

Live: https://dong-xuyong.github.io/referee-games/

Data lives in Dong-Xuyong/progress-sync, file `referee-games.json`. This public page does not contain games, names, or phone numbers. It loads and saves that file with the shared GitHub token (`dong-gh-sync` in localStorage), the same way the other apps do.

The page auto-loads on open, on focus, and every 60 seconds. Saving a game reads the file sha, writes the new copy, and retries once if another device saved in between.

With no token, the page stays empty until you connect sync.
