# 7C-36 screenshots: Core with three views (Karot, Koherens, Okta)

The two groups below are kept apart on purpose.

## Synthetic records (`synthetic-*`)

These images are made-up execution records drawn by the production view modules in `src/core/` from a local review page. They come from no session, no RPC and no network. Each grid shows six records, one per row: ready, running, success, refused, partial and unknown. Together they cover all seven stage states (waiting, running, ok, blocked, failed, skipped, unknown). Columns are Karot, Koherens and Okta.

- `synthetic-desktop-{blue,light,dark}-all-states.png`: the desktop drawing, 800 × 540 per view.
- `synthetic-mobile-{blue,light,dark}-all-states.png`: the mobile drawing at 300 px per view. On mobile the stage text is in the HTML list, so this geometry carries no text.

## Real interface (`real-*`)

These images show the real app served by the Vite dev server. The command `Send 10 QOR.` (in Turkish, `10 QOR gönder.`) was typed into the real command field and refused by the safety gate. The Core was then switched across all three views. During the whole run the page sent no request outside the dev server, so nothing went to any RPC endpoint. Each image is cropped to the ELA Core card and the execution flow under it.

- `real-desktop-1440-{blue-en,light-tr,dark-en}-refused-{karot,koherens,okta}.png`
- `real-mobile-390-blue-en-refused-{karot,koherens,okta}.png`
- `real-narrow-320-text200-blue-en-refused-{karot,koherens,okta}.png`: 320 px wide with the browser text size at 200%.
