"""Edits the baked-in wording and type sizes on the certificate artwork.

Two requested changes, applied to every course template:

  1. "has successfully completed all 32 lessons of" -> "...all lessons of"
     (and the same for Course 2's "all 10 lessons"). Dropping the count means
     the artwork no longer has to be re-exported whenever a course gains or
     loses a lesson.

  2. The course name line ("Foundations of personal money management",
     "Investing & Financial Markets") is enlarged from 11.5pt to COURSE_NAME_SIZE.

WHY EDIT THE CONTENT STREAM INSTEAD OF REDRAWING

The templates are Canva exports. Their text is drawn with subset fonts whose
cmap has been stripped, so the embedded DM Sans cannot be re-used to typeset
new text, and no full DM Sans exists on this machine. Covering the old line
and redrawing it in a substitute font would visibly change the typeface.

Luckily the page content stream stores these lines as plain literal strings
with simple positioning, e.g.

    1 0 0 1 260.3386 319.2756 Tm ... 1.5 Tc /F2+0 12.5 Tf 15 TL (has ...) Tj

so the text can be edited in place and keep its original font, colour,
letter-spacing and baseline exactly. Nothing is covered up or re-rendered.

KEEPING THE LINES CENTRED

Canva centres these lines on the page: the ink box of each runs from the Tm
x-origin to an x1 whose midpoint is the page centre (420.9449). So after
changing the text or the size, the Tm x-origin is recomputed as
    centre - new_ink_width / 2
where the new ink width is derived from the real glyph advances measured out
of the current PDF (not from font metrics, which are unavailable):

  * removing "32 " shrinks the ink box by exactly those glyphs' pen advance,
    which is the x-distance between the first removed glyph and the glyph
    that follows them;
  * scaling the type from 11.5pt to Npt scales the ink width by N/11.5,
    provided the character spacing (Tc) is scaled by the same factor.

IDEMPOTENT

Re-running is safe. The lesson-count regex also matches the already-patched
wording and rewrites it to the same thing, and the course-name block is
matched by its colour rather than its current size, so running this again
with a different COURSE_NAME_SIZE simply re-scales from wherever it is now.

Usage (from backend/):
    ./.venv/bin/python3 scripts/patch_certificate_templates.py
"""
import re
import shutil
import sys
from pathlib import Path

import pymupdf

ASSETS = Path(__file__).parent.parent / "assets"

# Target size for the course name line. Originally 11.5pt. Change this and
# re-run to adjust; the script rescales from whatever the file currently has.
COURSE_NAME_SIZE = 16.0

PAGE_W = 841.8898
CENTER_X = PAGE_W / 2

# The course name is the only line drawn in this muted brown, which makes the
# colour a stabler handle than the size or the wording (which differ per course).
COURSE_NAME_RGB = ".74902 .588235 .411765 rg"

TEMPLATES = [
    ASSETS / "certificate_course1_template.pdf",
    ASSETS / "certificate_course2_template.pdf",
]

LESSON_LINE_RE = re.compile(
    r"(1 0 0 1 )([\d.]+)( [\d.]+ Tm [\d.\s]*rg [\d.]+ Tc /F2\+0 [\d.]+ Tf [\d.]+ TL )"
    r"\(has successfully completed all (?:\d+ )?lessons of\)( Tj)"
)

COURSE_NAME_RE = re.compile(
    r"(1 0 0 1 )([\d.]+)( [\d.]+ Tm )" + re.escape(COURSE_NAME_RGB) +
    r"( )([\d.]+)( Tc /F2\+0 )([\d.]+)( Tf )([\d.]+)( TL \()([^)]*)(\) Tj)"
)


def num(v: float) -> str:
    """Formats a number the way the existing stream does (no trailing zeros)."""
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return s or "0"


def find_span(page, predicate):
    """Returns (span, text) for the first span whose text satisfies predicate."""
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                text = "".join(c["c"] for c in span["chars"])
                if predicate(text):
                    return span, text
    return None, None


