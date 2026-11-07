"""One-time script: create the "SCALE Business Case Competition" event and
attach its reference PDFs (rules & rubric, the real case, and a sample
case+solution) to the post-registration materials hub.

Uses the running preview backend's HTTP API (not a direct DB write) since
event creation/materials-upload already has well-defined endpoints:
  POST /api/auth/login              -> admin JWT
  GET  /api/events                  -> check for an existing event with this title
  POST /api/events                  -> create event (EventItem)   [if not found]
  PUT  /api/events/{id}             -> update event                [if found]
  POST /api/events/{id}/files       -> upload each PDF -> file_refs row
  PUT  /api/events/{id}/materials   -> attach uploaded files + notes

Safe to re-run: if an event with this exact title already exists, it PATCHes
that one via PUT instead of creating a duplicate, and re-uploads+re-attaches
the four reference files (harmless, just creates fresh file_refs rows and
replaces the materials.documents list).

Usage (backend must be running on localhost:8010, e.g. via preview_start):
    ./.venv/bin/python3 scripts/seed_case_comp_event.py
"""
import mimetypes
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / ".env")

BASE = "http://localhost:8010/api"
CASE_DIR = Path("/Users/veersinghsahni/Desktop/SCALE case comp")

ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]

EVENT_TITLE = "SCALE Business Case Competition"

ABOUT_TEXT = (
    "A free, individual business case competition. You'll analyse Lenskart's real FY26 numbers, decide where "
    "its next marginal rupee of growth investment should go, and submit a short deck (Round 1). The top 10 "
    "scorers then pitch live to judges (Round 2). Full rules, the rubric, the Lenskart case, and a sample "
    "case and solution (IndiGo) are attached below, read the rules packet first. "
    "Round 1 decks are due 20 January 2027."
)

DESCRIPTION_TEXT = (
    "Solve a real, evidence-based business case alone and pitch your recommendation to judges. "
    "This season's case: Lenskart. Round 1 decks due 20 January 2027."
)

ELIGIBILITY_TEXT = (
    "Open to students. Individual entries only, no teams. Round 1 is a submitted deck (PDF); "
    "the top 10 scorers advance to a live final pitch."
)

PRIZE_POOL_TEXT = (
    "Total prize pool: 15,000 rupees.\n"
    "1st place: 10,000 rupees.\n"
    "2nd place: 5,000 rupees."
)

DISCLAIMER_TEXT = (
    "All data, materials, and case content used in this competition are for educational "
    "purposes only. SCALE is not affiliated with, endorsed by, or targeting any company "
    "referenced in this competition."
)

MATERIALS_NOTES = (
    'Start with "Rules & Format", it has the full rubric and the case-specific judging checklist for Lenskart. '
    '"Lenskart case" is the case you must solve. The IndiGo sample case + sample solution are a reference only, '
    "to show the expected format and depth, not the case you're solving, and not a template to copy."
)

FILES_TO_ATTACH = [
    ("SCALE rules format and rubric.pdf", "Rules & Format"),
    ("Lenskart case.pdf", "Lenskart case packet, THE case to solve"),
    ("IndiGo sample case.pdf", "Sample case (IndiGo)"),
    ("IndiGo sample solution.pdf", "Sample worked solution (IndiGo)"),
]


def login(s: requests.Session) -> None:
    r = s.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    r.raise_for_status()
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"


def find_existing_event(s: requests.Session) -> dict | None:
    r = s.get(f"{BASE}/events")
    r.raise_for_status()
    for ev in r.json():
        if ev.get("title") == EVENT_TITLE:
            return ev
    return None


def upsert_event(s: requests.Session) -> dict:
    existing = find_existing_event(s)
    payload = {
        "title": EVENT_TITLE,
        "description": DESCRIPTION_TEXT,
        "about": ABOUT_TEXT,
        "status": "live",
        "cta_label": "Case Competition Details",
        "date": "Round 1 submission deadline: 20 January 2027",
        "location": "Online, individual submission",
        "price_inr": 0,
        "registration_mode": "individual",
        "eligibility": ELIGIBILITY_TEXT,
        "registration_open": True,
        "registration_closed_message": "Registration for the SCALE Business Case Competition is currently closed.",
        # Free, no-registration event: hide the scholarship CTA + Register Now/
        # payment form, and make the attached materials (rules/rubric, Lenskart
        # case, IndiGo sample case+solution) publicly viewable with no
        # registration/payment gate at all.
        "public_materials": True,
        "hide_registration": True,
        "prize_pool": PRIZE_POOL_TEXT,
        "disclaimer": DISCLAIMER_TEXT,
    }
    if existing:
        r = s.put(f"{BASE}/events/{existing['id']}", json=payload)
        r.raise_for_status()
        print(f"Updated existing event {existing['id']}")
        return r.json()
    else:
        r = s.post(f"{BASE}/events", json=payload)
        r.raise_for_status()
        ev = r.json()
        print(f"Created event {ev['id']}")
        return ev


def upload_file(s: requests.Session, event_id: str, filename: str, label: str) -> dict:
    path = CASE_DIR / filename
    content_type = mimetypes.guess_type(str(path))[0] or "application/pdf"
    with open(path, "rb") as f:
        r = s.post(
            f"{BASE}/events/{event_id}/files",
            files={"file": (filename, f, content_type)},
        )
    r.raise_for_status()
    data = r.json()
    print(f"  uploaded {filename} -> file_id {data.get('file_id') or data.get('id')}")
    return {
        "label": label,
        "file_id": data.get("file_id") or data["id"],
        "filename": data.get("filename", filename),
        "content_type": data.get("content_type", content_type),
        "size": data.get("size", path.stat().st_size),
    }


SUBMISSION_LINKS = [
    {"label": "Round 1 Submission Form", "url": "https://forms.gle/CMMUTpydygEjhCJGA"},
]


def attach_materials(s: requests.Session, event_id: str) -> None:
    documents = [upload_file(s, event_id, fname, label) for fname, label in FILES_TO_ATTACH]
    r = s.put(
        f"{BASE}/events/{event_id}/materials",
        json={"notes": MATERIALS_NOTES, "links": SUBMISSION_LINKS, "documents": documents},
    )
    r.raise_for_status()
    print("Materials attached.")


def main():
    s = requests.Session()
    login(s)
    ev = upsert_event(s)
    attach_materials(s, ev["id"])
    print("Done. Event id:", ev["id"])


if __name__ == "__main__":
    main()
