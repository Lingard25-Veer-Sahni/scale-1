"""Data-population script for Course 2 ("Investing & Financial Markets").

Same shape and reasoning as seed_course1.py: lessons need real uploaded PDF
file_refs (summary + slides) created through the Supabase Storage layer
first, with the resulting file IDs baked into the lesson docs, so this is a
source-data-driven population step rather than startup-seed logic.

Course 2 is being built lesson by lesson as the material arrives, so this
script is designed to be run repeatedly:

  * the course is upserted by slug
  * each lesson is upserted by (course_id, order)

Re-running never creates duplicates — it refreshes whatever is listed in
LESSONS below and leaves lessons that are not listed untouched. To add the
next lesson, append one entry to LESSONS and run the script again.

The certificate artwork says "all lessons" rather than a fixed count, so the
course can gain or lose a lesson without the certificate becoming wrong.
TOTAL_LESSONS below is only used for the "x of y built" progress report.

Usage (from backend/, with the project's venv):

    ./.venv/bin/python3 scripts/seed_course2.py

Note: this writes to the live Supabase database that the deployed site uses.
"""
import asyncio
import sys
import uuid
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT_DIR))

from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

import os
from pg_shim import PGClient
from storage_service import put_object, build_upload_path

DOWNLOADS = Path("/Users/veersinghsahni/Downloads")

supabase_url = os.environ["SUPABASE_URL"]
supabase_key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
db = PGClient(supabase_url, supabase_key)

SLUG = "investing-and-financial-markets"
TOTAL_LESSONS = 10  # planned length, used only for the progress report below


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def upload_material(path: Path) -> str:
    """Uploads a PDF to Supabase Storage, creates a file_refs row with
    kind='course_material', returns the new FileRef id."""
    data = path.read_bytes()
    storage_path = build_upload_path("course-materials", "pdf")
    result = put_object(storage_path, data, "application/pdf")
    ref_id = str(uuid.uuid4())
    ref = {
        "id": ref_id,
        "storage_path": result["path"],
        "original_filename": path.name,
        "content_type": "application/pdf",
        "size": int(result.get("size") or len(data)),
        "kind": "course_material",
        "created_at": now_iso(),
        "is_deleted": False,
    }
    await db.file_refs.insert_one(ref)
    print(f"  uploaded {path.name} -> file_refs/{ref_id}")
    return ref_id


# Each entry:
#   order        1-10, drives the lesson sequence shown to learners
#   title        lesson title as it appears in the course
#   youtube_url  full watch/share link, or None until the video exists
#   summary      Path to the summary PDF, or None
#   ppt          Path to the slides PDF, or None
#   quiz         list of (question, [options], correct_index, explanation)
#
# A lesson with an empty quiz cannot be passed, and the certificate only
# unlocks once every lesson in the course is passed — so leave a lesson out
# of this list entirely until its quiz is ready, rather than adding it with
# quiz=[].
LESSONS = [
    {
        "order": 1,
        "title": "Why Invest at All: Inflation and the Time Value of Money",
        "youtube_url": "https://youtu.be/j-2PR_ptdy4",
        "summary": DOWNLOADS / "SCALE-C2-L01-Summary-73f65a03.pdf",
        # Slides PDF not yet on disk. Left as None so the lesson can publish
        # now; re-running the script once the file is in ~/Downloads attaches
        # it without disturbing anything else.
        "ppt": None,
        # The ten multiple-choice questions from the lesson quiz, in the same
        # order and wording as the PDF so a learner working from the printout
        # sees the same paper. The PDF's two written practice problems are not
        # here: they need working shown, which the site cannot mark.
        "quiz": [
            ("What does inflation do to the purchasing power of money over time?",
             ["Increases it", "Decreases it", "Leaves it unchanged", "Doubles it every year"], 1,
             "Inflation is the general rise in prices, so the same amount of money buys less each year: purchasing power falls."),
            ("₹10,000 is placed at 7% simple interest for 5 years. What is it worth at the end?",
             ["₹10,700", "₹13,500", "₹14,026", "₹17,000"], 1,
             "Simple interest = 10,000 x 0.07 x 5 = ₹3,500. Total = 10,000 + 3,500 = ₹13,500."),
            ("Why does compound interest eventually outgrow simple interest at the same rate?",
             ["The rate increases every year", "Interest is earned on the growing pile, including past interest", "Banks charge lower fees on it", "It avoids inflation completely"], 1,
             "Compounding adds each period's interest to the base, so later interest is earned on interest."),
            ("₹10,000 at 7% compounded annually is worth about how much after 10 years?",
             ["₹17,000", "₹19,672", "₹24,000", "₹38,697"], 1,
             "10,000 x 1.07^10 = about ₹19,672. ₹17,000 is the simple-interest answer; ₹38,697 is the 20-year compound answer."),
            ("An investment earns 7% while inflation is 6%. The real return is closest to:",
             ["13%", "7%", "1%", "-1%"], 2,
             "Real return is roughly nominal minus inflation: 7 - 6 = 1% (exact: 1.07/1.06 - 1 = 0.94%)."),
            ("Using the rule of 72, money growing at 9% a year doubles in about:",
             ["6 years", "8 years", "9 years", "12 years"], 1,
             "72 / 9 = 8 years."),
            ("Prices are doubling every 12 years. The rule of 72 says inflation is about:",
             ["12%", "8%", "6%", "4%"], 2,
             "72 / 12 = 6%. The rule works backwards for prices too."),
            ("Asha invests ₹2,000 a month from age 16 and Kabir the same from 26, at the same return. At 40, Asha has nearly 4 times Kabir's corpus mainly because:",
             ["She chose riskier products", "Her money had more compounding periods", "She invested 4 times more each month", "Inflation was lower in her years"], 1,
             "Same monthly amount and same return: only the ten extra years of compounding separate them."),
            ("Keeping savings in a cash box at home while inflation runs at 6% means:",
             ["The money is safe and grows slowly", "The real value of the money falls each year", "The money doubles in 12 years", "Nothing changes because cash has no risk"], 1,
             "Idle cash earns 0%, so its purchasing power falls by roughly the inflation rate every year."),
            ("Which statement best captures why people invest rather than only save?",
             ["To avoid keeping any records", "To beat inflation and grow purchasing power over time", "To guarantee quick profits", "Because saving is illegal for students"], 1,
             "Saving preserves money; investing aims to grow it faster than inflation so purchasing power actually increases."),
        ],
    },
]