def patch(path: Path) -> bool:
    doc = pymupdf.open(str(path))
    page = doc[0]
    xrefs = page.get_contents()
    if len(xrefs) != 1:
        raise RuntimeError(f"{path.name}: expected one content stream, got {len(xrefs)}")
    xref = xrefs[0]
    stream = doc.xref_stream(xref).decode("latin-1")
    original = stream
    changed = []

    # ---- 1. lesson count -------------------------------------------------
    span, text = find_span(page, lambda t: t.startswith("has successfully completed all"))
    if not span:
        raise RuntimeError(f"{path.name}: lesson-count line not found")

    count_match = re.search(r"all (\d+) lessons", text)
    if count_match:
        chars = span["chars"]
        first_removed = text.index(count_match.group(1))
        after_removed = first_removed + len(count_match.group(1)) + 1  # digits + space
        removed_advance = chars[after_removed]["origin"][0] - chars[first_removed]["origin"][0]
        old_ink = span["bbox"][2] - span["bbox"][0]
        new_x = CENTER_X - (old_ink - removed_advance) / 2

        stream, n = LESSON_LINE_RE.subn(
            lambda m: f"{m.group(1)}{num(new_x)}{m.group(3)}"
                      f"(has successfully completed all lessons of){m.group(4)}",
            stream,
        )
        if n != 1:
            raise RuntimeError(f"{path.name}: lesson line matched {n} times in stream")
        changed.append(
            f'  lessons : "all {count_match.group(1)} lessons" -> "all lessons", '
            f"x {num(span['bbox'][0])} -> {num(new_x)}"
        )
    else:
        changed.append("  lessons : already reads \"all lessons\", left as is")

    # ---- 2. course name size --------------------------------------------
    m = COURSE_NAME_RE.search(stream)
    if not m:
        raise RuntimeError(f"{path.name}: course-name line not found")
    course_name = m.group(11)
    old_size = float(m.group(7))
    old_tc = float(m.group(5))

    name_span, _ = find_span(page, lambda t: t == course_name)
    if not name_span:
        raise RuntimeError(f"{path.name}: could not measure course-name span")

    if abs(old_size - COURSE_NAME_SIZE) < 1e-6:
        changed.append(f'  name    : "{course_name}" already {num(old_size)}pt, left as is')
    else:
        factor = COURSE_NAME_SIZE / old_size
        new_tc = old_tc * factor
        new_ink = (name_span["bbox"][2] - name_span["bbox"][0]) * factor
        new_x = CENTER_X - new_ink / 2
        stream = (
            stream[:m.start()]
            + f"{m.group(1)}{num(new_x)}{m.group(3)}{COURSE_NAME_RGB}{m.group(4)}"
            + f"{num(new_tc)}{m.group(6)}{num(COURSE_NAME_SIZE)}{m.group(8)}"
            + f"{num(COURSE_NAME_SIZE * 1.2)}{m.group(10)}{course_name}{m.group(12)}"
            + stream[m.end():]
        )
        changed.append(
            f'  name    : "{course_name}" {num(old_size)}pt -> {num(COURSE_NAME_SIZE)}pt, '
            f"x {num(name_span['bbox'][0])} -> {num(new_x)}"
        )

    print(f"{path.name}:")
    for line in changed:
        print(line)

    if stream == original:
        print("  (no change needed)")
        doc.close()
        return False

    doc.update_stream(xref, stream.encode("latin-1"))
    tmp = path.with_suffix(".patched.tmp")
    doc.save(str(tmp), garbage=0, deflate=True)
    doc.close()
    shutil.move(str(tmp), str(path))
    return True


def main() -> None:
    any_changed = False
    for path in TEMPLATES:
        if not path.exists():
            print(f"{path.name}: MISSING, skipped", file=sys.stderr)
            continue
        any_changed |= patch(path)
        print()
    print("Done." if any_changed else "Nothing to change.")


if __name__ == "__main__":
    main()
