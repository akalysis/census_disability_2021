# England Disability Prevalence Map

This folder now contains a standalone interactive map built from the supplied Nomis CSV and official ONS boundary data.

## Open it

For the most reliable local run, start a small web server in this folder:

```bash
python3 -m http.server 4173
```

Then open [http://127.0.0.1:4173/index.html](http://127.0.0.1:4173/index.html).

## What it does

- Maps disability prevalence across all English MSOAs.
- Adds region-shaped 3D extrusions and zoomed-out regional labels so the England-wide pattern reads clearly at a glance.
- Starts with an automatic regional story tour that can be replayed at any time.
- Lets you select one, several, or all age groups.
- Switches between absolute prevalence and the gap versus the England average.
- Shows regional averages, hover figures, local inequality extremes, large rotate controls, and a fullscreen map view.

## Rebuild the data bundle

If you replace the source CSV or want to refresh the app data bundle:

```bash
python3 scripts/build_data.py
```

This script:

- Parses the `Disabled under the Equality Act` and `Not disabled under the Equality Act` blocks from the Nomis extract.
- Fetches official ONS MSOA 2021 and England region boundaries.
- Assigns each MSOA to a region and writes `data/app-data.js`.

## Files

- `index.html`: the app shell
- `styles.css`: the visual design
- `app.js`: interaction and map logic
- `scripts/build_data.py`: the data build pipeline
- `data/app-data.js`: prebuilt browser-ready dataset
