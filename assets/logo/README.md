# tachyons logo

**Mark:** a core with an orbit that tapers into a trail behind a leading particle. The particle crosses in front of the core and the trail fades out behind it: something moving faster than its own trace. It uses the same orbit construction and palette as the southstar21 mark.

## Files

| File | Use |
|---|---|
| `tachyons-horizontal-{cream,darkroast,black,white}.svg` | Logo with wordmark. `cream` on dark backgrounds, `darkroast` on light |
| `tachyons-symbol-{cream,darkroast,black,white}.svg` | The mark alone, 48 px and up |
| `tachyons-symbol-small-*.svg` | Small-size cut for 16–48 px: heavier trail, blunt tail, bigger particle |
| `tachyons-tile-{darkroast,cream}.svg`, `tachyons-tile-512.png` | Avatar and app icon |
| `favicon.svg`, `favicon.ico` | Small cut on a dark roast tile (16/32/48 px) |
| `social-preview.png` | GitHub social preview (1280×640) |
| `source/kit.py` | Rebuilds every SVG. Needs `shapely`, `fonttools` and macOS's Futura |

## Colours

| Name | Hex | Use |
|---|---|---|
| Dark roast | `#1F1A17` | core and wordmark on light, tile background |
| Cream | `#F5ECD7` | core and wordmark on dark, light backgrounds |
| Ring cream | `#E6D8B8` | orbit on dark |
| Tan | `#A8946A` | orbit on light |

## Rules

- Clear space: the particle's diameter on every side.
- Below 48 px, use the small cut.
- Don't rotate, stretch, mirror, recolour, or add shadows or glows.

## Notes

- The wordmark is Futura Bold (system copy on macOS), converted to outlines. Check that the font licence covers logo use.
- Trademark clearance has not been checked.
