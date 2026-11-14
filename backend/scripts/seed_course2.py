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
    # Lesson entries go here as the material arrives.
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