async def main() -> None:
    course = await db.courses.find_one({"slug": SLUG})
    if not course:
        course = {
            "id": str(uuid.uuid4()),
            "slug": SLUG,
            "title": "Investing & Financial Markets",
            "subtitle": "How investing works and how financial markets operate.",
            "description": (
                "A free SCALE course on investing and financial markets. Ten lessons, "
                "each with a video, slides, a written summary and a quiz."
            ),
            "published": True,
            "order": 2,
            "created_at": now_iso(),
        }
        await db.courses.insert_one(course)
        print(f"Created course {course['id']} ({course['slug']})")
    else:
        print(f"Course already exists: {course['id']} ({course['slug']})")

    course_id = course["id"]

    for spec in LESSONS:
        print(f"\nLesson {spec['order']}: {spec['title']}")
        existing = await db.lessons.find({"course_id": course_id}, {"_id": 0}).to_list(500)
        match = next((l for l in existing if l.get("order") == spec["order"]), None)

        # If a source PDF is not on disk (already uploaded on a prior run,
        # then cleaned out of ~/Downloads), keep whatever file_refs id is
        # already on the lesson instead of overwriting it with None —
        # otherwise re-running this script silently breaks working PDF links.
        summary_path = spec.get("summary")
        if summary_path and summary_path.exists():
            summary_id = await upload_material(summary_path)
        else:
            summary_id = match.get("summary_pdf_id") if match else None

        ppt_path = spec.get("ppt")
        if ppt_path and ppt_path.exists():
            ppt_id = await upload_material(ppt_path)
        else:
            ppt_id = match.get("ppt_pdf_id") if match else None

        quiz = [
            {
                "id": str(uuid.uuid4()),
                "question": q,
                "options": opts,
                "correct_index": correct,
                "explanation": expl,
            }
            for (q, opts, correct, expl) in spec["quiz"]
        ]

        doc = {
            "course_id": course_id,
            "order": spec["order"],
            "title": spec["title"],
            "youtube_url": spec.get("youtube_url"),
            "summary_pdf_id": summary_id,
            "ppt_pdf_id": ppt_id,
            "quiz": quiz,
            "passing_pct": 60,
        }

        if match:
            doc["id"] = match["id"]
            await db.lessons.update_one({"id": match["id"]}, {"$set": doc})
            print(f"  updated lesson {match['id']}")
        else:
            doc["id"] = str(uuid.uuid4())
            doc["created_at"] = now_iso()
            await db.lessons.insert_one(doc)
            print(f"  created lesson {doc['id']}")

    # Progress report, so it is obvious how much of the course still has to
    # be built before the "all 10 lessons" certificate makes sense.
    all_lessons = await db.lessons.find({"course_id": course_id}, {"_id": 0}).to_list(500)
    done = len(all_lessons)
    print(f"\n{done} of {TOTAL_LESSONS} lessons exist for {SLUG}.")
    if done < TOTAL_LESSONS:
        missing = [n for n in range(1, TOTAL_LESSONS + 1)
                   if not any(l.get("order") == n for l in all_lessons)]
        print(f"Still to add: lesson(s) {', '.join(str(m) for m in missing)}")

    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
