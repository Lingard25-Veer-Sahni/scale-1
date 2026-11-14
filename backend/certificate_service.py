"""Course completion certificate PDF generator.

Overlays a learner's name and completion date onto a pre-designed blank
template (backend/assets/certificate_course<N>_template.pdf — a one-page A4
landscape PDF exported from Canva, with "Certificate of Completion" /
"SCALE Course N" / the course name baked into the artwork). Only the name
and date are generated dynamically.

The artwork reads "has successfully completed all lessons of", with no
lesson count, so adding or removing a lesson from a course does not make
the certificate wrong. See scripts/patch_certificate_templates.py, which
applies that wording and the course-name type size to the Canva exports.

Positions/sizes/colors below were reverse-engineered from the actual blank
templates and the filled samples ("Aarav Sharma") the user supplied, by
reading both PDFs' text layers with pdfplumber (exact x/y/font/color per
glyph) and verifying pixel-for-pixel against a rendered PNG — not eyeballed.
The name font is Playfair Display Italic (static wght=400 instance built from
Google Fonts' variable TTF via fonttools varLib.instancer, since Google
Fonts no longer ships pre-built static files for this family) to match the
template's embedded font exactly.

The Course 2 template was checked against Course 1 span by span: same A4
landscape page box, same name baseline (245.04), same rules at y=246 and
y=513.28, same "Date of completion" label at y=519.36. The two artworks
differ only in the baked-in course wording ("SCALE Course 1" vs "SCALE
Course 2" and the course name). So one set of geometry constants serves
both, and a new course only needs a template file and an entry in
TEMPLATES below.
"""
import pymupdf

from pathlib import Path

ASSETS_DIR = Path(__file__).parent / "assets"
FONT_PATH = ASSETS_DIR / "fonts" / "PlayfairDisplay-Italic.ttf"

# Course slug -> blank template artwork. A slug that is not listed here has
# no certificate design yet; the API turns that into a clear 501 rather than
# handing the learner a Course 1 certificate with the wrong course name on it.
TEMPLATES = {
    "personal-finance-money-decisions": ASSETS_DIR / "certificate_course1_template.pdf",
    "investing-and-financial-markets": ASSETS_DIR / "certificate_course2_template.pdf",
}

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


def has_template(course_slug: str) -> bool:
    """True when a certificate design exists for this course."""
    path = TEMPLATES.get(course_slug)
    return bool(path and path.exists())


def _fit_size(font: "pymupdf.Font", text: str, max_width: float, start_size: int, min_size: int) -> int:
    size = start_size
    while size > min_size and font.text_length(text, fontsize=size) > max_width:
        size -= 1
    return size


def generate_certificate(course_slug: str, learner_name: str, completed_date_str: str) -> bytes:
    """Returns PDF bytes for the given course's certificate, with
    learner_name and completed_date_str overlaid in the same gold italic
    style as the approved sample.

    Raises KeyError if the course has no certificate template.
    """
    template = TEMPLATES.get(course_slug)
    if not template or not template.exists():
        raise KeyError(f"No certificate template for course {course_slug!r}")

    doc = pymupdf.open(str(template))
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
