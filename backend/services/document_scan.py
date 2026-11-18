"""A photographed page made to look scanned, before it is read: the sheet
found in the photo, its four corners pulled straight, the table or cloth
around it cut away and the shadows evened out - what a phone's document
mode does, done on the server so it helps every photo from every phone
and from the gallery alike.

No AI and no cost: plain image arithmetic (numpy and Pillow) taking a
fraction of a second. It only ever helps: when the sheet cannot be told
apart with confidence - a white page on a white table, a page cut by the
frame, a crumpled receipt - the photo is read exactly as it came.

How the sheet is found: a page is lighter than what it lies on, so the
photo is split into light and dark (Otsu's threshold), the light region
around the middle of the photo is taken as the page, and it must be a
clean four-cornered shape - nearly filling the quadrilateral of its
corners, not touching three sides of the frame, not too small to be a
page nor already the whole frame."""
from __future__ import annotations

import asyncio
import base64
import binascii
import io
import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

logger = logging.getLogger(__name__)

# Where the sheet is looked for: small is fast and plenty for corners.
DETECT_LONG_EDGE = 400
# The working copy for the cut, and the page sent to be read - the same
# size the app already sends (src/utils/scanImage.ts).
WORK_LONG_EDGE = 2400
OUTPUT_LONG_EDGE = 1600
# A page covers at least a sixth of the photo; at 97% it already is the photo.
MIN_PAGE_SHARE = 0.16
MAX_PAGE_SHARE = 0.97
# The light region must nearly fill the four-cornered shape of its corners.
MIN_QUAD_FILL = 0.88
# A long till receipt is a page too, up to 1:8.
MAX_ASPECT = 8.0

# A page's corners: a 4 x 2 float array - top-left, top-right, bottom-right, bottom-left.


async def straighten_image_blocks(blocks: List[Dict[str, Any]]) -> List[Optional[str]]:
    """Each photo in the AI request's image blocks made to look scanned,
    in place - off the event loop, it is plain CPU work. Returns the pages
    as data URIs for the app to show and keep (None where a photo is read
    as it came)."""
    def work() -> List[Optional[str]]:
        pages: List[Optional[str]] = []
        for block in blocks:
            source = block.get("source") or {}
            straightened = straighten_base64(source.get("data", ""))
            if straightened is None:
                pages.append(None)
                continue
            source["data"], source["media_type"] = straightened, "image/jpeg"
            pages.append(f"data:image/jpeg;base64,{straightened}")
        return pages
    return await asyncio.to_thread(work)


def straighten_base64(page_base64: str) -> Optional[str]:
    """The page straightened, as base64 JPEG - or None to read the photo as it is."""
    try:
        data = base64.b64decode(page_base64, validate=False)
    except (binascii.Error, ValueError):
        return None
    straightened = straighten_page(data)
    return base64.b64encode(straightened).decode("ascii") if straightened else None


def straighten_page(data: bytes) -> Optional[bytes]:
    """The page straightened and cleaned, as JPEG bytes - or None."""
    try:
        with Image.open(io.BytesIO(data)) as opened:
            photo = ImageOps.exif_transpose(opened).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return None
    try:
        return _straighten(photo)
    except Exception:  # a page that cannot be straightened is read as it came
        logger.exception("Document straightening failed - the photo is read as it is")
        return None


def _straighten(photo: Image.Image) -> Optional[bytes]:
    work = _limit(photo, WORK_LONG_EDGE)
    small = _limit(work, DETECT_LONG_EDGE)
    corners = _find_page(small)
    if corners is None:
        return None
    corners = corners * (work.width / small.width)
    page = _warp(work, corners)
    if page is None:
        return None
    page = _even_out_light(page)
    out = io.BytesIO()
    page.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue()


def _limit(image: Image.Image, long_edge: int) -> Image.Image:
    scale = long_edge / max(image.size)
    if scale >= 1:
        return image
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def _otsu(gray: np.ndarray) -> float:
    histogram = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = histogram.sum()
    levels = np.arange(256, dtype=np.float64)
    weight_dark = np.cumsum(histogram)
    weight_light = total - weight_dark
    sum_dark = np.cumsum(histogram * levels)
    mean_dark = sum_dark / np.maximum(weight_dark, 1)
    mean_light = (sum_dark[-1] - sum_dark) / np.maximum(weight_light, 1)
    between = weight_dark * weight_light * (mean_dark - mean_light) ** 2
    return float(np.argmax(between))


