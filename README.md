# Spendings Tracker

A cash jar for your spending. Set a limit for the week or the month and the jar fills with that much cash. Every purchase you log takes bills out of it. Finish the week (or month) under your limit and your streak grows; go over and it starts again.

- **See what's left at a glance.** The jar empties as you spend, and a pace mark on the glass shows where your cash should be by today. You also get a daily figure, like "about $38 a day through Saturday".
- **Keep a streak.** Every week or month you finish under the limit adds one. The past-weeks chart shows which ones went over.
- **Private.** Everything is saved in your browser, on your device. Nothing is sent to a server, and none of it is stored in this repository.
- **Works offline.** Install it to your phone's home screen or your desktop and it opens like an app.
- **Backups.** Export a backup file from Settings and import it on another device. You can also export a CSV for spreadsheets.

On first run, choose **Explore with sample data** to see a couple of months of history and a streak, then clear it when you're ready to fill your own jar.

## Run it on your computer

There's no build step. Open `index.html` in a browser, or serve the folder with any static web server:

```
python -m http.server 8000
```

## Icons and launch screens

`python tools/make_images.py` redraws the app icons and the iPhone launch screens (light and dark, one per screen size) and updates the matching tags in `index.html`. It needs Python 3 and nothing else.

## Publish it with GitHub Pages

1. Push this folder to a public GitHub repository.
2. In the repository, open **Settings**, then **Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute or two the app is live at `https://<your-username>.github.io/<repository-name>/`.
