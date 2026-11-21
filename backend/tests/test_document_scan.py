"""A photographed invoice made to look scanned before it is read
(services/document_scan): the sheet cut out of what it lies on, its
corners pulled straight, its shadows evened out - and left as it came
whenever the sheet cannot be found with confidence. The photos here are
drawn by the test: a made-up page of "print" on a cloth-like background."""
import base64
import io
from types import SimpleNamespace

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import server
from routers import scan_credits
from services.document_scan import straighten_page
from tests.test_whole_program_fixes import _company

PAGE = (840, 1188)          # an A4 page
SLANTED = ((260, 330), (930, 300), (1000, 1290), (210, 1330))


def _photo(quad=SLANTED, background=(120, 88, 40), paper=(242, 238, 228), shadow=True, size=(1200, 1600)) -> bytes:
    rng = np.random.default_rng(7)
    width, height = size
    cloth = np.ones((height, width, 3), np.float32) * np.array(background, np.float32) + rng.normal(0, 18, (height, width, 1))
    photo = Image.fromarray(np.clip(cloth, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    page = Image.new("RGB", PAGE, paper)
    draw = ImageDraw.Draw(page)
    draw.rectangle((60, 60, PAGE[0] - 60, 120), fill=(40, 40, 40))           # a dark header band
    draw.rectangle((80, 80, 300, 100), fill=(255, 255, 255))                 # its light text
    for row in range(30):
        y = 170 + row * 32
        draw.rectangle((70, y, 70 + int(rng.integers(300, 690)), y + 9), fill=(30, 30, 30))
    # The page as the camera sees it: mapped onto the quadrilateral.
    corners = [(0, 0), (PAGE[0], 0), PAGE, (0, PAGE[1])]
    rows, values = [], []
    for (u, v), (x, y) in zip(quad, corners):
        rows += [[u, v, 1, 0, 0, 0, -u * x, -v * x], [0, 0, 0, u, v, 1, -u * y, -v * y]]
        values += [x, y]
    mapping = np.linalg.solve(np.array(rows, float), np.array(values, float))
    seen = page.transform(size, Image.Transform.PERSPECTIVE, tuple(mapping), resample=Image.Resampling.BICUBIC)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(quad, fill=255)
    photo.paste(seen, (0, 0), mask)
    pixels = np.asarray(photo, np.float32)
    if shadow:   # darker towards the left
        pixels = pixels * np.linspace(0.55, 1.0, width)[None, :, None]
    out = io.BytesIO()
    Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8)).save(out, "JPEG", quality=88)
    return out.getvalue()


def _image(data: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), np.float32)


def test_the_sheet_is_cut_out_straightened_and_evened_out():
    page = straighten_page(_photo())
    assert page is not None
    pixels = _image(page)
    height, width = pixels.shape[:2]
    assert 1.15 < height / width < 1.5                          # an upright page, not the photo's frame
    # No cloth left around it: the margins are paper, and white - the shadow is gone.
    margin = np.concatenate([pixels[:, 8:16].reshape(-1, 3), pixels[:, -16:-8].reshape(-1, 3)])
    assert margin.mean() > 225 and margin.mean(axis=0).std() < 8   # white, not brown
    # The print keeps its darkness, the header band its light text.
    assert (pixels.mean(axis=2) < 90).mean() > 0.05
    band = pixels[int(height * 0.05):int(height * 0.1), int(width * 0.1):int(width * 0.9)].mean(axis=2)
    assert band.min() < 80 and band.max() > 200


def test_what_cannot_be_found_with_confidence_is_read_as_it_came():
    assert straighten_page(_photo(background=(236, 234, 228), shadow=False)) is None          # white on white
    whole = ((0, 0), (1200, 0), (1200, 1600), (0, 1600))
    assert straighten_page(_photo(quad=whole, shadow=False)) is None                           # already the frame
    cut = ((-100, 200), (1300, 180), (1300, 1700), (-100, 1700))
    assert straighten_page(_photo(quad=cut, shadow=False)) is None                             # cut by the frame
    assert straighten_page(b"not a photo") is None


def test_a_long_till_receipt_is_a_page_too():
    receipt = ((470, 120), (720, 130), (735, 1480), (460, 1470))
    page = straighten_page(_photo(quad=receipt))
    assert page is not None
    height, width = _image(page).shape[:2]
    assert height / width > 4


def test_the_invoice_scan_reads_the_straightened_page(client, monkeypatch):
    _, _, owner = _company()
    seen = []

    class FakeMessages:
        async def parse(self, **kwargs):
            seen.append(kwargs["messages"][0]["content"][0]["source"])
            extraction = server.ClaudeInvoiceExtraction(
                supplier="Доставчик Проба ЕООД", invoice_number="0000000123", invoice_date="2026-11-10",
                amount_without_vat=100, vat_amount=20, total_amount=120,
            )
            return SimpleNamespace(parsed_output=extraction, usage=SimpleNamespace(input_tokens=1, output_tokens=1))

    async def no_log(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "AI_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "anthropic_client", SimpleNamespace(messages=FakeMessages()))
    monkeypatch.setattr(scan_credits, "anthropic_client", server.anthropic_client, raising=False)
    monkeypatch.setattr(scan_credits, "log_ai_usage", no_log)

    photo = "data:image/jpeg;base64," + base64.b64encode(_photo()).decode()
    result = client.post("/api/ocr/scan", headers=owner, json={"image_base64s": [photo]})
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["supplier"] == "Доставчик Проба ЕООД"
    # What was read is the page, not the photo of the table.
    read = _image(base64.b64decode(seen[0]["data"]))
    assert seen[0]["media_type"] == "image/jpeg" and read.shape[0] / read.shape[1] > 1.15
    assert read[:, 8:16].mean() > 225
    # And the app gets the page to show and keep.
    assert body["pages"][0].startswith("data:image/jpeg;base64,")
    assert base64.b64decode(body["pages"][0].split(",", 1)[1]) == base64.b64decode(seen[0]["data"])