def _grow(seed: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """The part of `mask` connected to `seed` (8 neighbours)."""
    region = seed & mask
    for _ in range(4 * max(mask.shape)):
        grown = region.copy()
        grown[1:, :] |= region[:-1, :]
        grown[:-1, :] |= region[1:, :]
        grown[:, 1:] |= region[:, :-1]
        grown[:, :-1] |= region[:, 1:]
        grown[1:, 1:] |= region[:-1, :-1]
        grown[:-1, :-1] |= region[1:, 1:]
        grown[1:, :-1] |= region[:-1, 1:]
        grown[:-1, 1:] |= region[1:, :-1]
        grown &= mask
        if np.array_equal(grown, region):
            break
        region = grown
    return region


def _find_page(small: Image.Image) -> Optional[np.ndarray]:
    gray_image = small.convert("L").filter(ImageFilter.GaussianBlur(radius=1.5))
    gray = np.asarray(gray_image, dtype=np.uint8)
    height, width = gray.shape
    threshold = _otsu(gray)
    light = Image.fromarray(np.where(gray > threshold, 255, 0).astype(np.uint8))
    # Close the dark text inside the page, then drop thin light lines and specks.
    close = max(3, (min(width, height) // 40) | 1)
    light = light.filter(ImageFilter.MaxFilter(close)).filter(ImageFilter.MinFilter(close))
    light = light.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    mask = np.asarray(light) > 127

    # The page is the light region around the middle of the photo.
    seed = np.zeros_like(mask)
    y0, y1, x0, x1 = height * 2 // 5, height * 3 // 5, width * 2 // 5, width * 3 // 5
    seed[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
    if not seed.any():
        return None
    page = _grow(seed, mask)

    share = page.sum() / page.size
    if not MIN_PAGE_SHARE <= share <= MAX_PAGE_SHARE:
        return None
    # Touching three sides of the frame it is the background, or a page the
    # frame cuts - nothing to straighten with confidence.
    sides = sum(bool(edge.any()) for edge in (page[0, :], page[-1, :], page[:, 0], page[:, -1]))
    if sides >= 3:
        return None

    ys, xs = np.nonzero(page)
    total = xs + ys
    diff = xs - ys
    corners = np.array([
        (xs[np.argmin(total)], ys[np.argmin(total)]),   # top-left
        (xs[np.argmax(diff)], ys[np.argmax(diff)]),     # top-right
        (xs[np.argmax(total)], ys[np.argmax(total)]),   # bottom-right
        (xs[np.argmin(diff)], ys[np.argmin(diff)]),     # bottom-left
    ], dtype=np.float64)
    if not _is_page_shaped(corners, page.sum(), (width, height)):
        return None
    # Pixel centres to the outer edge of the page's border pixels.
    centre = corners.mean(axis=0)
    corners += np.sign(corners - centre) * 0.5
    return corners


def _is_page_shaped(corners: np.ndarray, area: float, frame: Tuple[int, int]) -> bool:
    # Convex, corners in order.
    crosses = []
    for i in range(4):
        a, b, c = corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4]
        crosses.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    if not (all(x > 0 for x in crosses) or all(x < 0 for x in crosses)):
        return False
    # Sides long enough to be a page, not a sliver.
    shortest = min(frame) * 0.15
    if any(np.hypot(*(corners[(i + 1) % 4] - corners[i])) < shortest for i in range(4)):
        return False
    # The light region fills its quadrilateral: four straight sides, not a blob.
    x, y = corners[:, 0], corners[:, 1]
    quad_area = 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    return quad_area > 0 and area / quad_area >= MIN_QUAD_FILL


def _warp(work: Image.Image, corners: np.ndarray) -> Optional[Image.Image]:
    tl, tr, br, bl = corners
    width = max(np.hypot(*(tr - tl)), np.hypot(*(br - bl)))
    height = max(np.hypot(*(bl - tl)), np.hypot(*(br - tr)))
    if min(width, height) < 1 or max(width, height) / min(width, height) > MAX_ASPECT:
        return None
    scale = min(1.0, OUTPUT_LONG_EDGE / max(width, height))
    out_w, out_h = max(1, round(width * scale)), max(1, round(height * scale))
    # Pillow maps each output pixel back to the photo: solve for that mapping.
    target = [(0, 0), (out_w, 0), (out_w, out_h), (0, out_h)]
    rows, values = [], []
    for (u, v), (px, py) in zip(target, corners):
        rows.append([u, v, 1, 0, 0, 0, -u * px, -v * px])
        values.append(px)
        rows.append([0, 0, 0, u, v, 1, -u * py, -v * py])
        values.append(py)
    try:
        coefficients = np.linalg.solve(np.array(rows, dtype=np.float64), np.array(values, dtype=np.float64))
    except np.linalg.LinAlgError:
        return None
    return work.transform(
        (out_w, out_h), Image.Transform.PERSPECTIVE, tuple(coefficients), resample=Image.Resampling.BICUBIC,
    )


def _even_out_light(page: Image.Image) -> Image.Image:
    """Shadows and a yellow light taken out: each colour divided by how bright
    the paper around it is, so the paper is white and the print keeps its
    darkness and its colour. The paper's brightness is measured over a wide
    window - wider than a dark table header - so dark bands keep their light
    text."""
    small = page.resize((max(1, page.width // 8), max(1, page.height // 8)), Image.Resampling.BILINEAR)
    window = max(3, (min(small.size) // 10) | 1)
    paper = small.filter(ImageFilter.MaxFilter(window)).filter(ImageFilter.GaussianBlur(radius=window))
    paper = paper.resize(page.size, Image.Resampling.BILINEAR)
    paper_rgb = np.asarray(paper, dtype=np.float32)
    if paper_rgb.mean() < 60:  # a dark photo: no paper to measure against
        return page
    evened = np.asarray(page, dtype=np.float32) / np.maximum(paper_rgb, 1.0)
    return Image.fromarray(np.clip(evened * 255.0, 0, 255).astype(np.uint8))
