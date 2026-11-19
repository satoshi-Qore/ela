# 7C-37 screenshots: the original ELA Core visual, restored

## Which visual is the original
The ELA Core panel first appeared on 17 Nov 2026 in the first local ELA design concept (`E:\ELA\ela-design-concept`, 18:49), titled "SESSION TRACE · ELA Core". It shows six translucent isometric plates threaded by a light beam. That concept was never committed:
- `fc997a7` (7C-26) has no Core visual at all;
- the first ELA CORE that went live is 7C-27 (`e564166`), which already had the Karot, Optik and Gravür views.

The owner chose this concept from the candidates found: the first concept, the V2 reactor crystal, the V3 execution matrix, and the first live Karot.

- `original-concept-{1440,390,320-text200}.png`: the concept's own screenshots, taken on 17 Nov 2026 and copied unchanged.

## Fidelity check (`fidelity-*`)
Each image shows the concept's `.optics` element on the left and the restored `#core-viz .ot` on the right. Both are rendered in headless Chrome at the same viewport and container width, in each of the concept's four scenarios (`replay`, `refusal`, `idle`, `capture`). The restored side uses synthetic records with the same plate tones.

Pixel difference per scenario:

| Viewport | Max channel difference | Pixels above 8/255 |
|---|---|---|
| 1440 px | 4 of 255 | 0 to 4 |
| 390 px | 4 of 255 | 0 to 7 |
| 320 px | up to 33 of 255 | 0 to 4 |

All differences come from the blur filters.

## Before and after in the real interface (`before-*`, `after-*`, `compare-*`)
Both sides were captured at the same viewport and scale:
- **Before:** main (7C-36, default view Karot), served from port 5210.
- **After:** this branch, served from port 5211.

They are cropped from the ELA Core card down to the end of the execution flow, and show two states:
- `ready`: no command run yet;
- `refused`: `Send 10 QOR.` (TR: `10 QOR gönder.`) was refused by the safety gate, so no RPC was sent.

Variants:
- 1440 px in blue/EN, light/TR and dark/EN;
- 390 px in blue/EN;
- 320 px with the browser text size at 200%, in blue/EN.

No request left the dev servers during the run.

The trace keeps the concept's dark panel in every theme, as it was drawn. At 320 px with 200% text the caption wraps over the art, as it does in the concept (`original-concept-320-text200.png`).
