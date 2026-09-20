# Frontend

This is the React client of the IP Camera Viewer. It shows every camera in a grid.
It plays each stream with WebRTC. It falls back to MSE and then to HLS.

## Commands

| Task | Command |
|------|---------|
| Start the dev server | `npm run dev` |
| Build for production | `npm run build` |
| Check the code style | `npm run lint` |

The dev server needs go2rtc on port 1984. Start go2rtc first.
Set `GO2RTC_URL` to use a different address.

## Data source

The client reads the camera list from `/cameras.json`.
The script `scripts/generate-config.mjs` writes this file into `frontend/public/`.
Run that script before you start the dev server.

The file holds camera names and stream names only. It holds no camera password.

## Player

The file `src/lib/video-rtc.js` is a vendored copy of VideoRTC v1.6.0.
This copy has 3 local changes:

- The element keeps an `AbortController` in the field `lifecycle`.
- The element keeps the viewport observer in the field `observer`.
- The element has a `destroy()` method. The method releases every listener, timer and connection.

The file `src/lib/camera-video.ts` extends that class. It defines the element `camera-video`.
It sets the LAN defaults, it reports the stream status, and it retries WebRTC after an offer error.
