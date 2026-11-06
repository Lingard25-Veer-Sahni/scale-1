"""Course completion certificate PDF generator.

Overlays a learner's name and completion date onto a pre-designed blank
template (backend/assets/certificate_course1_template.pdf — a one-page A4
landscape PDF exported from Canva, with "Certificate of Completion" /
"SCALE Course 1" / etc. baked into the artwork). Only the name and date are
generated dynamically.

Positions/sizes/colors below were reverse-engineered from the actual blank
template and a filled sample ("Aarav Sharma") the user supplied, by reading
both PDFs' text layers with pdfplumber (exact x/y/font/color per glyph) and
verifying pixel-for-pixel against a rendered PNG — not eyeballed. The name
font is Playfair Display Italic (static wght=400 instance built from
Google Fonts' variable TTF via fonttools varLib.instancer, since Google
Fonts no longer ships pre-built static files for this family) to match the
template's embedded font exactly.
"""
import pymupdf

from pathlib import Path

ASSETS_DIR = Path(__file__).parent / "assets"
FONT_PATH = ASSETS_DIR / "fonts" / "PlayfairDisplay-Italic.ttf"

# (template_path, page size is A4 landscape: 841.8898 x 595.2756 pt)
COURSE1_TEMPLATE = ASSETS_DIR / "certificate_course1_template.pdf"

GOLD = (0.933333, 0.737255, 0.333333)
PAGE_W = 841.8898
CENTER_X = PAGE_W / 2

# Baseline y-positions (PyMuPDF page space: origin top-left, y increases
# downward — same convention pdfplumber reports "top"/"bottom" in, which is
# where these numbers came from. Do NOT flip these against page height; that
# was tried and visually confirmed wrong against the sample render.)
NAME_Y = 245.04
NAME_MAX_WIDTH = 480
NAME_START_SIZE = 44
NAME_MIN_SIZE = 20

DATE_Y = 509.0
DATE_MAX_WIDTH = 230
DATE_START_SIZE = 22
DATE_MIN_SIZE = 14


def _fit_size(font: "pymupdf.Font", text: str, max_width: float, start_size: int, min_size: int) -> int:
    size = start_size
    while size > min_size and font.text_length(text, fontsize=size) > max_width:
        size -= 1
    return size


def generate_course1_certificate(learner_name: str, completed_date_str: str) -> bytes:
    """Returns PDF bytes for the Course 1 ("Personal Finance & Money
    Decisions") certificate, with learner_name and completed_date_str
    overlaid in the same gold italic style as the approved sample."""
    doc = pymupdf.open(str(COURSE1_TEMPLATE))
    page = doc[0]
    page.insert_font(fontname="PFI", fontfile=str(FONT_PATH))
    font = pymupdf.Font(fontfile=str(FONT_PATH))

    name = (learner_name or "").strip() or "SCALE Learner"
    name_size = _fit_size(font, name, NAME_MAX_WIDTH, NAME_START_SIZE, NAME_MIN_SIZE)
    name_w = font.text_length(name, fontsize=name_size)
    page.insert_text(
        (CENTER_X - name_w / 2, NAME_Y), name,
        fontsize=name_size, fontname="PFI", fontfile=str(FONT_PATH), color=GOLD,
    )

    date_size = _fit_size(font, completed_date_str, DATE_MAX_WIDTH, DATE_START_SIZE, DATE_MIN_SIZE)
    date_w = font.text_length(completed_date_str, fontsize=date_size)
    page.insert_text(
        (CENTER_X - date_w / 2, DATE_Y), completed_date_str,
        fontsize=date_size, fontname="PFI", fontfile=str(FONT_PATH), color=GOLD,
    )

    out = doc.tobytes()
    doc.close()
    return out
